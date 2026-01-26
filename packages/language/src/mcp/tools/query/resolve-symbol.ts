/**
 * Symbol resolution and disambiguation utilities.
 * Helps tools resolve unqualified names to qualified names,
 * with automatic disambiguation when multiple matches exist.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';
import { fileUriToPath, getFreshDocument, getWorkspaceRoot, LSP_BRIDGE_PORT } from '../common.js';
import { OmlSymbolType, ENTITY_TYPES } from './suggest-oml-symbols.js';

const LSP_PORT = LSP_BRIDGE_PORT;

/**
 * Result of symbol resolution
 */
export interface SymbolResolution {
    /** Whether resolution succeeded */
    success: boolean;
    /** The resolved qualified name (if success) */
    qualifiedName?: string;
    /** The prefix to use (if success) */
    prefix?: string;
    /** Whether an import is needed */
    needsImport?: boolean;
    /** The namespace to import (if needsImport) */
    importNamespace?: string;
    /** Error message (if not success) */
    error?: string;
    /** Disambiguation suggestions (if ambiguous) */
    suggestions?: Array<{
        qualifiedName: string;
        type: OmlSymbolType;
        location: string;
        ontologyPrefix: string;
        ontologyNamespace: string;
    }>;
}

/**
 * Map AST $type to OML type name
 */
const AST_TYPE_TO_OML: Record<string, OmlSymbolType> = {
    'Concept': 'concept',
    'Aspect': 'aspect',
    'RelationEntity': 'relation_entity',
    'UnreifiedRelation': 'unreified_relation',
    'ForwardRelation': 'forward_relation',
    'ReverseRelation': 'reverse_relation',
    'Scalar': 'scalar',
    'ScalarProperty': 'scalar_property',
    'AnnotationProperty': 'annotation_property',
    'ConceptInstance': 'concept_instance',
    'RelationInstance': 'relation_instance',
    'Rule': 'rule',
    'BuiltIn': 'builtin',
};

/**
 * Query workspace files via LSP
 */
async function queryWorkspaceFiles(): Promise<{ uri: string }[] | null> {
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
                } catch { /* ignore */ }
            }
        });

        client.on('error', () => {
            clearTimeout(timeout);
            resolve(null);
        });

        client.connect(LSP_PORT, '127.0.0.1');
    });
}

/**
 * Scan workspace for OML files (fallback when LSP unavailable)
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
        } catch { /* skip unreadable */ }
    }
    scanDir(workspaceRoot);
    return omlFiles;
}

/**
 * Resolve a symbol name to its qualified form.
 * 
 * @param name - The symbol name (can be qualified like "prefix:Name" or simple like "Name")
 * @param contextFileUri - The file URI where the symbol is being used
 * @param expectedTypes - Optional filter for symbol types (e.g., ['concept', 'aspect'] for entities)
 * @returns Resolution result with qualified name or disambiguation suggestions
 */
