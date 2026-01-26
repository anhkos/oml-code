import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the vocabulary'),
    ruleName: z.string().describe('Name of the rule to update'),
    newAntecedent: z.array(z.string()).optional().describe('New antecedent predicates'),
    newConsequent: z.array(z.string()).optional().describe('New consequent predicates'),
};

export const updateRuleTool = {
    name: 'update_rule' as const,
    description: `Updates a rule's antecedent and/or consequent.

Rules have the form: rule name [ antecedent1 & antecedent2 -> consequent1 & consequent2 ]

Provide newAntecedent and/or newConsequent to update the corresponding parts.`,
    paramsSchema,
};

export const updateRuleHandler = async (
    { ontology, ruleName, newAntecedent, newConsequent }: { ontology: string; ruleName: string; newAntecedent?: string[]; newConsequent?: string[] }
) => {
    try {
        if (!newAntecedent && !newConsequent) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Must provide newAntecedent and/or newConsequent' }],
            };
        }

        const { vocabulary, filePath, fileUri, text } = await loadVocabularyDocument(ontology);
        
        // Find the rule by name
        const rule = vocabulary.ownedStatements.find((s: any) => s.$type === 'Rule' && s.name === ruleName);

        if (!rule || !rule.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Rule "${ruleName}" not found in vocabulary` }],
            };
        }

        const ruleText = text.slice(rule.$cstNode.offset, rule.$cstNode.end);
        
        // Parse the rule structure: rule name [ antecedent -> consequent ]
        const ruleMatch = ruleText.match(/^(\s*rule\s+\S+\s*\[\s*)([^\]]+?)\s*->\s*([^\]]+?)(\s*\])/s);
        
        if (!ruleMatch) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Could not parse rule structure for "${ruleName}"` }],
            };
        }

        const [, prefix, currentAntecedent, currentConsequent, suffix] = ruleMatch;
        
        const antecedent = newAntecedent ? newAntecedent.join(' & ') : currentAntecedent.trim();
        const consequent = newConsequent ? newConsequent.join(' & ') : currentConsequent.trim();

        const updatedRuleText = `${prefix}${antecedent} -> ${consequent}${suffix}`;

        const newContent = text.slice(0, rule.$cstNode.offset) + updatedRuleText + text.slice(rule.$cstNode.end);

        await writeFileAndNotify(filePath, fileUri, newContent);

        const changes: string[] = [];
        if (newAntecedent) changes.push('antecedent');
        if (newConsequent) changes.push('consequent');

        return {
            content: [{ type: 'text' as const, text: `✓ Updated rule "${ruleName}" (${changes.join(' and ')})` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating rule: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
