import { z } from 'zod';
import * as net from 'net';
import * as fs from 'fs';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';
import { pathToFileUri, fileUriToPath, getFreshDocument } from '../common.js';

const LSP_PORT = 5007;

/**
 * SymbolKind mapping from OmlNodeKindProvider
 */
export const OML_SYMBOL_KINDS = {
    concept: 5,           // SymbolKind.Class
    aspect: 11,           // SymbolKind.Interface
    relation_entity: 23,  // SymbolKind.Struct
    unreified_relation: 6, // SymbolKind.Method
    forward_relation: 6,
    reverse_relation: 6,
    scalar: 26,           // SymbolKind.TypeParameter
    scalar_property: 7,   // SymbolKind.Property
    annotation_property: 14, // SymbolKind.Constant
    vocabulary: 2,        // SymbolKind.Module
    vocabulary_bundle: 2,
    description: 4,       // SymbolKind.Package
    description_bundle: 4,
    concept_instance: 19, // SymbolKind.Object
    relation_instance: 19,
    rule: 12,             // SymbolKind.Function
    builtin: 12,
} as const;

export type OmlSymbolType = keyof typeof OML_SYMBOL_KINDS;

/**
 * Map AST $type to OML type name and SymbolKind
 */
const AST_TYPE_TO_OML: Record<string, { type: OmlSymbolType; kind: number }> = {
    'Concept': { type: 'concept', kind: 5 },
    'Aspect': { type: 'aspect', kind: 11 },
    'RelationEntity': { type: 'relation_entity', kind: 23 },
    'UnreifiedRelation': { type: 'unreified_relation', kind: 6 },
    'ForwardRelation': { type: 'forward_relation', kind: 6 },
    'ReverseRelation': { type: 'reverse_relation', kind: 6 },
    'Scalar': { type: 'scalar', kind: 26 },
    'ScalarProperty': { type: 'scalar_property', kind: 7 },
    'AnnotationProperty': { type: 'annotation_property', kind: 14 },
    'ConceptInstance': { type: 'concept_instance', kind: 19 },
    'RelationInstance': { type: 'relation_instance', kind: 19 },
    'Rule': { type: 'rule', kind: 12 },
    'BuiltIn': { type: 'builtin', kind: 12 },
};

/**
 * OML types that are considered "entities" (for specialization)
 */
export const ENTITY_TYPES: OmlSymbolType[] = ['concept', 'aspect', 'relation_entity'];

/**
 * SymbolKind values for entities
 */
export const ENTITY_SYMBOL_KINDS = [5, 11, 23]; // Class, Interface, Struct

/**
 * Reverse mapping from SymbolKind to OML types
 */
export const SYMBOL_KIND_TO_OML_TYPES: Record<number, OmlSymbolType[]> = {
    5: ['concept'],
    11: ['aspect'],
    23: ['relation_entity'],
    6: ['unreified_relation', 'forward_relation', 'reverse_relation'],
    26: ['scalar'],
    7: ['scalar_property'],
    14: ['annotation_property'],
    2: ['vocabulary', 'vocabulary_bundle'],
    4: ['description', 'description_bundle'],
    19: ['concept_instance', 'relation_instance'],
    12: ['rule', 'builtin'],
};

export interface SymbolSuggestion {
    name: string;
    qualifiedName: string;
    type: OmlSymbolType;
    symbolKind: number;
    location: string;
    ontologyPrefix: string;
    ontologyNamespace: string;
    alreadyImported: boolean;
    isLocal: boolean;
    needsImport: boolean;
}

export interface SuggestSymbolsResult {
    suggestions: SymbolSuggestion[];
    total: number;
    query: string;
    filters: {
        symbolType?: string;
        includeImported: boolean;
        includeLocal: boolean;
    };
}

/**
 * LSP response for workspace files
 */
interface LspWorkspaceFile {
    uri: string;
}

const paramsSchema = {
    uri: z.string().describe('Current file path for context'),
    symbolType: z.string().optional().describe('Filter by OML type: concept, aspect, relation_entity, unreified_relation, scalar, scalar_property, annotation_property'),
    query: z.string().optional().describe('Search term (empty = all symbols)'),
    includeImported: z.boolean().optional().describe('Include symbols from already-imported ontologies (default: true)'),
    includeLocal: z.boolean().optional().describe('Include symbols from current file (default: true)'),
    maxResults: z.number().optional().describe('Maximum results to return (default: 50)'),
};

export const suggestOmlSymbolsTool = {
    name: 'suggest_oml_symbols' as const,
    description: 'Search workspace for available OML symbols via LSP. Queries the language server for workspace files, then parses them to extract symbols with proper type information. Use to find available concepts, relations, properties before adding elements. Requires the OML language server to be running.',
    paramsSchema,
};

