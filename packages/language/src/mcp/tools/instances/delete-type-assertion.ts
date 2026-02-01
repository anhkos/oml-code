import { z } from 'zod';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';
import { isConceptInstance, isRelationInstance } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the description ontology'),
    instance: z.string().describe('Name of the instance to modify'),
    typeToRemove: z.string().describe('Type to remove from the instance (e.g., "vehicle:Car")'),
};

export const deleteTypeAssertionTool = {
    name: 'delete_type_assertion' as const,
    description: `Removes a type assertion from an instance.

Instances can have multiple types. This removes one specific type.
Example: If "myCar" is typed as both "Vehicle" and "Car", you can remove "Vehicle".

Warning: Removing the primary type may leave the instance in an invalid state.`,
    paramsSchema,
};

export const deleteTypeAssertionMetadata = {
    id: 'delete_type_assertion',
    displayName: 'Delete Type Assertion',
    layer: 'description' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Remove a type assertion from an instance',
    description: 'Removes a type assertion from an instance with multiple types.',
    tags: ['type-assertion', 'instance-modification', 'description'],
    dependencies: [],
    addedDate: '2026-02-01',
};

export const deleteTypeAssertionHandler = async (
    { ontology, instance, typeToRemove }: { ontology: string; instance: string; typeToRemove: string }
) => {
    try {
        const { description, filePath, fileUri, text, eol } = await loadDescriptionDocument(ontology);
        const node = findInstance(description, instance);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instance}" not found in description` }],
            };
        }

        if (!isConceptInstance(node) && !isRelationInstance(node)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `"${instance}" is not a concept or relation instance` }],
            };
        }

        const instanceText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        
        // Match type assertions:
        // : Type1, Type2, Type3 (in declaration line)
        // or additional type assertions on separate lines
        const escapedType = typeToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        let updatedInstanceText: string;
        let found = false;

        // Try to remove from comma-separated list: ", Type" or "Type, "
        let pattern = new RegExp(`\\s*,\\s*${escapedType}(?![\\w:])`, 'g');
        let modified = instanceText.replace(pattern, () => { found = true; return ''; });
        
        if (!found) {
            pattern = new RegExp(`${escapedType}(?![\\w:])\\s*,\\s*`, 'g');
            modified = instanceText.replace(pattern, () => { found = true; return ''; });
        }

        if (!found) {
            // Try standalone type on its own line (additional type assertion)
            pattern = new RegExp(`^[ \\t]*:\\s*${escapedType}(?![\\w:])\\s*(?:\\r?\\n)?`, 'gm');
            modified = instanceText.replace(pattern, () => { found = true; return ''; });
        }

        if (!found) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Type "${typeToRemove}" not found on instance "${instance}"` }],
            };
        }

        updatedInstanceText = modified;

        const newContent = (text.slice(0, node.$cstNode.offset) + updatedInstanceText + text.slice(node.$cstNode.end))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Removed type "${typeToRemove}" from instance "${instance}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing type assertion: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
