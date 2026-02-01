import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the vocabulary'),
    ruleName: z.string().describe('Name of the rule to delete'),
};

export const deleteRuleTool = {
    name: 'delete_rule' as const,
    description: `Deletes a rule from a vocabulary.

Rules define inference patterns with antecedent and consequent clauses.`,
    paramsSchema,
};

export const deleteRuleMetadata = {
    id: 'delete_rule',
    displayName: 'Delete Rule',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Delete a rule from a vocabulary',
    description: 'Deletes a rule from a vocabulary.',
    tags: ['rule-deletion', 'axiom', 'logic'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export const deleteRuleHandler = async (
    { ontology, ruleName }: { ontology: string; ruleName: string }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol } = await loadVocabularyDocument(ontology);
        
        // Find the rule by name
        const rule = vocabulary.ownedStatements.find((s: any) => s.$type === 'Rule' && s.name === ruleName);

        if (!rule || !rule.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Rule "${ruleName}" not found in vocabulary` }],
            };
        }

        // Get the rule's text position
        let startOffset = rule.$cstNode.offset;
        let endOffset = rule.$cstNode.end;

        // Expand to include leading whitespace and trailing newline
        while (startOffset > 0 && (text[startOffset - 1] === ' ' || text[startOffset - 1] === '\t')) {
            startOffset--;
        }
        // Include the newline before if we're at start of line
        if (startOffset > 0 && text[startOffset - 1] === '\n') {
            startOffset--;
            if (startOffset > 0 && text[startOffset - 1] === '\r') {
                startOffset--;
            }
        }
        // Include trailing newline
        if (text[endOffset] === '\r') endOffset++;
        if (text[endOffset] === '\n') endOffset++;

        const newContent = (text.slice(0, startOffset) + text.slice(endOffset))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Deleted rule "${ruleName}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error deleting rule: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