export const suggestOmlSymbolsHandler = async (
    params: {
        uri: string;
        symbolType?: string;
        query?: string;
        includeImported?: boolean;
        includeLocal?: boolean;
        maxResults?: number;
    }
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
    const {
        uri,
        symbolType,
        query = '',
        includeImported = true,
        includeLocal = true,
        maxResults = 50,
    } = params;

    try {
        const fileUri = pathToFileUri(uri);
        const filePath = fileUriToPath(fileUri);

        if (!fs.existsSync(filePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `File not found: ${filePath}` }],
            };
        }

        // Load current ontology to get context (imports, namespace)
        const services = createOmlServices(NodeFileSystem);
        // Use getFreshDocument for the current file to ensure we read the latest content
        const document = await getFreshDocument(services, fileUri);

        const root = document.parseResult.value;
        if (!isVocabulary(root) && !isDescription(root) && !isVocabularyBundle(root) && !isDescriptionBundle(root)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'File must be a vocabulary or description' }],
            };
        }

        const currentNamespace = root.namespace.replace(/^<|>$/g, '');
        const currentPrefix = root.prefix;

        // Build map of imported namespaces -> prefixes
        const importedNamespaces = new Map<string, string>();
        // Add current ontology as "imported" from itself
        importedNamespaces.set(currentNamespace, currentPrefix);
        
        for (const imp of root.ownedImports || []) {
            const importedRef = imp.imported?.ref;
            if (importedRef?.namespace) {
                const ns = importedRef.namespace.replace(/^<|>$/g, '');
                const prefix = imp.prefix || importedRef.prefix;
                importedNamespaces.set(ns, prefix);
            }
        }

        // Query LSP for workspace files
        const workspaceFiles = await queryWorkspaceFiles();
        
        if (!workspaceFiles) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Failed to connect to OML language server on port 5007. Make sure VS Code is running with the OML extension active.' }],
            };
        }

        // Filter to only OML files
        const omlFileUris = workspaceFiles.filter(f => f.uri.endsWith('.oml')).map(f => f.uri);
        console.error(`[suggest_oml_symbols] Found ${omlFileUris.length} .oml files from LSP`);

        // Collect all symbols by parsing each file with Langium
        const suggestions: SymbolSuggestion[] = [];
        // Note: targetType can be an OmlSymbolType OR 'entity' as a special filter
        const targetType = symbolType?.toLowerCase().replace(/-/g, '_');
        const queryLower = query.toLowerCase();
        const normalizedFileUri = normalizeUri(fileUri);

        for (const omlFileUri of omlFileUris) {
            try {
                const omlDoc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(omlFileUri));
                await services.shared.workspace.DocumentBuilder.build([omlDoc], { validation: false });

                const omlRoot = omlDoc.parseResult.value;
                if (!isVocabulary(omlRoot) && !isDescription(omlRoot) && 
                    !isVocabularyBundle(omlRoot) && !isDescriptionBundle(omlRoot)) {
                    continue;
                }

                const ontologyNamespace = omlRoot.namespace.replace(/^<|>$/g, '');
                const ontologyPrefix = omlRoot.prefix;
                const isLocal = normalizeUri(omlFileUri) === normalizedFileUri;

                // Check if this ontology is imported
                const importPrefix = importedNamespaces.get(ontologyNamespace);
                const alreadyImported = isLocal || !!importPrefix;
                const effectivePrefix = importPrefix || ontologyPrefix;

                // Apply include filters at file level
                if (!includeLocal && isLocal) continue;
                if (!includeImported && alreadyImported && !isLocal) continue;

                // Extract symbols from statements (using AST for proper type info)
                const statements = (omlRoot as any).ownedStatements || [];
                for (const stmt of statements) {
                    if (!stmt || !stmt.name) continue;

                    const astType = stmt.$type as string;
                    const omlInfo = AST_TYPE_TO_OML[astType];
                    if (!omlInfo) continue;

                    const symbolName = stmt.name as string;

                    // Filter by symbol type
                    if (targetType) {
                        // Handle 'entity' as special case (concepts, aspects, relation entities)
                        if (targetType === 'entity') {
                            if (!ENTITY_TYPES.includes(omlInfo.type)) continue;
                        } else if (omlInfo.type !== targetType) {
                            continue;
                        }
                    }

                    // Filter by query
                    if (queryLower && !symbolName.toLowerCase().includes(queryLower)) {
                        continue;
                    }

                    // Determine qualified name
                    const qualifiedName = isLocal ? symbolName : `${effectivePrefix}:${symbolName}`;
                    const needsImport = !isLocal && !alreadyImported;

                    suggestions.push({
                        name: symbolName,
                        qualifiedName,
                        type: omlInfo.type,
                        symbolKind: omlInfo.kind,
                        location: omlFileUri,
                        ontologyPrefix: effectivePrefix,
                        ontologyNamespace,
                        alreadyImported,
                        isLocal,
                        needsImport,
                    });

                    // Also include forward/reverse relations from RelationEntity
                    if (astType === 'RelationEntity') {
                        if (stmt.forwardRelation?.name) {
                            const fwdName = stmt.forwardRelation.name;
                            if (!targetType || targetType === 'forward_relation' || targetType === 'unreified_relation') {
                                if (!queryLower || fwdName.toLowerCase().includes(queryLower)) {
                                    suggestions.push({
                                        name: fwdName,
                                        qualifiedName: isLocal ? fwdName : `${effectivePrefix}:${fwdName}`,
                                        type: 'forward_relation',
                                        symbolKind: 6,
                                        location: omlFileUri,
                                        ontologyPrefix: effectivePrefix,
                                        ontologyNamespace,
                                        alreadyImported,
                                        isLocal,
                                        needsImport,
                                    });
                                }
                            }
                        }
                        if (stmt.reverseRelation?.name) {
                            const revName = stmt.reverseRelation.name;
                            if (!targetType || targetType === 'reverse_relation' || targetType === 'unreified_relation') {
                                if (!queryLower || revName.toLowerCase().includes(queryLower)) {
                                    suggestions.push({
                                        name: revName,
                                        qualifiedName: isLocal ? revName : `${effectivePrefix}:${revName}`,
                                        type: 'reverse_relation',
                                        symbolKind: 6,
                                        location: omlFileUri,
                                        ontologyPrefix: effectivePrefix,
                                        ontologyNamespace,
                                        alreadyImported,
                                        isLocal,
                                        needsImport,
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[suggest_oml_symbols] Error processing ${omlFileUri}:`, err);
                // Continue with other files
            }
        }

        // Sort suggestions: local first, then imported, then by name
        suggestions.sort((a, b) => {
            // Local first
            if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
            // Already imported second
            if (a.alreadyImported !== b.alreadyImported) return a.alreadyImported ? -1 : 1;
            // Exact match first
            if (queryLower) {
                const aExact = a.name.toLowerCase() === queryLower;
                const bExact = b.name.toLowerCase() === queryLower;
                if (aExact !== bExact) return aExact ? -1 : 1;
                // Starts with query
                const aStarts = a.name.toLowerCase().startsWith(queryLower);
                const bStarts = b.name.toLowerCase().startsWith(queryLower);
                if (aStarts !== bStarts) return aStarts ? -1 : 1;
            }
            // Alphabetical
            return a.name.localeCompare(b.name);
        });

        // Limit results
        const limited = suggestions.slice(0, maxResults);

        const result: SuggestSymbolsResult = {
            suggestions: limited,
            total: suggestions.length,
            query,
            filters: {
                symbolType,
                includeImported,
                includeLocal,
            },
        };

        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
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
 * Query workspace files via LSP over TCP
 * Uses a custom oml/workspaceFiles request that returns all indexed files
 */
async function queryWorkspaceFiles(): Promise<LspWorkspaceFile[] | null> {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let buffer = '';
        let contentLength = -1;
        const requestId = Date.now();

        const timeout = setTimeout(() => {
            client.destroy();
            resolve(null);
        }, 5000);

        client.on('connect', () => {
            // Send custom oml/workspaceFiles request
            const request = {
                jsonrpc: '2.0',
                id: requestId,
                method: 'oml/workspaceFiles',
                params: {},
            };
            const content = JSON.stringify(request);
            const message = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
            client.write(message);
        });

        client.on('data', (data) => {
            buffer += data.toString();

            // Parse LSP messages
            while (true) {
                if (contentLength === -1) {
                    const headerEnd = buffer.indexOf('\r\n\r\n');
                    if (headerEnd === -1) break;

                    const header = buffer.substring(0, headerEnd);
                    const match = header.match(/Content-Length: (\d+)/i);
                    if (!match) break;

                    contentLength = parseInt(match[1], 10);
                    buffer = buffer.substring(headerEnd + 4);
                }

                if (buffer.length < contentLength) break;

                const content = buffer.substring(0, contentLength);
                buffer = buffer.substring(contentLength);
                contentLength = -1;

                try {
                    const response = JSON.parse(content);
                    if (response.id === requestId) {
                        clearTimeout(timeout);
                        client.destroy();
                        resolve(response.result || []);
                        return;
                    }
                } catch {
                    // Ignore parse errors, continue reading
                }
            }
        });

        client.on('error', () => {
            clearTimeout(timeout);
            resolve(null);
        });

        client.on('close', () => {
            clearTimeout(timeout);
        });

        client.connect(LSP_PORT, '127.0.0.1');
    });
}

/**
 * Normalize URI for comparison
 */
function normalizeUri(uri: string): string {
    return uri.toLowerCase().replace(/\\/g, '/');
}
