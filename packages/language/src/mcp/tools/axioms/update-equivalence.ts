import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the target vocabulary'),
    termName: z.string().describe('Name of the term with equivalence to update'),
    equivalentTerms: z.array(z.string()).describe('New equivalent terms to replace existing equivalence'),
};

export const updateEquivalenceTool = {
    name: 'update_equivalence' as const,
    description: 'Updates equivalence axiom on a term by replacing the existing equivalence with new terms.',
    paramsSchema,
};

export const updateEquivalenceHandler = async (
    { ontology, termName, equivalentTerms }: { ontology: string; termName: string; equivalentTerms: string[] }
) => {
    try {
        const { vocabulary, filePath, fileUri, text } = await loadVocabularyDocument(ontology);

        const term = findTerm(vocabulary, termName);
        if (!term || !term.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${termName}" not found in vocabulary.` }],
            };
        }

        const termText = text.slice(term.$cstNode.offset, term.$cstNode.end);

        // Find existing = clause
        const equivPattern = /=\s*[^\[\n\r]+/;
        const match = termText.match(equivPattern);

        if (!match) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `No equivalence found on term "${termName}". Use add_equivalence instead.` }],
            };
        }

        // Replace equivalence clause
        const newEquivClause = `= ${equivalentTerms.join(' & ')}`;
        const updatedTermText = termText.replace(equivPattern, newEquivClause);

        const newContent = text.slice(0, term.$cstNode.offset) + updatedTermText + text.slice(term.$cstNode.end);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Updated equivalence on term "${termName}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating equivalence: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
