import { z } from 'zod';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';
import { loadAnyOntologyDocument, writeFileAndNotify, getWorkspaceRoot, LSP_BRIDGE_PORT } from '../common.js';

// Well-known external imports with their IRIs (not discoverable from workspace)
const WELL_KNOWN_IMPORTS: Record<string, { iri: string }> = {
    dc: { iri: 'http://purl.org/dc/elements/1.1/' },
    xsd: { iri: 'http://www.w3.org/2001/XMLSchema#' },
};

// OML reserved keywords that must be escaped with ^ when used as prefixes
const RESERVED_KEYWORDS = new Set([
    'vocabulary', 'bundle', 'description',
    'extends', 'uses', 'includes',
    'aspect', 'concept', 'relation', 'entity', 'scalar',
    'instance', 'property', 'annotation',
    'rule', 'builtin',
    'forward', 'reverse',
    'from', 'to',
    'functional', 'inverse', 'symmetric', 'asymmetric', 'reflexive', 'irreflexive', 'transitive',
    'restricts', 'all', 'some', 'exactly', 'min', 'max',
    'key', 'oneOf',
    'ref', 'self',
    'sameAs', 'differentFrom',
    'true', 'false',
]);

/**
 * Escape a prefix if it's a reserved keyword
 */
function escapePrefix(prefix: string): string {
    return RESERVED_KEYWORDS.has(prefix) ? `^${prefix}` : prefix;
}

export const ensureImportsTool = {
    name: 'ensure_imports' as const,
    description: 'Ensures required imports exist based on actually used prefixes in the file. Automatically discovers workspace vocabularies by their prefix and adds appropriate imports. Works for both vocabularies (uses "extends") and descriptions (uses "uses"). Handles well-known prefixes (dc, xsd) and any prefix defined in the workspace.',
    paramsSchema: {
        ontology: z.string().describe('Path to the ontology file (vocabulary or description) to update'),
    }
};

/**
 * Query workspace files via LSP to discover all OML files
 */
async function queryWorkspaceFiles(): Promise<string[] | null> {
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
            while (true) {
                if (contentLength < 0) {
                    const headerEnd = buffer.indexOf('\r\n\r\n');
                    if (headerEnd < 0) break;
                    const headerPart = buffer.slice(0, headerEnd);
                    const match = headerPart.match(/Content-Length:\s*(\d+)/i);
                    if (!match) {
                        client.destroy();
                        resolve(null);
                        return;
                    }
                    contentLength = parseInt(match[1], 10);
                    buffer = buffer.slice(headerEnd + 4);
                }
                if (buffer.length < contentLength) break;
                const jsonPart = buffer.slice(0, contentLength);
                buffer = buffer.slice(contentLength);
                contentLength = -1;
                try {
                    const response = JSON.parse(jsonPart);
                    if (response.id === requestId && response.result) {
                        clearTimeout(timeout);
                        client.destroy();
                        const files = (response.result as { uri: string }[]).filter(f => f.uri.endsWith('.oml')).map(f => f.uri);
                        resolve(files);
                        return;
                    }
                } catch {
                    // continue parsing
                }
            }
        });

        client.on('error', () => {
            clearTimeout(timeout);
            resolve(null);
        });

        client.connect({ port: LSP_BRIDGE_PORT });
    });
}

/**
 * Fallback: scan workspace directory for .oml files
 */
function scanWorkspaceForOmlFiles(workspaceRoot: string): string[] {
    const omlFiles: string[] = [];
    
    function scanDir(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'build') {
                    scanDir(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.oml')) {
                    omlFiles.push(URI.file(fullPath).toString());
                }
            }
        } catch {
            // Skip directories we can't read
        }
    }
    
    scanDir(workspaceRoot);
    return omlFiles;
}

/**
 * Build a map of prefix -> namespace IRI from workspace vocabularies
 */
