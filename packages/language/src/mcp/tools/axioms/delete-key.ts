import { z } from 'zod';
import { loadVocabularyDocument, writeFileAndNotify, findTerm } from '../common.js';
import { isAspect, isConcept, isRelationEntity } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the vocabulary'),
    entity: z.string().describe('Name of the entity to modify'),
    keyIndex: z.number().optional().describe('Index of the key to remove if multiple keys exist (0-based). Default: 0'),
};

export const deleteKeyTool = {
    name: 'delete_key' as const,
    description: `Removes a key axiom from an entity.

Keys define uniqueness constraints. Example: "key id" on a concept.
If an entity has multiple keys, specify keyIndex to remove a specific one.`,
    paramsSchema,
};

export const deleteKeyMetadata = {
    id: 'delete_key',
    displayName: 'Delete Key',
    layer: 'axiom' as const,
    severity: 'medium' as const,
    version: '1.0.0',
    shortDescription: 'Remove a key axiom from an entity',
    description: 'Removes a key axiom (uniqueness constraint) from an entity.',
    tags: ['axiom', 'key', 'delete', 'vocabulary'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export const deleteKeyHandler = async (
    { ontology, entity, keyIndex = 0 }: { ontology: string; entity: string; keyIndex?: number }
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
        
        // Match key patterns: key prop1, prop2, ...
        const keyPattern = /^([ \t]*key\s+[^\n\r]+)(?:\r?\n)?/gm;

        const matches: { match: string; index: number }[] = [];
        let match: RegExpExecArray | null;
        while ((match = keyPattern.exec(entityText)) !== null) {
            matches.push({ match: match[0], index: match.index });
        }

        if (matches.length === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `No key axioms found on entity "${entity}"` }],
            };
        }

        if (keyIndex >= matches.length) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Key index ${keyIndex} out of range. Found ${matches.length} key(s).` }],
            };
        }

        const toRemove = matches[keyIndex];
        const updatedEntityText = entityText.slice(0, toRemove.index) + entityText.slice(toRemove.index + toRemove.match.length);

        const newContent = (text.slice(0, node.$cstNode.offset) + updatedEntityText + text.slice(node.$cstNode.end))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeFileAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Removed key axiom from entity "${entity}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing key: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
