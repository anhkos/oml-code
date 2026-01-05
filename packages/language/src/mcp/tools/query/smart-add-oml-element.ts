import { z } from 'zod';
import * as net from 'net';
import * as fs from 'fs';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { WorkspaceSymbolRequest } from 'vscode-languageserver-protocol';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';
import {
    LSP_BRIDGE_PORT,
    pathToFileUri,
    fileUriToPath,
    writeFileAndNotify,
    detectIndentation,
    formatAnnotations,
    AnnotationParam,
    findTerm,
} from '../common.js';
import { annotationParamSchema } from '../schemas.js';
import { OML_SYMBOL_KINDS, ENTITY_SYMBOL_KINDS } from './suggest-oml-symbols.js';

/**
 * Resolved symbol information
 */
interface ResolvedSymbol {
    originalName: string;
    resolvedName: string;      // How to reference in code (qualified or not)
    prefix?: string;
    namespace?: string;
    needsImport: boolean;
    importPath?: string;       // File path if import needed
    isLocal: boolean;
}

/**
 * Element types we can create
 */
export type OmlElementType =
    | 'concept'
    | 'aspect'
    | 'relation_entity'
    | 'unreified_relation'
    | 'scalar'
    | 'scalar_property'
    | 'annotation_property';

const paramsSchema = {
    uri: z.string().describe('File path to the OML vocabulary'),
    elementName: z.string().describe('Name of the element to create'),
    elementType: z.enum(['concept', 'aspect', 'relation_entity', 'unreified_relation', 'scalar', 'scalar_property', 'annotation_property'])
        .describe('Type of OML element to create'),
    
    // Relationships (all optional)
    specializes: z.array(z.string()).optional().describe('Super terms to specialize (e.g., ["Vehicle", "base:Movable"])'),
    relationFrom: z.array(z.string()).optional().describe('Source entities for relations'),
    relationTo: z.array(z.string()).optional().describe('Target entities for relations'),
    relationReverse: z.string().optional().describe('Reverse relation name'),
    relationForward: z.string().optional().describe('Forward relation name (for relation entities)'),
    domains: z.array(z.string()).optional().describe('Domain entities for properties'),
    ranges: z.array(z.string()).optional().describe('Range types for properties'),
    
    // Metadata
    annotations: z.array(annotationParamSchema).optional().describe('Annotations to add'),
    
    // Boolean flags
    functional: z.boolean().optional(),
    inverseFunctional: z.boolean().optional(),
    symmetric: z.boolean().optional(),
    asymmetric: z.boolean().optional(),
    reflexive: z.boolean().optional(),
    irreflexive: z.boolean().optional(),
    transitive: z.boolean().optional(),
    
    // Additional options
    keys: z.array(z.array(z.string())).optional().describe('Key property groups (for concepts/aspects)'),
    instanceEnumeration: z.array(z.string()).optional().describe('Instance enumeration (for concepts)'),
};

export const smartAddOmlElementTool = {
    name: 'smart_add_oml_element' as const,
    description: 'Add an OML element (concept, relation, property, etc.) with automatic import resolution. Resolves symbol references, adds needed imports, and generates proper OML code. Use this for creating elements that reference symbols from other ontologies.',
    paramsSchema,
};