async function buildWorkspacePrefixMap(): Promise<Map<string, string>> {
    const prefixMap = new Map<string, string>();
    
    // Try LSP first, fall back to filesystem scan
    let omlFileUris = await queryWorkspaceFiles();
    if (!omlFileUris) {
        console.error('[ensure_imports] LSP unavailable, scanning filesystem');
        omlFileUris = scanWorkspaceForOmlFiles(getWorkspaceRoot());
    }
    
    const services = createOmlServices(NodeFileSystem);
    
    for (const omlFileUri of omlFileUris) {
        try {
            const omlDoc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(omlFileUri));
            await services.shared.workspace.DocumentBuilder.build([omlDoc], { validation: false });
            
            const root = omlDoc.parseResult.value;
            if (isVocabulary(root) || isDescription(root) || isVocabularyBundle(root) || isDescriptionBundle(root)) {
                const prefix = root.prefix.replace(/^\^/, ''); // Strip escape char
                const namespace = root.namespace.replace(/^<|>$/g, '');
                if (prefix && namespace) {
                    prefixMap.set(prefix, namespace);
                }
            }
        } catch (err) {
            console.error(`[ensure_imports] Error parsing ${omlFileUri}:`, err);
        }
    }
    
    return prefixMap;
}

/**
 * Build a map of symbol name -> namespace IRI from workspace vocabularies
 * This allows resolving symbols even when using custom prefix aliases
 */
