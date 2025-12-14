import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Term whose specialization will be updated'),
    superTerm: z.string().describe('Super term to remove'),
};

export const deleteSpecializationTool = {
    name: 'delete_specialization' as const,
    description: 'Removes a single super term from a term’s specialization clause.',
    paramsSchema,
};

function extractSpecialization(termText: string) {
    const idx = termText.indexOf('<');
    if (idx === -1) return { exists: false } as const;

    let end = termText.length;
    const nextBracket = termText.indexOf('[', idx + 1);
    const nextEquals = termText.indexOf('=', idx + 1);
    if (nextBracket !== -1) end = Math.min(end, nextBracket);
    if (nextEquals !== -1) end = Math.min(end, nextEquals);

    const segment = termText.slice(idx + 1, end).trim();
    const items = segment.length === 0 ? [] : segment.split(',').map((s) => s.trim()).filter(Boolean);

    return { exists: true, start: idx, end, items } as const;
}

export const deleteSpecializationHandler = async ({ ontology, term, superTerm }: { ontology: string; term: string; superTerm: string }) => {
    try {
        const { vocabulary, filePath, fileUri, text } = await loadVocabularyDocument(ontology);
        const node = findTerm(vocabulary, term);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Term "${term}" was not found in the vocabulary.` },
                ],
            };
        }

        const termText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        const spec = extractSpecialization(termText);

        if (!spec.exists) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Term "${term}" has no specialization clause to modify.` },
                ],
            };
        }

        const remaining = spec.items.filter((item) => item !== superTerm);
        if (remaining.length === spec.items.length) {
            return {
                isError: true,
                content: [
                    { type: 'text' as const, text: `Super term "${superTerm}" was not found in the specialization list.` },
                ],
            };
        }

        let updatedTermText: string;
        if (remaining.length === 0) {
            // Remove the entire specialization segment
            let removalStart = spec.start;
            while (removalStart > 0 && /[ \t]/.test(termText[removalStart - 1])) {
                removalStart -= 1;
            }
            if (removalStart > 0 && termText[removalStart - 1] === '\n') {
                removalStart -= 1;
                if (removalStart > 0 && termText[removalStart - 1] === '\r') {
                    removalStart -= 1;
                }
            }
            updatedTermText = termText.slice(0, removalStart) + termText.slice(spec.end);
        } else {
            const segment = `< ${remaining.join(', ')}`;
            updatedTermText = termText.slice(0, spec.start) + segment + termText.slice(spec.end);
        }

        const newContent = text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Removed specialization "${superTerm}" from term "${term}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error deleting specialization: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
