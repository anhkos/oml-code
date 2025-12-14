import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target vocabulary'),
    term: z.string().describe('Term to specialize'),
    superTerms: z.array(z.string()).nonempty().describe('Super terms to add'),
};

export const addSpecializationTool = {
    name: 'add_specialization' as const,
    description: 'Adds one or more super terms to a term’s specialization clause.',
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

export const addSpecializationHandler = async ({ ontology, term, superTerms }: { ontology: string; term: string; superTerms: string[] }) => {
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

        const deduped = Array.from(new Set([...(spec.exists ? spec.items : []), ...superTerms]));

        let updatedTermText: string;
        if (spec.exists) {
            const segment = `< ${deduped.join(', ')}`;
            updatedTermText = termText.slice(0, spec.start) + segment + termText.slice(spec.end);
        } else {
            // Insert after the member header (after closing block if present)
            const closingBlock = termText.lastIndexOf(']');
            const insertionPoint = closingBlock !== -1 ? closingBlock + 1 : termText.indexOf('\n') !== -1 ? termText.indexOf('\n') : termText.length;
            const before = termText.slice(0, insertionPoint).replace(/[ \t]+$/g, '');
            const after = termText.slice(insertionPoint);
            updatedTermText = `${before} < ${deduped.join(', ')}${after}`;
        }

        const newContent = text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end);
        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Added specialization to term "${term}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error adding specialization: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
