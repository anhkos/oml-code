/**
 * Import Resolution Module
 * 
 * Handles:
 * - Extracting imports from OML descriptions
 * - Resolving import aliases to canonical prefixes
 * - Finding imported files in the workspace
 * - Building import prefix maps
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger, getLogger } from '../common/logger.js';
import { ImportPrefixMap } from './types.js';
import { Description } from '../../../generated/ast.js';

/**
 * Extract and resolve import prefixes from a description AST
 * Builds a map from user-specified aliases to canonical prefixes
 *
 * @param description Parsed OML description AST
 * @param logger Optional logger instance
 * @returns Map of import aliases to canonical prefixes
 */
export function buildImportPrefixMap(
    description: Description,
    logger: Logger = getLogger('import-resolver'),
): ImportPrefixMap {
    const importPrefixMap: ImportPrefixMap = {};

    for (const imp of description.ownedImports || []) {
        if (!imp.prefix) {
            continue;
        }

        logger.debug(`Processing import`, { prefix: imp.prefix, kind: imp.kind });

        // Try to get canonical prefix from resolved reference
        let canonicalPrefix: string | undefined;
        const importedOntology = imp.imported?.ref as { prefix?: string } | undefined;
        canonicalPrefix = importedOntology?.prefix;

        // If reference not resolved, try to extract from namespace IRI
        // Namespace format: <https://example.com/path/vocabname#> -> vocabname
        if (!canonicalPrefix && imp.imported?.$refText) {
            const namespace = imp.imported.$refText;
            const match = namespace.match(/\/([^/#]+)[#/]>?$/);
            if (match) {
                canonicalPrefix = match[1];
                logger.debug(`Extracted canonical prefix from namespace`, {
                    namespace,
                    prefix: canonicalPrefix,
                });
            }
        }

        if (canonicalPrefix && canonicalPrefix !== imp.prefix) {
            importPrefixMap[imp.prefix] = canonicalPrefix;
            logger.debug(`Mapped import alias`, { alias: imp.prefix, canonical: canonicalPrefix });
        }
    }

    return importPrefixMap;
}

/**
 * Resolve an import alias in a qualified name
 * Example: "ent:Actor" -> "entity:Actor" using importPrefixMap
 *
 * @param qualifiedName Name with prefix (e.g., "ent:Actor")
 * @param importPrefixMap Map of aliases to canonical prefixes
 * @returns Resolved qualified name
 */
export function resolveImportAlias(qualifiedName: string, importPrefixMap: ImportPrefixMap): string {
    const colonIndex = qualifiedName.indexOf(':');
    if (colonIndex === -1) return qualifiedName;

    const prefix = qualifiedName.substring(0, colonIndex);
    const name = qualifiedName.substring(colonIndex + 1);
    const canonicalPrefix = importPrefixMap[prefix];

    return canonicalPrefix ? `${canonicalPrefix}:${name}` : qualifiedName;
}

/**
 * Normalize an array of types by resolving import aliases
 *
 * @param types Array of type names (may have aliases)
 * @param importPrefixMap Map of aliases to canonical prefixes
 * @returns Array with aliases resolved
 */
export function normalizeTypes(types: string[], importPrefixMap: ImportPrefixMap): string[] {
    return types.map((type) => resolveImportAlias(type, importPrefixMap));
}

/**
 * Get canonical qualified name from a resolved concept reference
 * Tries to use ref information first, falls back to source text
 *
 * @param typeRef Reference object from AST
 * @param importPrefixMap Map for alias resolution
 * @param logger Optional logger
 * @returns Canonical qualified name
 */
export function getCanonicalType(
    typeRef: { ref?: { name?: string; $container?: { prefix?: string } }; $refText?: string },
    importPrefixMap: ImportPrefixMap,
    logger: Logger = getLogger('import-resolver'),
): string {
    const sourceText = typeRef.$refText || 'Unknown';
    logger.debug(`Resolving type`, { sourceText, hasRef: !!typeRef.ref });

    // Try to get canonical name from resolved reference
    if (typeRef.ref?.name && typeRef.ref.$container) {
        const vocabPrefix = (typeRef.ref.$container as any).prefix;
        logger.debug(`Got ref info`, { refName: typeRef.ref.name, vocabPrefix });
        if (vocabPrefix) {
            return `${vocabPrefix}:${typeRef.ref.name}`;
        }
    }

    // Fallback to source text with alias resolution
    const resolved = resolveImportAlias(sourceText, importPrefixMap);
    logger.debug(`Resolved type`, { original: sourceText, resolved });
    return resolved;
}

/**
 * Scan directory recursively for OML files
 * Used for finding imported vocabularies
 *
 * @param dir Directory to scan
 * @param maxDepth Maximum recursion depth
 * @param currentDepth Current depth (for recursion)
 * @param logger Optional logger
 * @returns Array of .oml file paths
 */
export function scanForOmlFiles(
    dir: string,
    maxDepth: number = 5,
    currentDepth: number = 0,
    logger: Logger = getLogger('import-resolver'),
): string[] {
    const omlFiles: string[] = [];

    if (currentDepth >= maxDepth) {
        logger.debug(`Reached max scan depth`, { dir, maxDepth });
        return omlFiles;
    }

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'build') {
                omlFiles.push(...scanForOmlFiles(fullPath, maxDepth, currentDepth + 1, logger));
            } else if (entry.isFile() && entry.name.endsWith('.oml')) {
                omlFiles.push(fullPath);
            }
        }
    } catch (error) {
        logger.warn(`Failed to scan directory`, { dir, error: String(error) });
    }

    return omlFiles;
}

/**
 * Find files that match import namespaces
 * Searches workspace for vocabulary files that define the imported namespaces
 *
 * @param namespaces Array of namespace URIs to find
 * @param workspaceRoot Root directory to search from
 * @param logger Optional logger
 * @returns Map of namespace to file path
 */
export function findImportedFiles(
    namespaces: string[],
    workspaceRoot: string,
    logger: Logger = getLogger('import-resolver'),
): Map<string, string> {
    const importedFiles = new Map<string, string>();

    if (namespaces.length === 0) {
        return importedFiles;
    }

    logger.info(`Searching for ${namespaces.length} imported namespaces`, { workspaceRoot });

    const omlFiles = scanForOmlFiles(workspaceRoot, 5, 0, logger);
    logger.debug(`Found ${omlFiles.length} OML files in workspace`);

    for (const namespace of namespaces) {
        for (const omlFile of omlFiles) {
            try {
                const content = fs.readFileSync(omlFile, 'utf-8');
                // Quick regex check for namespace (avoid parsing all files)
                if (content.includes(namespace)) {
                    importedFiles.set(namespace, omlFile);
                    logger.debug(`Found matching file for namespace`, { namespace, file: omlFile });
                    break;
                }
            } catch {
                // Skip unreadable files
            }
        }
    }

    return importedFiles;
}
