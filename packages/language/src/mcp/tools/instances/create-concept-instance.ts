import { z } from 'zod';
import { AnnotationParam, PropertyValueParam, formatAnnotations, formatLiteral, insertBeforeClosingBrace } from '../common.js';
import { annotationParamSchema, propertyValueParamSchema } from '../schemas.js';
import { loadDescriptionDocument, writeDescriptionAndNotify, findInstance } from '../description-common.js';

const paramsSchema = {
    ontology: z.string().describe('File path or file:// URI to the target description'),
    name: z.string().describe('Instance name'),
    types: z.array(z.string()).optional().describe('Type assertions (entity references)'),
    propertyValues: z.array(propertyValueParamSchema).optional().describe('Property value assertions'),
    annotations: z.array(annotationParamSchema).optional(),
};

export const createConceptInstanceTool = {
    name: 'create_concept_instance' as const,
    description: 'Creates a concept instance in a description with optional types and property values.',
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

export const createConceptInstanceHandler = async (params: {
    ontology: string;
    name: string;
    types?: string[];
    propertyValues?: PropertyValueParam[];
    annotations?: AnnotationParam[];
}) => {
    const { ontology, name, types, propertyValues, annotations } = params;

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
        const propText = buildPropertyValues(propertyValues, innerIndent, eol);
        const block = propText ? ` [${eol}${propText}${indent}]` : '';

        const instanceText = `${annotationsText}${indent}instance ${name}${typeClause}${block}${eol}${eol}`;
        const newContent = insertBeforeClosingBrace(text, instanceText);
        await writeDescriptionAndNotify(filePath, fileUri, newContent);

        return {
            content: [{ type: 'text' as const, text: `✓ Created concept instance "${name}"` }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error creating concept instance: ${error instanceof Error ? error.message : String(error)}` }],
        };
    }
};
