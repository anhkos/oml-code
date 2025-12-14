import { z } from 'zod';

export const literalParamSchema = z.object({
    type: z.enum(['integer', 'decimal', 'double', 'boolean', 'quoted']),
    value: z.union([z.string(), z.number(), z.boolean()]),
    scalarType: z.string().optional(),
    langTag: z.string().optional(),
});

export const annotationParamSchema = z.object({
    property: z.string(),
    literalValues: z.array(literalParamSchema).optional(),
    referencedValues: z.array(z.string()).optional(),
});

export const propertyValueParamSchema = z.object({
    property: z.string(),
    literalValues: z.array(literalParamSchema).optional(),
    referencedValues: z.array(z.string()).optional(),
    containedValues: z.any().optional(),
});
