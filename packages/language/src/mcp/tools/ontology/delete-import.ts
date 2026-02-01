import { z } from 'zod';
import * as fs from 'fs';
import { pathToFileUri, fileUriToPath, writeFileAndNotify } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the ontology where the import will be removed'),
    prefix: z.string().describe('Prefix of the import to remove (e.g., "base", "requirement")'),
};

export const deleteImportTool = {
    name: 'delete_import' as const,
    description: `Removes an import statement from an ontology by its prefix.

WARNING: Removing an import may break references in this file that use that prefix.
Consider running validate_oml after this operation to check for broken references.`,
    paramsSchema,
};

export const deleteImportMetadata = {
    id: 'delete_import',
    displayName: 'Delete Import',
    layer: 'core' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Remove an import statement from an ontology',
    description: 'Removes an import statement from an ontology by its prefix.',
    tags: ['import-management', 'ontology-structure', 'safety'],
    dependencies: ['validate_oml'],
    addedDate: '2024-01-01',
};

export const deleteImportHandler = async (
    { ontology, prefix }: { ontology: string; prefix: string }
) => {
    try {
        const fileUri = pathToFileUri(ontology);
        const filePath = fileUriToPath(fileUri);

        if (!fs.existsSync(filePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Ontology not found at ${filePath}` }],
            };
        }

        const text = fs.readFileSync(filePath, 'utf-8');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';

        // Match import patterns: extends/uses/includes <namespace> as prefix
        // Handle both escaped (^prefix) and unescaped prefixes
        const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const importPattern = new RegExp(
            `^[ \\t]*(extends|uses|includes)\\s+<[^>]+>\\s+as\\s+\\^?${escapedPrefix}\\s*$`,
            'gm'
        );

        const matches = text.match(importPattern);
        if (!matches || matches.length === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `No import with prefix "${prefix}" found in ontology.` }],
            };
        }

        // Remove the import line(s) and clean up extra blank lines
        let newContent = text.replace(importPattern, '');
        newContent = newContent.replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Removed import for prefix "${prefix}"\n\n⚠ Run validate_oml to check for broken references.` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing import: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
