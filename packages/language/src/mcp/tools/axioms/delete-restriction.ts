import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';
import { isAspect, isConcept, isRelationEntity } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the vocabulary'),
    entity: z.string().describe('Name of the entity (aspect, concept, or relation entity) to modify'),
    property: z.string().describe('Property name in the restriction to remove'),
    restrictionIndex: z.number().optional().describe('Index of the restriction to remove if multiple exist for the same property (0-based). Default: 0'),
};

export const deleteRestrictionTool = {
    name: 'delete_restriction' as const,
    description: `Removes a property restriction from an entity.

Example: To remove "restricts all hasColor to Color" from concept Vehicle:
- entity: "Vehicle"
- property: "hasColor"`,
    paramsSchema,
};

export const deleteRestrictionMetadata = {
    id: 'delete_restriction',
    displayName: 'Delete Restriction',
    layer: 'axiom' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Remove a property restriction from an entity',
    description: 'Removes a property restriction from an entity.',
    tags: ['axiom', 'restriction', 'delete', 'vocabulary'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export const deleteRestrictionHandler = async (
    { ontology, entity, property, restrictionIndex = 0 }: { ontology: string; entity: string; property: string; restrictionIndex?: number }
) => {
    try {
        const { vocabulary, filePath, fileUri, text, eol } = await loadVocabularyDocument(ontology);
        const node = findTerm(vocabulary, entity);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Entity "${entity}" not found in vocabulary` }],
            };
        }

        if (!isAspect(node) && !isConcept(node) && !isRelationEntity(node)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${entity}" is not an entity (must be aspect, concept, or relation entity)` }],
            };
        }

        const entityText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        
        // Find restrictions matching the property
        const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match restriction patterns:
        // restricts all/some property to Type
        // restricts property to exactly/min/max N Type
        // restricts property to value
        // restricts property to self
        const restrictionPattern = new RegExp(
            `^([ \\t]*restricts\\s+(?:all\\s+|some\\s+)?${escapedProperty}\\s+to\\s+[^\\n\\r]+)(?:\\r?\\n)?`,
            'gm'
        );

        const matches: { match: string; index: number }[] = [];
        let match: RegExpExecArray | null;
        while ((match = restrictionPattern.exec(entityText)) !== null) {
            matches.push({ match: match[0], index: match.index });
        }

        if (matches.length === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `No restriction for property "${property}" found on entity "${entity}"` }],
            };
        }

        if (restrictionIndex >= matches.length) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Restriction index ${restrictionIndex} out of range. Found ${matches.length} restriction(s) for property "${property}".` }],
            };
        }

        const toRemove = matches[restrictionIndex];
        const updatedEntityText = entityText.slice(0, toRemove.index) + entityText.slice(toRemove.index + toRemove.match.length);

        const newContent = (text.slice(0, node.$cstNode.offset) + updatedEntityText + text.slice(node.$cstNode.end))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Removed restriction for property "${property}" from entity "${entity}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing restriction: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
