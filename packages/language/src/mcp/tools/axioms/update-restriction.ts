import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the target vocabulary'),
    termName: z.string().describe('Name of the entity with restriction to update'),
    restrictionIndex: z.number().describe('0-based index of the restriction to update'),
    restrictionKind: z.enum(['range', 'cardinality', 'value', 'self']).describe('Type of restriction'),
    property: z.string().describe('Property name for the restriction'),
    range: z.string().optional().describe('Range for range restrictions'),
    min: z.number().optional().describe('Minimum cardinality'),
    max: z.number().optional().describe('Maximum cardinality'),
    value: z.string().optional().describe('Value for value restrictions'),
};

export const updateRestrictionTool = {
    name: 'update_restriction' as const,
    description: 'Updates a specific restriction on an entity by index. Use add_restriction if adding new ones.',
    paramsSchema,
};

export const updateRestrictionHandler = async (
    params: { ontology: string; termName: string; restrictionIndex: number; restrictionKind: string; property: string; range?: string; min?: number; max?: number; value?: string }
) => {
    try {
        const { ontology, termName, restrictionIndex, restrictionKind, property, range, min, max, value } = params;
        const { vocabulary, filePath, fileUri, text, indent } = await loadVocabularyDocument(ontology);

        const term = findTerm(vocabulary, termName);
        if (!term || !term.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${termName}" not found in vocabulary.` }],
            };
        }

        const termText = text.slice(term.$cstNode.offset, term.$cstNode.end);

        // Find all restriction lines
        const restrictionPattern = /restricts\s+(all|some|exactly|min|max|value|self)\s+.+/g;
        const restrictions = [];
        let match;
        while ((match = restrictionPattern.exec(termText)) !== null) {
            restrictions.push({ text: match[0], index: match.index });
        }

        if (restrictionIndex < 0 || restrictionIndex >= restrictions.length) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Restriction index ${restrictionIndex} out of range (0-${restrictions.length - 1}).` }],
            };
        }

        const innerIndent = indent + indent;
        let newRestriction = '';

        switch (restrictionKind) {
            case 'range':
                newRestriction = `${innerIndent}restricts all ${property} to ${range}`;
                break;
            case 'cardinality':
                if (min !== undefined && max !== undefined && min === max) {
                    newRestriction = `${innerIndent}restricts exactly ${min} ${property}`;
                } else if (min !== undefined && max === undefined) {
                    newRestriction = `${innerIndent}restricts min ${min} ${property}`;
                } else if (max !== undefined && min === undefined) {
                    newRestriction = `${innerIndent}restricts max ${max} ${property}`;
                } else {
                    return {
                        isError: true,
                        content: [{ type: 'text' as const, text: 'For cardinality restrictions, provide min and/or max.' }],
                    };
                }
                break;
            case 'value':
                newRestriction = `${innerIndent}restricts some ${property} to ${value}`;
                break;
            case 'self':
                newRestriction = `${innerIndent}restricts self to ${property}`;
                break;
        }

        // Replace the specific restriction
        const targetRestriction = restrictions[restrictionIndex];
        const before = termText.slice(0, targetRestriction.index);
        const after = termText.slice(targetRestriction.index + targetRestriction.text.length);
        const updatedTermText = before + newRestriction.trim() + after;

        const newContent = text.slice(0, term.$cstNode.offset) + updatedTermText + text.slice(term.$cstNode.end);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Updated restriction ${restrictionIndex} on term "${termName}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating restriction: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
