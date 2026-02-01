import { z } from 'zod';
import { AnnotationParam, PropertyValueParam, formatAnnotations, formatLiteral, collectImportPrefixes } from '../common.js';
import { annotationParamSchema, propertyValueParamSchema } from '../schemas.js';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance, OntologyNotFoundError, WrongOntologyTypeError } from '../description-common.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the target description'),
    instance: z.string().describe('Instance name to update'),
    newName: z.string().optional().describe('New name for the instance'),
    newTypes: z.array(z.string()).optional().describe('Replacement type assertions'),
    newSources: z.array(z.string()).optional().describe('Replacement source instances (for relation instances)'),
    newTargets: z.array(z.string()).optional().describe('Replacement target instances (for relation instances)'),
    newPropertyValues: z.array(propertyValueParamSchema).optional().describe('Replacement property values'),
    newAnnotations: z.array(annotationParamSchema).optional().describe('Replacement annotations'),
};

export const updateInstanceTool = {
    name: 'update_instance' as const,
    description: `Updates an instance by replacing its name, types, sources/targets (for relation instances), property values, or annotations.

KEY USES:
1. ADD TYPES: To add a type to an existing instance, use newTypes with ALL desired types
2. RENAME: Use newName to rename the instance
3. CHANGE PROPERTIES: Use newPropertyValues to replace all property values

Example - Add Actor type to existing Stakeholder instance:
  update_instance(ontology="desc.oml", instance="MissionCommander", newTypes=["requirement:Stakeholder", "entity:Actor"])

IMPORTANT: newTypes REPLACES all types - include ALL types you want the instance to have.`,
    paramsSchema,
};

export const updateInstanceMetadata = {
    id: 'update_instance',
    displayName: 'Update Instance',
    layer: 'description' as const,
    severity: 'high' as const,
    version: '1.0.0',
    shortDescription: 'Update an instance in a description file',
    description: 'Updates instance name, types, sources/targets, properties, or annotations.',
    tags: ['instance-update', 'description'],
    dependencies: [],
    addedDate: '2024-01-01',
};

function buildPropertyValues(propVals: PropertyValueParam[] | undefined, indent: string, eol: string): string {
    if (!propVals || propVals.length === 0) return '';
    
    const lines: string[] = [];
    for (const pv of propVals) {
        const values: string[] = [];
        if (pv.literalValues) {
            values.push(...pv.literalValues.map(formatLiteral));
        }
        if (pv.referencedValues) {
            values.push(...pv.referencedValues);
        }
        if (values.length > 0) {
            lines.push(`${indent}${pv.property} ${values.join(', ')}`);
        }
    }
    return lines.join(eol) + (lines.length > 0 ? eol : '');
}

function buildFromTo(sources: string[] | undefined, targets: string[] | undefined, indent: string, eol: string): string {
    let lines = '';
    if (sources && sources.length > 0) {
        lines += `${indent}from ${sources.join(', ')}${eol}`;
    }
    if (targets && targets.length > 0) {
        lines += `${indent}to ${targets.join(', ')}${eol}`;
    }
    return lines;
}

