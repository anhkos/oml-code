import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';
import { isAspect, isConcept, isRelationEntity, isScalar } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the vocabulary'),
    term: z.string().describe('Name of the term to modify'),
    equivalentTerm: z.string().optional().describe('Specific equivalent term to remove. If omitted, removes all equivalences.'),
};

export const deleteEquivalenceTool = {
    name: 'delete_equivalence' as const,
    description: `Removes equivalence axioms from a term.

Example: If "Car" has "< Vehicle & FourWheeled" (equivalent to Vehicle and FourWheeled):
- Remove specific equivalence: term="Car", equivalentTerm="FourWheeled"
- Remove all equivalences: term="Car"`,
    paramsSchema,
};

export const deleteEquivalenceMetadata = {
    id: 'delete_equivalence',
    displayName: 'Delete Equivalence',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Remove an equivalence axiom from a term',
    description: 'Removes an equivalence axiom from a term to modify external equivalences.',
    tags: ['axiom', 'equivalence', 'delete', 'vocabulary'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export const deleteEquivalenceHandler = async (
    { ontology, term, equivalentTerm }: { ontology: string; term: string; equivalentTerm?: string }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol } = await loadVocabularyDocument(ontology);
        const node = findTerm(vocabulary, term);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${term}" not found in vocabulary` }],
            };
        }

        if (!isAspect(node) && !isConcept(node) && !isRelationEntity(node) && !isScalar(node)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${term}" does not support equivalence axioms` }],
            };
        }

        const termText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        let updatedTermText: string;
        let removed: string;

        if (equivalentTerm) {
            // Remove specific equivalent term from the expression
            const escapedTerm = equivalentTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Patterns to match the term in equivalence expressions:
            // < A & B & C  (term could be A, B, or C)
            // Various formats with &, |, and parentheses
            
            // First try to remove "& term" or "| term"
            let pattern = new RegExp(`\\s*[&|]\\s*${escapedTerm}(?![\\w:])`, 'g');
            let modified = termText.replace(pattern, '');
            
            if (modified === termText) {
                // Try to remove "term &" or "term |"
                pattern = new RegExp(`${escapedTerm}(?![\\w:])\\s*[&|]\\s*`, 'g');
                modified = termText.replace(pattern, '');
            }
            
            if (modified === termText) {
                // Term might be the only one in equivalence, remove whole equivalence clause
                pattern = new RegExp(`<\\s*${escapedTerm}(?![\\w:])\\s*(?:\\[|$|\\n)`, 'gm');
                if (pattern.test(termText)) {
                    // Remove the whole equivalence line
                    modified = termText.replace(/^([ \t]*)(<\s*[^\[\n]+)\s*\[?/m, (match, indent, equiv) => {
                        if (equiv.trim() === `< ${equivalentTerm}`) {
                            return indent + '[';
                        }
                        return match;
                    });
                }
            }

            if (modified === termText) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `Equivalent term "${equivalentTerm}" not found in equivalence of "${term}"` }],
                };
            }

            updatedTermText = modified;
            removed = equivalentTerm;
        } else {
            // Remove all equivalence axioms
            // Pattern: < expression (before [ or at end of line)
            const equivPattern = /^([ \t]*)(aspect|concept|relation entity|scalar)(\s+\S+\s*)(:\s*\S+\s*)?(<[^[\n]+)/gm;
            
            const modified = termText.replace(equivPattern, '$1$2$3$4');
            
            if (modified === termText) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `No equivalence axioms found on "${term}"` }],
                };
            }

            updatedTermText = modified;
            removed = 'all equivalences';
        }

        // Clean up extra whitespace
        updatedTermText = updatedTermText.replace(/\s+\[/g, ' [').replace(/:\s*\[/g, ' [');

        const newContent = (text.slice(0, node.$cstNode.offset) + updatedTermText + text.slice(node.$cstNode.end))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Removed ${removed} from "${term}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing equivalence: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
