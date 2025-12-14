import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Name of the term to delete'),
};

export const deleteTermTool = {
    name: 'delete_term' as const,
    description: 'Deletes a term (scalar, entity, property, or relation) from the vocabulary.',
    paramsSchema,
};

export const deleteTermHandler = async ({ ontology, term }: { ontology: string; term: string }) => {
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

        return {
            content: [
                { type: 'text' as const, text: `✓ Deleted term "${term}"` },
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