export const updateInstanceHandler = async (params: {
    ontology: string;
    instance: string;
    newName?: string;
    newTypes?: string[];
    newSources?: string[];
    newTargets?: string[];
    newPropertyValues?: PropertyValueParam[];
    newAnnotations?: AnnotationParam[];
}) => {
    const { ontology, instance, newName, newTypes, newSources, newTargets, newPropertyValues, newAnnotations } = params;

    try {
        let { description, filePath, fileUri, text, eol, indent } = await loadDescriptionDocument(ontology);
        const node = findInstance(description, instance);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instance}" was not found in the description.` }],
            };
        }

        // Collect prefixes referenced in newTypes, newPropertyValues, newAnnotations, newSources, newTargets
        const referencedPrefixes = new Set<string>();
        
        const collectPrefix = (name: string) => {
            if (name.includes(':')) {
                referencedPrefixes.add(name.split(':')[0]);
            }
        };
        
        newTypes?.forEach(collectPrefix);
        newSources?.forEach(collectPrefix);
        newTargets?.forEach(collectPrefix);
        newPropertyValues?.forEach(pv => {
            collectPrefix(pv.property);
            pv.referencedValues?.forEach(collectPrefix);
        });
        newAnnotations?.forEach(ann => {
            collectPrefix(ann.property);
            ann.referencedValues?.forEach(collectPrefix);
        });

        // Check which imports are missing and auto-add them
        const existingPrefixes = collectImportPrefixes(text, description.prefix);
        const missing = [...referencedPrefixes].filter(p => !existingPrefixes.has(p));
        
        if (missing.length > 0) {
            // Automatically call ensure_imports to add the missing imports
            const ensureResult = await ensureImportsHandler({ ontology });
            
            if (ensureResult.isError) {
                return ensureResult;
            }
            
            // Reload the document to get the updated content with new imports
            const reloaded = await loadDescriptionDocument(ontology);
            description = reloaded.description;
            filePath = reloaded.filePath;
            fileUri = reloaded.fileUri;
            text = reloaded.text;
            eol = reloaded.eol;
            indent = reloaded.indent;
        }

        // Re-find the instance node after potential reload (offsets may have changed)
        const updatedNode = findInstance(description, instance);
        if (!updatedNode || !updatedNode.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instance}" was not found after import update.` }],
            };
        }

        const isRelationInstance = updatedNode.$type === 'RelationInstance';
        
        // Detect the original indentation of this instance by looking at what precedes it
        const textBeforeInstance = text.slice(0, updatedNode.$cstNode.offset);
        const lastNewlineIndex = textBeforeInstance.lastIndexOf('\n');
        const lineStart = lastNewlineIndex >= 0 ? textBeforeInstance.slice(lastNewlineIndex + 1) : '';
        const originalIndent = lineStart.match(/^(\s*)/)?.[1] || '';
        const innerIndent = originalIndent + indent;

        // Parse existing instance
        const oldText = text.slice(updatedNode.$cstNode.offset, updatedNode.$cstNode.end);
        const annotationsText = formatAnnotations(newAnnotations, originalIndent, eol);

        const instanceKeyword = isRelationInstance ? 'relation instance' : 'instance';
        const name = newName ?? instance;
        
        // Type clause
        let typeClause = '';
        if (newTypes !== undefined) {
            typeClause = newTypes.length > 0 ? ` : ${newTypes.join(', ')}` : '';
        } else {
            // Preserve existing types if not replaced
            const typeMatch = oldText.match(/:\s*([^[\n]+)/);
            if (typeMatch) {
                typeClause = ` : ${typeMatch[1].trim()}`;
            }
        }

        // Build body
        let bodyText = '';
        if (isRelationInstance && (newSources !== undefined || newTargets !== undefined)) {
            bodyText += buildFromTo(newSources, newTargets, innerIndent, eol);
        } else if (isRelationInstance) {
            // Preserve existing from/to
            const fromMatch = oldText.match(/from\s+([^\n]+)/);
            const toMatch = oldText.match(/to\s+([^\n]+)/);
            if (fromMatch) bodyText += `${innerIndent}from ${fromMatch[1].trim()}${eol}`;
            if (toMatch) bodyText += `${innerIndent}to ${toMatch[1].trim()}${eol}`;
        }

        if (newPropertyValues !== undefined) {
            bodyText += buildPropertyValues(newPropertyValues, innerIndent, eol);
        } else {
            // Preserve existing property values (simple heuristic)
            const blockMatch = oldText.match(/\[\s*([\s\S]*?)\s*\]/);
            if (blockMatch) {
                const blockContent = blockMatch[1];
                // Extract lines that look like property values (not from/to)
                // Re-indent each line properly with innerIndent
                const propLines = blockContent.split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('from') && !line.startsWith('to'))
                    .map(line => `${innerIndent}${line}`)
                    .join(eol);
                if (propLines) {
                    bodyText += propLines + eol;
                }
            }
        }

        const block = bodyText ? ` [${eol}${bodyText}${originalIndent}]` : '';
        const newInstanceText = `${annotationsText}${instanceKeyword} ${name}${typeClause}${block}`;

        const newContent = text.slice(0, updatedNode.$cstNode.offset) + newInstanceText + text.slice(updatedNode.$cstNode.end);
        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        const notes: string[] = [];
        if (missing.length > 0) {
            notes.push(`Auto-added imports for: ${missing.join(', ')}`);
        }

        return {
            content: [
                { type: 'text' as const, text: `✓ Updated instance "${instance}"${newName ? ` (renamed to "${newName}")` : ''}` },
                ...(notes.length ? [{ type: 'text' as const, text: notes.join(' ') }] : []),
            ],
        };
    } catch (error) {
        if (error instanceof OntologyNotFoundError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `❌ ONTOLOGY NOT FOUND: ${error.filePath}\n\nThe description file does not exist. Create it first with create_ontology(kind="description").`
                }],
            };
        }
        if (error instanceof WrongOntologyTypeError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `❌ WRONG ONTOLOGY TYPE: Expected "description" but found "${error.actualType}". Instances can only exist in description files.`
                }],
            };
        }
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error updating instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
