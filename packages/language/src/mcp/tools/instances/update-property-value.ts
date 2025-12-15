import { z } from 'zod';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';
import { literalParamSchema } from '../schemas.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the description ontology'),
    instanceName: z.string().describe('Name of the instance to update'),
    property: z.string().describe('Property name to update'),
    literalValues: z.array(literalParamSchema).optional().describe('New literal values'),
    referencedValues: z.array(z.string()).optional().describe('New referenced values'),
};

export const updatePropertyValueTool = {
    name: 'update_property_value' as const,
    description: 'Updates a property value assertion on an instance by replacing existing values for the specified property.',
    paramsSchema,
};

export const updatePropertyValueHandler = async (
    { ontology, instanceName, property, literalValues, referencedValues }: 
    { ontology: string; instanceName: string; property: string; literalValues?: any[]; referencedValues?: string[] }
) => {
    try {
        const { description, filePath, fileUri, text, indent } = await loadDescriptionDocument(ontology);

        const instance = findInstance(description, instanceName);
        if (!instance || !instance.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instanceName}" not found in description.` }],
            };
        }

        const instanceText = text.slice(instance.$cstNode.offset, instance.$cstNode.end);
        
        // Find the property value line(s) to replace
        // Pattern: property value [ literalOrRefs ]
        const propertyPattern = new RegExp(`(${indent}${indent}${property}\\s+\\[)[^\\]]*\\]`, 'g');
        
        if (!propertyPattern.test(instanceText)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Property "${property}" not found on instance "${instanceName}".` }],
            };
        }

        // Build new property value assertion
        const values = [];
        if (literalValues && literalValues.length > 0) {
            for (const lit of literalValues) {
                const formatLiteral = (l: any) => {
                    if (l.type === 'quoted') {
                        const val = String(l.value).replace(/"/g, '\\"');
                        if (l.scalarType) return `"${val}"^^${l.scalarType}`;
                        if (l.langTag) return `"${val}"$${l.langTag}`;
                        return `"${val}"`;
                    }
                    return String(l.value);
                };
                values.push(formatLiteral(lit));
            }
        }
        if (referencedValues && referencedValues.length > 0) {
            values.push(...referencedValues);
        }

        const newPropertyLine = `${indent}${indent}${property} [ ${values.join(', ')} ]`;
        
        // Replace the property line
        const updatedInstanceText = instanceText.replace(propertyPattern, newPropertyLine);
        
        const newContent = text.slice(0, instance.$cstNode.offset) + updatedInstanceText + text.slice(instance.$cstNode.end);
        
        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [
                { type: 'text' as const, text: `✓ Updated property "${property}" on instance "${instanceName}"` },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating property value: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
