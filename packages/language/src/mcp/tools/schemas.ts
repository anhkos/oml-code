import { z } from 'zod';

export const literalParamSchema = z.object({
    type: z.enum(['integer', 'decimal', 'double', 'boolean', 'quoted']).describe('Literal type. Use "quoted" for strings.'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('The literal value'),
    scalarType: z.string().optional().describe('Optional scalar type IRI for typed literals'),
    langTag: z.string().optional().describe('Optional language tag for string literals'),
});

export const annotationParamSchema = z.object({
    property: z.string().describe('Annotation property name (e.g., "dc:title", "dc:description")'),
    literalValues: z.array(literalParamSchema).optional().describe('Literal values for the annotation'),
    referencedValues: z.array(z.string()).optional().describe('Referenced values (rarely used for annotations)'),
});

export const propertyValueParamSchema = z.object({
    property: z.string().describe('Property name with prefix (e.g., "base:description" for scalar, "requirement:isExpressedBy" for relation)'),
    literalValues: z.array(literalParamSchema).optional().describe('For SCALAR properties: [{type: "quoted", value: "text"}]'),
    referencedValues: z.array(z.string()).optional().describe('For RELATION assertions: ["InstanceName1", "InstanceName2"]'),
    containedValues: z.any().optional().describe('For anonymous nested instances (advanced)'),
});
