import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, collectImportPrefixes } from '../common.js';

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

export const updateEquivalenceMetadata = {
    id: 'update_equivalence',
    displayName: 'Update Equivalence',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Update equivalence axiom on a term',
    description: 'Updates equivalence axiom on a term by replacing existing equivalences.',
    tags: ['axiom', 'equivalence', 'update', 'vocabulary'],
    dependencies: [],
    addedDate: '2024-01-01',
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

        const importPrefixes = collectImportPrefixes(text, vocabulary.prefix);
        const missing: string[] = [];

        for (const eq of equivalentTerms) {
            if (eq.includes(':')) {
                const prefix = eq.split(':')[0];
                if (!importPrefixes.has(prefix)) {
                    missing.push(`Equivalent term "${eq}" requires an import for prefix "${prefix}".`);
                }
            } else {
                const target = findTerm(vocabulary, eq);
                if (!target) {
                    missing.push(`Equivalent term "${eq}" not found locally. Qualify it or add an import.`);
                }
            }
        }

        if (missing.length) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: missing.join('\n') }],
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