export async function resolveSymbolName(
    name: string,
    contextFileUri: string,
    expectedTypes?: OmlSymbolType[]
): Promise<SymbolResolution> {
    // If qualified, validate the symbol exists and return import info with the user's chosen prefix
    if (name.includes(':')) {
        const [givenPrefix, symbolName] = name.split(':', 2);
        
        // Search workspace for the symbol to find which vocabulary it's in
        const unqualifiedResult = await resolveSymbolName(symbolName, contextFileUri, expectedTypes);
        
        if (!unqualifiedResult.success) {
            // Symbol doesn't exist at all
            return {
                success: false,
                error: `Symbol "${symbolName}" not found in workspace. Check the name or use suggest_oml_symbols to discover available symbols.`,
                suggestions: unqualifiedResult.suggestions,
            };
        }
        
        // Symbol found - return success with the user's chosen prefix, but the correct namespace for import
        return {
            success: true,
            qualifiedName: name, // Keep user's prefix choice (e.g., ent:Actor)
            prefix: givenPrefix, // User's chosen prefix
            needsImport: unqualifiedResult.needsImport,
            importNamespace: unqualifiedResult.importNamespace, // The actual namespace to import
        };
    }

    try {
        const filePath = fileUriToPath(contextFileUri);
        if (!fs.existsSync(filePath)) {
            return { success: false, error: `Context file not found: ${filePath}` };
        }

        const services = createOmlServices(NodeFileSystem);
        const document = await getFreshDocument(services, contextFileUri);
        const root = document.parseResult.value;

        if (!isVocabulary(root) && !isDescription(root) && !isVocabularyBundle(root) && !isDescriptionBundle(root)) {
            return { success: false, error: 'Context file must be a vocabulary or description' };
        }

        const currentNamespace = root.namespace.replace(/^<|>$/g, '');
        const currentPrefix = root.prefix;

        // Build map of imported namespaces -> prefixes
        const importedNamespaces = new Map<string, string>();
        importedNamespaces.set(currentNamespace, currentPrefix);
        
        for (const imp of root.ownedImports || []) {
            const importedRef = imp.imported?.ref;
            if (importedRef?.namespace) {
                const ns = importedRef.namespace.replace(/^<|>$/g, '');
                const prefix = imp.prefix || importedRef.prefix;
                importedNamespaces.set(ns, prefix);
            }
        }

        // Get workspace files
        let omlFileUris = await queryWorkspaceFiles();
        if (!omlFileUris) {
            omlFileUris = scanWorkspaceForOmlFiles(getWorkspaceRoot()).map(uri => ({ uri }));
        }

        const normalizedContextUri = contextFileUri.toLowerCase().replace(/\\/g, '/');

        // Collect all matching symbols
        const matches: Array<{
            qualifiedName: string;
            type: OmlSymbolType;
            location: string;
            ontologyPrefix: string;
            ontologyNamespace: string;
            isLocal: boolean;
            alreadyImported: boolean;
        }> = [];

        for (const { uri: omlFileUri } of omlFileUris) {
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
                const isLocal = omlFileUri.toLowerCase().replace(/\\/g, '/') === normalizedContextUri;

                const importPrefix = importedNamespaces.get(ontologyNamespace);
                const alreadyImported = isLocal || !!importPrefix;
                const effectivePrefix = importPrefix || ontologyPrefix;

                // Extract symbols
                const statements = (omlRoot as any).ownedStatements || [];
                for (const stmt of statements) {
                    if (!stmt || !stmt.name) continue;

                    const astType = stmt.$type as string;
                    const omlType = AST_TYPE_TO_OML[astType];
                    if (!omlType) continue;

                    const symbolName = stmt.name as string;
                    if (symbolName !== name) continue;

                    // Filter by expected types
                    if (expectedTypes && expectedTypes.length > 0) {
                        // Handle 'entity' as special case
                        if (expectedTypes.includes('entity' as OmlSymbolType)) {
                            if (!ENTITY_TYPES.includes(omlType)) continue;
                        } else if (!expectedTypes.includes(omlType)) {
                            continue;
                        }
                    }

                    const qualifiedName = isLocal ? symbolName : `${effectivePrefix}:${symbolName}`;

                    matches.push({
                        qualifiedName,
                        type: omlType,
                        location: omlFileUri,
                        ontologyPrefix: effectivePrefix,
                        ontologyNamespace,
                        isLocal,
                        alreadyImported,
                    });
                }
            } catch (err) {
                console.error(`[resolveSymbolName] Error processing ${omlFileUri}:`, err);
            }
        }

        // No matches found
        if (matches.length === 0) {
            const typeHint = expectedTypes ? ` of type ${expectedTypes.join('/')}` : '';
            return {
                success: false,
                error: `Symbol "${name}"${typeHint} not found in workspace. Use suggest_oml_symbols to discover available symbols.`,
            };
        }

        // Exactly one match - success!
        if (matches.length === 1) {
            const match = matches[0];
            return {
                success: true,
                qualifiedName: match.qualifiedName,
                prefix: match.ontologyPrefix,
                needsImport: !match.alreadyImported,
                importNamespace: match.alreadyImported ? undefined : match.ontologyNamespace,
            };
        }

        // Multiple matches - disambiguation needed
        // Sort: local first, then imported, then by prefix
        matches.sort((a, b) => {
            if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
            if (a.alreadyImported !== b.alreadyImported) return a.alreadyImported ? -1 : 1;
            return a.ontologyPrefix.localeCompare(b.ontologyPrefix);
        });

        return {
            success: false,
            error: `Ambiguous symbol "${name}" - found ${matches.length} matches. Please use a qualified name (prefix:Name) to disambiguate.`,
            suggestions: matches.map(m => ({
                qualifiedName: m.qualifiedName,
                type: m.type,
                location: m.location,
                ontologyPrefix: m.ontologyPrefix,
                ontologyNamespace: m.ontologyNamespace,
            })),
        };

    } catch (error) {
        return {
            success: false,
            error: `Error resolving symbol: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Resolve multiple symbol names at once.
 * Returns an error result if any symbol is ambiguous or not found.
 */
export async function resolveSymbolNames(
    names: string[],
    contextFileUri: string,
    expectedTypes?: OmlSymbolType[]
): Promise<{
    success: boolean;
    resolved?: Map<string, SymbolResolution>;
    error?: string;
    suggestions?: Array<{ original: string; suggestions: SymbolResolution['suggestions'] }>;
}> {
    const resolved = new Map<string, SymbolResolution>();
    const errors: string[] = [];
    const allSuggestions: Array<{ original: string; suggestions: SymbolResolution['suggestions'] }> = [];

    for (const name of names) {
        const resolution = await resolveSymbolName(name, contextFileUri, expectedTypes);
        resolved.set(name, resolution);

        if (!resolution.success) {
            errors.push(`${name}: ${resolution.error}`);
            if (resolution.suggestions) {
                allSuggestions.push({ original: name, suggestions: resolution.suggestions });
            }
        }
    }

    if (errors.length > 0) {
        return {
            success: false,
            resolved,
            error: errors.join('\n'),
            suggestions: allSuggestions.length > 0 ? allSuggestions : undefined,
        };
    }

    return { success: true, resolved };
}

/**
 * Format disambiguation suggestions as a user-friendly error message.
 */
export function formatDisambiguationError(
    symbolName: string,
    suggestions: SymbolResolution['suggestions']
): string {
    if (!suggestions || suggestions.length === 0) {
        return `Symbol "${symbolName}" not found.`;
    }

    const lines = [
        `Ambiguous symbol "${symbolName}" - multiple matches found:`,
        '',
    ];

    for (const s of suggestions) {
        lines.push(`  • ${s.qualifiedName} (${s.type}) from ${s.ontologyPrefix}`);
    }

    lines.push('');
    lines.push('Please use a qualified name (prefix:Name) to specify which one you mean.');

    return lines.join('\n');
}

/**
 * Check if symbol resolution returned an ambiguity error and format it appropriately.
 * @param resolution - The resolution result
 * @param symbolName - The original symbol name that was being resolved
 * @param context - Optional context for the error message (e.g., "domain entity", "source entity")
 */
export function createResolutionErrorResult(resolution: SymbolResolution, symbolName: string, context?: string): {
    isError: true;
    content: Array<{ type: 'text'; text: string }>;
} {
    const contextPrefix = context ? `Error resolving ${context}: ` : '';
    const errorText = resolution.suggestions
        ? formatDisambiguationError(symbolName, resolution.suggestions)
        : resolution.error || `Failed to resolve symbol "${symbolName}"`;

    return {
        isError: true,
        content: [{ type: 'text' as const, text: `${contextPrefix}${errorText}` }],
    };
}
