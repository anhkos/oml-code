import { z } from 'zod';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';
import { isConceptInstance, isRelationInstance } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the description ontology'),
    instance: z.string().describe('Name of the instance to modify'),
    property: z.string().describe('Property name to remove values for'),
    valueIndex: z.number().optional().describe('Specific value index to remove (0-based). If omitted, removes all values for the property.'),
};

export const deletePropertyValueTool = {
    name: 'delete_property_value' as const,
    description: `Removes property value assertions from an instance.

Example: Remove "hasAge" value from instance "person1":
- instance: "person1"
- property: "hasAge"`,
    paramsSchema,
};

export const deletePropertyValueHandler = async (
    { ontology, instance, property, valueIndex }: { ontology: string; instance: string; property: string; valueIndex?: number }
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
        
        // Match property assertions: property value or property value1, value2
        const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const propertyPattern = new RegExp(
            `^([ \\t]*${escapedProperty}\\s+[^\\n\\r]+)(?:\\r?\\n)?`,
            'gm'
        );

        const matches: { match: string; index: number }[] = [];
        let match: RegExpExecArray | null;
        while ((match = propertyPattern.exec(instanceText)) !== null) {
            matches.push({ match: match[0], index: match.index });
        }

        if (matches.length === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `No property "${property}" found on instance "${instance}"` }],
            };
        }

        let updatedInstanceText: string;
        let removedDescription: string;

        if (valueIndex !== undefined) {
            if (valueIndex >= matches.length) {
                return {
                    isError: true,
                    content: [{ type: 'text' as const, text: `Value index ${valueIndex} out of range. Found ${matches.length} assertion(s) for property "${property}".` }],
                };
            }
            const toRemove = matches[valueIndex];
            updatedInstanceText = instanceText.slice(0, toRemove.index) + instanceText.slice(toRemove.index + toRemove.match.length);
            removedDescription = `value at index ${valueIndex}`;
        } else {
            // Remove all values for this property
            updatedInstanceText = instanceText.replace(propertyPattern, '');
            removedDescription = 'all values';
        }

        const newContent = (text.slice(0, node.$cstNode.offset) + updatedInstanceText + text.slice(node.$cstNode.end))
            .replace(/\r?\n{3,}/g, `${eol}${eol}`);

        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Removed ${removedDescription} for property "${property}" from instance "${instance}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error removing property value: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
