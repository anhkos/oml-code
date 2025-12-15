import { z } from 'zod';
import { AnnotationParam, PropertyValueParam, formatAnnotations, formatLiteral } from '../common.js';
import { annotationParamSchema, propertyValueParamSchema } from '../schemas.js';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target description'),
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
    description: 'Updates an instance by replacing its name, types, sources/targets (for relation instances), property values, or annotations.',
    paramsSchema,
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
        const { description, filePath, fileUri, text, eol, indent } = await loadDescriptionDocument(ontology);
        const node = findInstance(description, instance);

        if (!node || !node.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${instance}" was not found in the description.` }],
            };
        }

        const isRelationInstance = node.$type === 'RelationInstance';
        const innerIndent = indent + indent;

        // Parse existing instance
        const oldText = text.slice(node.$cstNode.offset, node.$cstNode.end);
        const annotationsText = formatAnnotations(newAnnotations, indent, eol);

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
                const propLines = blockContent.split(/\r?\n/)
                    .filter(line => line.trim() && !line.trim().startsWith('from') && !line.trim().startsWith('to'))
                    .map(line => line.trimEnd())
                    .join(eol);
                if (propLines) {
                    bodyText += propLines + eol;
                }
            }
        }

        const block = bodyText ? ` [${eol}${bodyText}${indent}]` : '';
        const newInstanceText = `${annotationsText}${indent}${instanceKeyword} ${name}${typeClause}${block}`;

        const newContent = text.slice(0, node.$cstNode.offset) + newInstanceText + text.slice(node.$cstNode.end);
        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Updated instance "${instance}"${newName ? ` (renamed to "${newName}")` : ''}` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error updating instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
