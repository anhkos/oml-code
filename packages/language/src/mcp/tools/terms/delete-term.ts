import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, findSymbolReferences, formatImpactWarning } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the target vocabulary'),
    term: z.string().describe('Name of the term to delete'),
    force: z.boolean().optional().describe('Force deletion even if the term is referenced elsewhere. Default: false'),
};

export const deleteTermTool = {
    name: 'delete_term' as const,
    description: `Deletes a term (scalar, entity, property, or relation) from the vocabulary.

⚠️ This tool performs IMPACT ANALYSIS before deletion:
- Scans the workspace for files that reference this term
- Shows specializations, instances, restrictions, and other usages
- Without force=true, will warn about impacts but still delete

Use force=true to suppress the impact warning.`,
    paramsSchema,
};

export const deleteTermHandler = async ({ ontology, term, force = false }: { ontology: string; term: string; force?: boolean }) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol } = await loadVocabularyDocument(ontology);
        const node = findTerm(vocabulary, term);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Term "${term}" was not found in the vocabulary.` },
                ],
            };
        }

        // Perform impact analysis
        const impact = await findSymbolReferences(term, filePath, {
            searchSpecializations: true,
            searchInstances: true,
            searchPropertyUsage: true,
        });

        const startOffset = node.$cstNode.offset;
        const endOffset = node.$cstNode.end;

        // Expand start backward to remove surrounding blank lines/indentation
        let adjustedStart = startOffset;
        while (adjustedStart > 0 && /[ \t]/.test(text[adjustedStart - 1])) {
            adjustedStart -= 1;
        }
        if (adjustedStart > 0 && text[adjustedStart - 1] === '\n') {
            adjustedStart -= 1;
            if (adjustedStart > 0 && text[adjustedStart - 1] === '\r') {
                adjustedStart -= 1;
            }
        }

        const newContent = (text.slice(0, adjustedStart) + text.slice(endOffset))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeFileAndNotify(filePath, fileUri, newContent);

        // Build result message
        let message = `✓ Deleted term "${term}"`;
        
        if (!force && impact.references.length > 0) {
            message += formatImpactWarning(impact);
        } else if (impact.references.length === 0) {
            message += '\n\n✓ No external references found - safe to delete.';
        }

        return {
            content: [
                { type: 'text' as const, text: message },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error deleting term: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
