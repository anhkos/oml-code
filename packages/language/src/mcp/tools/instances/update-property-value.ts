import { z } from 'zod';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';
import { literalParamSchema } from '../schemas.js';
import { formatLiteral, LiteralParam, collectImportPrefixes, appendValidationIfSafeMode } from '../common.js';
import { preferencesState } from '../preferences/preferences-state.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the description ontology'),
    instanceName: z.string().describe('Name of the instance to update'),
    property: z.string().describe('Property name to update. Must be qualified (prefix:Name) for imported properties, e.g., "base:description", "requirement:isExpressedBy"'),
    literalValues: z.array(literalParamSchema).optional().describe('New literal values for scalar properties'),
    referencedValues: z.array(z.string()).optional().describe('New referenced instance names for relation assertions. Use qualified names (prefix:Name) for instances from other descriptions.'),
};

export const updatePropertyValueTool = {
    name: 'update_property_value' as const,
    description: `Updates a property value assertion on an instance by replacing existing values for the specified property.

OML syntax for property assertions is: property value1, value2
Example: base:description "Some text"
Example: requirement:isExpressedBy Operator, SafetyOfficer

Use literalValues for scalar properties and referencedValues for relations to other instances.`,
    paramsSchema,
};

export const updatePropertyValueMetadata = {
    id: 'update_property_value',
    displayName: 'Update Property Value',
    layer: 'description' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Update a property value on an instance',
    description: 'Updates property values on an instance by replacing existing values.',
    tags: ['property-update', 'instance-modification', 'description'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export const updatePropertyValueHandler = async (
    { ontology, instanceName, property, literalValues, referencedValues }: 
    { ontology: string; instanceName: string; property: string; literalValues?: LiteralParam[]; referencedValues?: string[] }
) => {
    // Check if user is trying to update types via rdf:type - redirect to update_instance
    if (property === 'rdf:type' || property === 'type' || property === 'base:types' || property.endsWith(':type')) {
        const typesJson = JSON.stringify(referencedValues || []);
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: `\n` +
                    `========================================\n` +
                    `❌ STOP: "${property}" is NOT a property in OML!\n` +
                    `========================================\n\n` +
                    `In OML, types are part of the instance DECLARATION, not properties.\n\n` +
                    `🔧 CALL THIS EXACT TOOL NOW:\n\n` +
                    `  Tool: update_instance\n` +
                    `  Parameters:\n` +
                    `    ontology: "${ontology}"\n` +
                    `    instance: "${instanceName}"\n` +
                    `    newTypes: ${typesJson}\n\n` +
                    `This changes: instance ${instanceName} : OldType\n` +
                    `To: instance ${instanceName} : ${(referencedValues || []).join(', ')}\n` +
                    `========================================`
            }],
        };
    }

    try {
        const { description, filePath, fileUri, text } = await loadDescriptionDocument(ontology);

        const instance = findInstance(description, instanceName);
        if (!instance || !instance.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instanceName}" not found in description.` }],
            };
        }

        // Collect all referenced prefixes
        const allReferencedNames = [
            property,
            ...(referencedValues ?? []).filter(rv => rv.includes(':')),
        ];
        const referencedPrefixes = new Set<string>();
        for (const ref of allReferencedNames) {
            if (ref.includes(':')) {
                referencedPrefixes.add(ref.split(':')[0]);
            }
        }

        // Check which prefixes are missing
        let existingPrefixes = collectImportPrefixes(text, description.prefix);
        const missing = [...referencedPrefixes].filter(p => !existingPrefixes.has(p));
        
        // Auto-add missing imports
        let currentText = text;
        let currentFilePath = filePath;
        let currentFileUri = fileUri;
        let currentDescription = description;
        
        if (missing.length > 0) {
            const ensureResult = await ensureImportsHandler({ ontology });
            if (ensureResult.isError) {
                return ensureResult;
            }
            // Reload the document to get updated content with new imports
            const reloaded = await loadDescriptionDocument(ontology);
            currentText = reloaded.text;
            currentFilePath = reloaded.filePath;
            currentFileUri = reloaded.fileUri;
            currentDescription = reloaded.description;
        }

        // Re-find the instance after potential reload
        const currentInstance = findInstance(currentDescription, instanceName);
        if (!currentInstance || !currentInstance.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instanceName}" not found after import update.` }],
            };
        }

        const instanceStart = currentInstance.$cstNode.offset;
        const instanceEnd = currentInstance.$cstNode.end;
        const instanceText = currentText.slice(instanceStart, instanceEnd);
        
        // Escape property for regex (handle colons and special chars)
        const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // OML property assertion syntax: property value1, value2, ...
        // Match the property followed by values until end of line or next property/closing bracket
        // Values can be: "string", number, true/false, or InstanceRef
        const propertyPattern = new RegExp(
            `([ \\t]*)(${escapedProperty})\\s+([^\\n\\r]+?)(?=\\s*(?:\\n|\\r|$|\\]))`,
            'gm'
        );
        
        const match = propertyPattern.exec(instanceText);
        if (!match) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Property "${property}" not found on instance "${instanceName}". Use create_concept_instance or manually add the property first.` }],
            };
        }

        // Build new property value assertion
        const values: string[] = [];
        if (literalValues && literalValues.length > 0) {
            values.push(...literalValues.map(formatLiteral));
        }
        if (referencedValues && referencedValues.length > 0) {
            values.push(...referencedValues);
        }

        if (values.length === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `No values provided. Specify either literalValues or referencedValues.` }],
            };
        }

        const leadingWhitespace = match[1];
        const newPropertyLine = `${leadingWhitespace}${property} ${values.join(', ')}`;
        
        // Replace the property line in the instance text
        const updatedInstanceText = instanceText.slice(0, match.index) + 
            newPropertyLine + 
            instanceText.slice(match.index + match[0].length);
        
        const newContent = currentText.slice(0, instanceStart) + updatedInstanceText + currentText.slice(instanceEnd);
        
        await writeDescriptionAndNotify(currentFilePath, currentFileUri, newContent);

        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}.`);
        }

        const result = {
            content: [
                { type: 'text' as const, text: `✓ Updated property "${property}" on instance "${instanceName}"${notes.length ? '\n' + notes.join(' ') : ''}` },
            ],
        };

        // Run validation if safe mode is enabled
        const safeMode = preferencesState.getPreferences().safeMode ?? false;
        return appendValidationIfSafeMode(result, currentFileUri, safeMode);
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error updating property value: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
