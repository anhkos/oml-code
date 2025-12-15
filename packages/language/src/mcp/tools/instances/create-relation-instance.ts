import { z } from 'zod';
import { AnnotationParam, PropertyValueParam, formatAnnotations, formatLiteral, insertBeforeClosingBrace } from '../common.js';
import { annotationParamSchema, propertyValueParamSchema } from '../schemas.js';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target description'),
    name: z.string().describe('Relation instance name'),
    types: z.array(z.string()).optional().describe('Type assertions (relation entity references)'),
    sources: z.array(z.string()).optional().describe('Source instances (from)'),
    targets: z.array(z.string()).optional().describe('Target instances (to)'),
    propertyValues: z.array(propertyValueParamSchema).optional().describe('Property value assertions'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createRelationInstanceTool = {
    name: 'create_relation_instance' as const,
    description: 'Creates a relation instance in a description with optional types, sources, targets, and property values.',
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

export const createRelationInstanceHandler = async (params: {
    ontology: string;
    name: string;
    types?: string[];
    sources?: string[];
    targets?: string[];
    propertyValues?: PropertyValueParam[];
    annotations?: AnnotationParam[];
}) => {
    const { ontology, name, types, sources, targets, propertyValues, annotations } = params;

    try {
        const { description, filePath, fileUri, text, eol, indent } = await loadDescriptionDocument(ontology);

        if (findInstance(description, name)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Instance "${name}" already exists in the description.` }],
            };
        }

        const innerIndent = indent + indent;
        const annotationsText = formatAnnotations(annotations, indent, eol);

        const typeClause = types && types.length > 0 ? ` : ${types.join(', ')}` : '';
        const fromToText = buildFromTo(sources, targets, innerIndent, eol);
        const propText = buildPropertyValues(propertyValues, innerIndent, eol);
        const bodyText = fromToText + propText;
        const block = bodyText ? ` [${eol}${bodyText}${indent}]` : '';

        const instanceText = `${annotationsText}${indent}relation instance ${name}${typeClause}${block}${eol}${eol}`;
        const newContent = insertBeforeClosingBrace(text, instanceText);
        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Created relation instance "${name}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error creating relation instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