async function buildSymbolToNamespaceMap(): Promise<Map<string, string>> {
    const symbolMap = new Map<string, string>();
    
    let omlFileUris = await queryWorkspaceFiles();
    if (!omlFileUris) {
        omlFileUris = scanWorkspaceForOmlFiles(getWorkspaceRoot());
    }
    
    const services = createOmlServices(NodeFileSystem);
    
    for (const omlFileUri of omlFileUris) {
        try {
            const omlDoc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(omlFileUri));
            await services.shared.workspace.DocumentBuilder.build([omlDoc], { validation: false });
            
            const root = omlDoc.parseResult.value;
            if (isVocabulary(root) || isDescription(root) || isVocabularyBundle(root) || isDescriptionBundle(root)) {
                const namespace = root.namespace.replace(/^<|>$/g, '');
                
                // Extract all named statements (concepts, aspects, relations, properties, instances)
                const statements = (root as any).ownedStatements || [];
                for (const stmt of statements) {
                    if (stmt && stmt.name) {
                        // Map symbol name to its vocabulary's namespace
                        // Note: if same symbol exists in multiple vocabs, last one wins
                        // This is acceptable since we use this as a fallback
                        symbolMap.set(stmt.name, namespace);
                        
                        // Also index forward/reverse relations from RelationEntity
                        if (stmt.$type === 'RelationEntity') {
                            if (stmt.forwardRelation?.name) {
                                symbolMap.set(stmt.forwardRelation.name, namespace);
                            }
                            if (stmt.reverseRelation?.name) {
                                symbolMap.set(stmt.reverseRelation.name, namespace);
                            }
                        }
                        // And from UnreifiedRelation
                        if (stmt.$type === 'UnreifiedRelation') {
                            if (stmt.reverseRelation?.name) {
                                symbolMap.set(stmt.reverseRelation.name, namespace);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`[ensure_imports] Error building symbol map from ${omlFileUri}:`, err);
        }
    }
    
    return symbolMap;
}

export const ensureImportsHandler = async ({ ontology }: { ontology: string }) => {
    try {
        const { text, filePath, fileUri, eol, indent, root, importKeyword, ontologyType, prefix: localPrefix } = await loadAnyOntologyDocument(ontology);

        // Detect used qualified names anywhere in the file: prefix:SymbolName
        // We need both the prefix AND the symbol name to resolve custom aliases
        const usedQualifiedNames: Array<{ prefix: string; symbolName: string }> = [];
        const anyPrefixRegex = /@?([A-Za-z][\w-]*):([A-Za-z][\w-]*)/g;
        let m: RegExpExecArray | null;
        while ((m = anyPrefixRegex.exec(text)) !== null) {
            const prefix = m[1];
            const symbolName = m[2];
            // Skip local prefix references
            if (prefix !== localPrefix && prefix !== localPrefix?.replace(/^\^/, '')) {
                usedQualifiedNames.push({ prefix, symbolName });
            }
        }

        // AST-driven hints: if scalar properties reference xsd types, ensure xsd prefix
        try {
            const anyXsdUse = hasXsdUsage(root);
            if (anyXsdUse) usedQualifiedNames.push({ prefix: 'xsd', symbolName: 'string' });
        } catch {}

        if (usedQualifiedNames.length === 0) {
            return { content: [{ type: 'text' as const, text: '✓ No external prefixes used, imports already satisfied' }] };
        }

        // Build workspace data: prefix -> namespace AND symbol -> namespace
        const workspacePrefixes = await buildWorkspacePrefixMap();
        const symbolToNamespace = await buildSymbolToNamespaceMap();
        
        // Combine well-known and workspace prefixes
        const allKnownPrefixes = new Map<string, string>();
        for (const [prefix, info] of Object.entries(WELL_KNOWN_IMPORTS)) {
            allKnownPrefixes.set(prefix, info.iri);
        }
        for (const [prefix, namespace] of workspacePrefixes) {
            allKnownPrefixes.set(prefix, namespace);
        }

        // Build missing import lines - deduplicate by prefix
        const importsToAdd = new Map<string, string>(); // prefix -> namespace
        const unresolvedPrefixes: string[] = [];
        
        for (const { prefix, symbolName } of usedQualifiedNames) {
            // Skip if we already have an import for this prefix
            if (importsToAdd.has(prefix)) continue;
            
            // Check if import already exists by prefix
            const prefixPattern = new RegExp(`(extends|includes|uses)\\s*<[^>]+>\\s*as\\s*\\^?${escapeRegex(prefix)}\\b`, 'i');
            if (prefixPattern.test(text)) {
                continue;
            }
            
            // First, try to find by the prefix directly (exact match)
            let namespace = allKnownPrefixes.get(prefix);
            
            // If not found by prefix, try to find by symbol name
            if (!namespace) {
                namespace = symbolToNamespace.get(symbolName);
            }
            
            if (!namespace) {
                if (!unresolvedPrefixes.includes(prefix)) {
                    unresolvedPrefixes.push(prefix);
                }
                continue;
            }
            
            // Check if this namespace is already imported (possibly with a different alias)
            const iriPattern = new RegExp(`(extends|includes|uses)\\s*<${escapeRegex(namespace)}>`, 'i');
            if (iriPattern.test(text)) {
                continue;
            }
            
            importsToAdd.set(prefix, namespace);
        }

        // Generate import lines
        const missingImportLines: string[] = [];
        for (const [prefix, namespace] of importsToAdd) {
            const escapedPrefix = escapePrefix(prefix);
            missingImportLines.push(`${indent}${importKeyword} <${namespace}> as ${escapedPrefix}`);
        }

        if (missingImportLines.length === 0 && unresolvedPrefixes.length === 0) {
            return { content: [{ type: 'text' as const, text: '✓ Imports already satisfied' }] };
        }

        if (missingImportLines.length === 0 && unresolvedPrefixes.length > 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Cannot resolve prefixes: ${unresolvedPrefixes.join(', ')}. These prefixes are not defined in the workspace or well-known imports.` }]
            };
        }

        // Insert missing imports just inside the ontology block, after the opening brace
        const insertPos = findInsertPositionAfterOpeningBrace(text);
        const before = text.slice(0, insertPos);
        const after = text.slice(insertPos);
        const newContent = before + missingImportLines.join(eol) + eol + after;

        await writeFileAndNotify(filePath, fileUri, newContent);

        let resultText = `✓ Added imports to ${ontologyType}: ${missingImportLines.map(l => l.trim()).join(', ')}`;
        if (unresolvedPrefixes.length > 0) {
            resultText += `\n⚠ Could not resolve prefixes: ${unresolvedPrefixes.join(', ')}`;
        }

        return {
            content: [{ type: 'text' as const, text: resultText }]
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error ensuring imports: ${error instanceof Error ? error.message : String(error)}` }]
        };
    }
};

function hasXsdUsage(ontology: any): boolean {
    try {
        // Check ownedStatements for vocabularies (which contain terms like ScalarProperty)
        const statements = (ontology.ownedStatements || []) as any[];
        for (const stmt of statements) {
            if (stmt.$type === 'ScalarProperty' && stmt.scalarType) {
                const name = stmt.scalarType?.$refText || '';
                if (/^xsd:/i.test(name)) return true;
            }
        }
    } catch {}
    return false;
}

function findInsertPositionAfterOpeningBrace(text: string): number {
    // Find first '{' of the vocabulary and insert after the newline
    const braceIndex = text.indexOf('{');
    if (braceIndex < 0) return 0;
    const nextNewline = text.indexOf('\n', braceIndex);
    return nextNewline >= 0 ? nextNewline + 1 : braceIndex + 1;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