export const smartAddOmlElementHandler = async (
    params: {
        uri: string;
        elementName: string;
        elementType: OmlElementType;
        specializes?: string[];
        relationFrom?: string[];
        relationTo?: string[];
        relationReverse?: string;
        relationForward?: string;
        domains?: string[];
        ranges?: string[];
        annotations?: AnnotationParam[];
        functional?: boolean;
        inverseFunctional?: boolean;
        symmetric?: boolean;
        asymmetric?: boolean;
        reflexive?: boolean;
        irreflexive?: boolean;
        transitive?: boolean;
        keys?: string[][];
        instanceEnumeration?: string[];
    }
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
    const {
        uri,
        elementName,
        elementType,
        specializes,
        relationFrom,
        relationTo,
        relationReverse,
        relationForward,
        domains,
        ranges,
        annotations,
        functional,
        inverseFunctional,
        symmetric,
        asymmetric,
        reflexive,
        irreflexive,
        transitive,
        keys,
        instanceEnumeration,
    } = params;

    try {
        // 1. Load and validate the target file
        const fileUri = pathToFileUri(uri);
        const filePath = fileUriToPath(fileUri);

        if (!fs.existsSync(filePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `File not found: ${filePath}` }],
            };
        }

        const services = createOmlServices(NodeFileSystem);
        const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(fileUri));
        await services.shared.workspace.DocumentBuilder.build([document], { validation: false });

        const root = document.parseResult.value;
        if (!isVocabulary(root)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'File must be a vocabulary. Only vocabularies can contain term definitions.' }],
            };
        }

        const vocabulary = root;
        const currentNamespace = vocabulary.namespace;
        const currentPrefix = vocabulary.prefix;

        // 2. Check if element already exists
        if (findTerm(vocabulary, elementName)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Element "${elementName}" already exists in the vocabulary.` }],
            };
        }

        // 3. Collect all referenced symbols
        const referencedSymbols: Array<{ name: string; expectedKinds: number[] }> = [];
        
        // Specialization targets (entities: concepts, aspects, relation entities)
        if (specializes) {
            for (const sym of specializes) {
                referencedSymbols.push({ name: sym, expectedKinds: ENTITY_SYMBOL_KINDS });
            }
        }
        
        // Relation sources/targets (entities)
        if (relationFrom) {
            for (const sym of relationFrom) {
                referencedSymbols.push({ name: sym, expectedKinds: ENTITY_SYMBOL_KINDS });
            }
        }
        if (relationTo) {
            for (const sym of relationTo) {
                referencedSymbols.push({ name: sym, expectedKinds: ENTITY_SYMBOL_KINDS });
            }
        }
        
        // Property domains (entities)
        if (domains) {
            for (const sym of domains) {
                referencedSymbols.push({ name: sym, expectedKinds: ENTITY_SYMBOL_KINDS });
            }
        }
        
        // Property ranges (scalars for scalar properties, or entities for relation targets)
        if (ranges) {
            const rangeKinds = elementType === 'scalar_property' 
                ? [OML_SYMBOL_KINDS.scalar]  // Scalar property ranges are scalars
                : ENTITY_SYMBOL_KINDS;        // Other ranges are entities
            for (const sym of ranges) {
                referencedSymbols.push({ name: sym, expectedKinds: rangeKinds });
            }
        }

        // 4. Resolve all symbols
        const resolvedSymbols = new Map<string, ResolvedSymbol>();
        const importsToAdd: Array<{ namespace: string; prefix: string; filePath: string }> = [];
        const errors: string[] = [];

        // Build map of current imports
        const importedNamespaces = new Map<string, string>();
        for (const imp of vocabulary.ownedImports || []) {
            const importedRef = imp.imported?.ref;
            if (importedRef?.namespace) {
                const ns = importedRef.namespace.replace(/^<|>$/g, '');
                const prefix = imp.prefix || importedRef.prefix;
                importedNamespaces.set(ns, prefix);
            }
        }

        for (const { name, expectedKinds } of referencedSymbols) {
            if (resolvedSymbols.has(name)) continue; // Already resolved
            
            const resolved = await resolveSymbol(
                name,
                expectedKinds,
                vocabulary,
                currentPrefix,
                currentNamespace,
                importedNamespaces,
                services,
                fileUri
            );

            if (!resolved) {
                errors.push(`Could not resolve symbol "${name}". It may not exist in the workspace.`);
                continue;
            }

            resolvedSymbols.set(name, resolved);

            if (resolved.needsImport && resolved.namespace && resolved.prefix && resolved.importPath) {
                // Check if we already plan to add this import
                const alreadyAdding = importsToAdd.some(i => i.namespace === resolved.namespace);
                if (!alreadyAdding) {
                    importsToAdd.push({
                        namespace: resolved.namespace,
                        prefix: resolved.prefix,
                        filePath: resolved.importPath,
                    });
                }
            }
        }

        if (errors.length > 0) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `Failed to resolve symbols:\n${errors.join('\n')}\n\nUse suggest_oml_symbols to find available symbols.`,
                }],
            };
        }

        // 5. Read current file content
        let content = fs.readFileSync(filePath, 'utf-8');
        const eol = content.includes('\r\n') ? '\r\n' : '\n';
        const indent = detectIndentation(content);
        const innerIndent = indent + indent;

        // 6. Add required imports
        const addedImports: string[] = [];
        for (const importInfo of importsToAdd) {
            const formattedNs = importInfo.namespace.startsWith('<') 
                ? importInfo.namespace 
                : `<${importInfo.namespace}>`;
            const importStatement = `${indent}extends ${formattedNs} as ${importInfo.prefix}`;
            
            content = insertImportStatement(content, importStatement, eol);
            addedImports.push(importInfo.prefix);
        }

        // 7. Generate element code
        const elementCode = generateElementCode({
            elementType,
            elementName,
            specializes: resolveNames(specializes, resolvedSymbols),
            relationFrom: resolveNames(relationFrom, resolvedSymbols),
            relationTo: resolveNames(relationTo, resolvedSymbols),
            relationReverse,
            relationForward,
            domains: resolveNames(domains, resolvedSymbols),
            ranges: resolveNames(ranges, resolvedSymbols),
            annotations,
            functional,
            inverseFunctional,
            symmetric,
            asymmetric,
            reflexive,
            irreflexive,
            transitive,
            keys,
            instanceEnumeration,
            indent,
            innerIndent,
            eol,
        });

        // 8. Insert element before closing brace
        const closingIndex = content.lastIndexOf('}');
        if (closingIndex === -1) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Could not find closing brace in vocabulary file.' }],
            };
        }

        const newContent = content.slice(0, closingIndex) + elementCode + content.slice(closingIndex);

        // 9. Write file and notify LSP
        await writeFileAndNotify(filePath, fileUri, newContent);

        // 10. Build success response
        const qualifiedRefs = Array.from(resolvedSymbols.values())
            .filter(r => !r.isLocal)
            .map(r => `${r.originalName} → ${r.resolvedName}`);

        const response = {
            success: true,
            message: `Created ${elementType} "${elementName}"`,
            importsAdded: addedImports,
            qualifiedReferences: qualifiedRefs,
            generatedCode: elementCode.trim(),
        };

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify(response, null, 2),
            }],
        };

    } catch (error) {
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
        };
    }
};

/**
 * Resolve a symbol reference to its qualified form
 */
async function resolveSymbol(
    name: string,
    expectedKinds: number[],
    vocabulary: any,
    currentPrefix: string,
    currentNamespace: string,
    importedNamespaces: Map<string, string>,
    services: any,
    currentFileUri: string
): Promise<ResolvedSymbol | null> {
    
    // Case 1: Already qualified (contains ':')
    if (name.includes(':')) {
        const [prefix, localName] = name.split(':');
        
        // Check if prefix is current vocabulary
        if (prefix === currentPrefix) {
            return {
                originalName: name,
                resolvedName: localName, // Use unqualified in same vocabulary
                isLocal: true,
                needsImport: false,
            };
        }
        
        // Check if prefix is already imported
        for (const [ns, importPrefix] of importedNamespaces) {
            if (importPrefix === prefix) {
                return {
                    originalName: name,
                    resolvedName: name,
                    prefix: importPrefix,
                    namespace: ns,
                    isLocal: false,
                    needsImport: false,
                };
            }
        }
        
        // Need to find and import ontology with this prefix
        const found = await findOntologyByPrefix(prefix, services, currentFileUri);
        if (found) {
            return {
                originalName: name,
                resolvedName: name,
                prefix: found.prefix,
                namespace: found.namespace,
                importPath: found.filePath,
                isLocal: false,
                needsImport: true,
            };
        }
        
        return null;
    }
    
    // Case 2: Check local scope
    const localMatch = vocabulary.ownedStatements?.find((stmt: any) => stmt.name === name);
    if (localMatch) {
        return {
            originalName: name,
            resolvedName: name,
            isLocal: true,
            needsImport: false,
        };
    }
    
    // Case 3: Check imported ontologies
    for (const [ns, prefix] of importedNamespaces) {
        const found = await findSymbolInNamespace(name, ns, expectedKinds, services);
        if (found) {
            return {
                originalName: name,
                resolvedName: `${prefix}:${name}`,
                prefix,
                namespace: ns,
                isLocal: false,
                needsImport: false,
            };
        }
    }
    
    // Case 4: Search entire workspace
    const workspaceMatch = await searchWorkspaceForSymbol(name, expectedKinds, services, currentFileUri);
    if (workspaceMatch) {
        return {
            originalName: name,
            resolvedName: `${workspaceMatch.prefix}:${name}`,
            prefix: workspaceMatch.prefix,
            namespace: workspaceMatch.namespace,
            importPath: workspaceMatch.filePath,
            isLocal: false,
            needsImport: true,
        };
    }
    
    return null;
}

/**
 * Find an ontology by its prefix
 */
async function findOntologyByPrefix(
    prefix: string,
    services: any,
    excludeUri: string
): Promise<{ namespace: string; prefix: string; filePath: string } | null> {
    // Iterate through all loaded documents
    const langDocs = services.shared.workspace.LangiumDocuments;
    for (const doc of (langDocs as any).all ?? []) {
        const root = doc.parseResult?.value;
        if (!root) continue;
        
        if ((isVocabulary(root) || isDescription(root) || isVocabularyBundle(root) || isDescriptionBundle(root)) &&
            root.prefix === prefix &&
            doc.uri.toString() !== excludeUri) {
            return {
                namespace: root.namespace.replace(/^<|>$/g, ''),
                prefix: root.prefix,
                filePath: fileUriToPath(doc.uri.toString()),
            };
        }
    }
    return null;
}

/**
 * Check if a symbol exists in a namespace
 */
async function findSymbolInNamespace(
    name: string,
    namespace: string,
    expectedKinds: number[],
    services: any
): Promise<boolean> {
    const langDocs = services.shared.workspace.LangiumDocuments;
    for (const doc of (langDocs as any).all ?? []) {
        const root = doc.parseResult?.value;
        if (!root) continue;
        
        const rootNs = (root.namespace || '').replace(/^<|>$/g, '');
        if (rootNs !== namespace.replace(/^<|>$/g, '')) continue;
        
        const statements = root.ownedStatements || [];
        for (const stmt of statements) {
            if (stmt.name === name) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Search the entire workspace for a symbol via LSP
 */
async function searchWorkspaceForSymbol(
    name: string,
    expectedKinds: number[],
    services: any,
    excludeUri: string
): Promise<{ namespace: string; prefix: string; filePath: string } | null> {
    let socket: net.Socket | undefined;
    let connection: ReturnType<typeof createMessageConnection> | undefined;

    try {
        socket = net.connect({ port: LSP_BRIDGE_PORT });

        await new Promise<void>((resolve, reject) => {
            socket!.on('connect', () => resolve());
            socket!.on('error', (err) => reject(err));
            setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });

        const reader = new StreamMessageReader(socket);
        const writer = new StreamMessageWriter(socket);
        connection = createMessageConnection(reader, writer);
        connection.listen();

        const symbols = await connection.sendRequest<any[]>(
            WorkspaceSymbolRequest.method,
            { query: name }
        );

        connection.dispose();
        socket.end();

        if (!symbols || !Array.isArray(symbols)) return null;

        // Find exact match with correct kind
        for (const symbol of symbols) {
            if (symbol.name !== name) continue;
            if (!expectedKinds.includes(symbol.kind)) continue;
            
            const symbolUri = symbol.location?.uri;
            if (!symbolUri || normalizeUri(symbolUri) === normalizeUri(excludeUri)) continue;

            // Load the ontology to get its info
            const doc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(symbolUri));
            await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
            
            const root = doc.parseResult?.value;
            if (isVocabulary(root) || isDescription(root) || isVocabularyBundle(root) || isDescriptionBundle(root)) {
                return {
                    namespace: root.namespace.replace(/^<|>$/g, ''),
                    prefix: root.prefix,
                    filePath: fileUriToPath(symbolUri),
                };
            }
        }

        return null;
    } catch {
        // Try local document search as fallback
        const langDocs = services.shared.workspace.LangiumDocuments;
        for (const doc of (langDocs as any).all ?? []) {
            if (doc.uri.toString() === excludeUri) continue;
            
            const root = doc.parseResult?.value;
            if (!root) continue;
            
            if (isVocabulary(root) || isDescription(root)) {
                const statements = root.ownedStatements || [];
                for (const stmt of statements) {
                    if (stmt.name === name) {
                        return {
                            namespace: root.namespace.replace(/^<|>$/g, ''),
                            prefix: root.prefix,
                            filePath: fileUriToPath(doc.uri.toString()),
                        };
                    }
                }
            }
        }
        return null;
    }
}

/**
 * Insert an import statement in the correct location
 */
function insertImportStatement(content: string, importStatement: string, eol: string): string {
    const lines = content.split(/\r?\n/);
    let insertIndex = -1;
    let inOntology = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        
        if (trimmed.includes('vocabulary') || trimmed.includes('description')) {
            inOntology = true;
        }
        
        if (inOntology && trimmed.includes('{')) {
            // Found opening brace
            insertIndex = i + 1;
            
            // Skip past existing imports
            while (insertIndex < lines.length) {
                const nextTrimmed = lines[insertIndex].trim();
                if (nextTrimmed.startsWith('extends') || 
                    nextTrimmed.startsWith('uses') || 
                    nextTrimmed.startsWith('includes') ||
                    nextTrimmed === '') {
                    insertIndex++;
                } else {
                    break;
                }
            }
            break;
        }
    }

    if (insertIndex === -1) {
        throw new Error('Could not find insertion point for import');
    }

    lines.splice(insertIndex, 0, importStatement);
    return lines.join(eol);
}

/**
 * Resolve symbol names to their qualified forms
 */
function resolveNames(
    names: string[] | undefined,
    resolved: Map<string, ResolvedSymbol>
): string[] | undefined {
    if (!names) return undefined;
    return names.map(name => {
        const r = resolved.get(name);
        return r ? r.resolvedName : name;
    });
}

/**
 * Generate OML code for an element
 */
function generateElementCode(params: {
    elementType: OmlElementType;
    elementName: string;
    specializes?: string[];
    relationFrom?: string[];
    relationTo?: string[];
    relationReverse?: string;
    relationForward?: string;
    domains?: string[];
    ranges?: string[];
    annotations?: AnnotationParam[];
    functional?: boolean;
    inverseFunctional?: boolean;
    symmetric?: boolean;
    asymmetric?: boolean;
    reflexive?: boolean;
    irreflexive?: boolean;
    transitive?: boolean;
    keys?: string[][];
    instanceEnumeration?: string[];
    indent: string;
    innerIndent: string;
    eol: string;
}): string {
    const {
        elementType,
        elementName,
        specializes,
        relationFrom,
        relationTo,
        relationReverse,
        relationForward,
        domains,
        ranges,
        annotations,
        functional,
        keys,
        instanceEnumeration,
        indent,
        innerIndent,
        eol,
    } = params;

    const annotationsText = formatAnnotations(annotations, indent, eol);
    const specializationText = specializes && specializes.length > 0 
        ? ` < ${specializes.join(', ')}` 
        : '';

    let body = '';
    let keyword = '';

    switch (elementType) {
        case 'concept':
            keyword = 'concept';
            if (instanceEnumeration && instanceEnumeration.length > 0) {
                body += `${innerIndent}oneOf ${instanceEnumeration.join(', ')}${eol}`;
            }
            if (keys) {
                for (const keyGroup of keys) {
                    body += `${innerIndent}key ${keyGroup.join(', ')}${eol}`;
                }
            }
            break;
            
        case 'aspect':
            keyword = 'aspect';
            if (keys) {
                for (const keyGroup of keys) {
                    body += `${innerIndent}key ${keyGroup.join(', ')}${eol}`;
                }
            }
            break;
            
        case 'relation_entity':
            keyword = 'relation entity';
            if (relationFrom && relationFrom.length > 0) {
                body += `${innerIndent}from ${relationFrom.join(', ')}${eol}`;
            }
            if (relationTo && relationTo.length > 0) {
                body += `${innerIndent}to ${relationTo.join(', ')}${eol}`;
            }
            if (relationForward) {
                body += `${innerIndent}forward ${relationForward}${eol}`;
            }
            if (relationReverse) {
                body += `${innerIndent}reverse ${relationReverse}${eol}`;
            }
            body += buildFlags(params, innerIndent, eol);
            if (keys) {
                for (const keyGroup of keys) {
                    body += `${innerIndent}key ${keyGroup.join(', ')}${eol}`;
                }
            }
            break;
            
        case 'unreified_relation':
            keyword = 'relation';
            if (relationFrom && relationFrom.length > 0) {
                body += `${innerIndent}from ${relationFrom.join(', ')}${eol}`;
            }
            if (relationTo && relationTo.length > 0) {
                body += `${innerIndent}to ${relationTo.join(', ')}${eol}`;
            }
            if (relationReverse) {
                body += `${innerIndent}reverse ${relationReverse}${eol}`;
            }
            body += buildFlags(params, innerIndent, eol);
            break;
            
        case 'scalar':
            keyword = 'scalar';
            break;
            
        case 'scalar_property':
            keyword = 'scalar property';
            if (domains && domains.length > 0) {
                body += `${innerIndent}domain ${domains.join(', ')}${eol}`;
            }
            if (ranges && ranges.length > 0) {
                body += `${innerIndent}range ${ranges.join(', ')}${eol}`;
            }
            if (functional) {
                body += `${innerIndent}functional${eol}`;
            }
            break;
            
        case 'annotation_property':
            keyword = 'annotation property';
            break;
    }

    const block = body ? ` [${eol}${body}${indent}]` : '';
    return `${annotationsText}${indent}${keyword} ${elementName}${specializationText}${block}${eol}${eol}`;
}

/**
 * Build relation flags text
 */
function buildFlags(params: any, indent: string, eol: string): string {
    const flags = [
        params.functional ? 'functional' : null,
        params.inverseFunctional ? 'inverse functional' : null,
        params.symmetric ? 'symmetric' : null,
        params.asymmetric ? 'asymmetric' : null,
        params.reflexive ? 'reflexive' : null,
        params.irreflexive ? 'irreflexive' : null,
        params.transitive ? 'transitive' : null,
    ].filter(Boolean);

    if (flags.length === 0) return '';
    return flags.map(f => `${indent}${f}`).join(eol) + eol;
}

/**
 * Normalize URI for comparison
 */
function normalizeUri(uri: string): string {
    return uri.toLowerCase().replace(/\\/g, '/');
}
