/**
 * Zod schemas for runtime validation of playbook YAML files.
 * Ensures type safety and catches configuration errors early.
 */

import { z } from 'zod';
import type { MethodologyPlaybook } from './playbook-types.js';

/**
 * Zod schema for AppliesTo.
 * Validates at runtime to catch YAML errors early.
 */
export const AppliesToSchema = z.object({
    conceptType: z.string().optional().describe('Exact concept type to match'),
    matchSubtypes: z.boolean().optional().default(false).describe('Include subtypes of conceptType'),
    conceptPattern: z.string().optional().describe('Pattern with wildcards (e.g., "*Requirement")'),
    conceptTypes: z.array(z.string()).optional().describe('Match any of these types'),
    anySubtypeOf: z.string().optional().describe('Match any subtype of this base type')
}).refine(
    data => data.conceptType || data.conceptPattern || data.conceptTypes || data.anySubtypeOf,
    { message: "At least one matching strategy must be specified (conceptType, conceptPattern, conceptTypes, or anySubtypeOf)" }
);

/**
 * Zod schema for PropertyConstraint.
 */
export const PropertyConstraintSchema = z.object({
    property: z.string().describe('Property name (e.g., "isExpressedBy", "description")'),
    targetMustBe: z.string().optional().describe('Target must be this type'),
    targetMatchSubtypes: z.boolean().optional().default(false).describe('Allow subtypes of target'),
    targetMustBeOneOf: z.array(z.string()).optional().describe('Target must be one of these types'),
    required: z.boolean().optional().describe('Property must exist'),
    minOccurrences: z.number().int().min(0).optional().describe('Minimum number of values'),
    maxOccurrences: z.number().int().min(0).optional().describe('Maximum number of values')
}).refine(
    data => {
        // If maxOccurrences is set, it should be >= minOccurrences
        if (data.minOccurrences !== undefined && data.maxOccurrences !== undefined) {
            return data.maxOccurrences >= data.minOccurrences;
        }
        return true;
    },
    { message: "maxOccurrences must be greater than or equal to minOccurrences" }
);

/**
 * Zod schema for DescriptionConstraint.
 */
export const DescriptionConstraintSchema = z.object({
    id: z.string().describe('Unique identifier for this rule'),
    message: z.string().describe('Human-readable message'),
    appliesTo: AppliesToSchema,
    constraints: z.array(PropertyConstraintSchema).min(1).describe('Array of property constraints'),
    severity: z.enum(['error', 'warning', 'info']).optional().default('error'),
    rationale: z.string().optional().describe('Rationale for this rule')
});

/**
 * Zod schema for DescriptionSchema.
 */
export const DescriptionSchemaSchema = z.object({
    file: z.string().describe('File path or name'),
    purpose: z.string().describe('Human-readable purpose'),
    allowedTypes: z.array(z.string()).min(1).describe('Allowed instance types in this description'),
    routing: z.array(z.object({
        concept: z.string(),
        priority: z.number().int().min(1).describe('1 = highest priority')
    })).describe('Routing priorities for LLM placement'),
    constraints: z.array(DescriptionConstraintSchema).describe('Constraints specific to this description')
});

/**
 * Zod schema for RelationRule.
 */
export const RelationRuleSchema = z.object({
    forwardRelation: z.string(),
    reverseRelation: z.string(),
    owningConcept: z.string(),
    preferredDirection: z.enum(['forward', 'reverse']),
    rationale: z.string().optional(),
    sourceFile: z.string().optional()
});

/**
 * Zod schema for PlaybookMetadata.
 */
export const PlaybookMetadataSchema = z.object({
    methodology: z.string(),
    version: z.string(),
    generatedAt: z.string(),
    sourceVocabularies: z.array(z.string())
});

/**
 * Complete playbook schema.
 */
export const MethodologyPlaybookSchema = z.object({
    metadata: PlaybookMetadataSchema,
    relationRules: z.array(RelationRuleSchema),
    relationEntityRules: z.array(z.any()).optional(),
    conceptRules: z.array(z.any()).optional(),
    containmentRules: z.array(z.any()).optional(),
    allocationRules: z.array(z.any()).optional(),
    descriptions: z.record(z.string(), DescriptionSchemaSchema).optional().describe('Description-level schemas')
});

/**
 * Validate a playbook YAML against schema.
 * Throws detailed error if invalid.
 * 
 * @param playbook - Parsed YAML object to validate
 * @throws {Error} If validation fails, with detailed error messages
 */
export function validatePlaybookSchema(playbook: unknown): asserts playbook is MethodologyPlaybook {
    const result = MethodologyPlaybookSchema.safeParse(playbook);
    
    if (!result.success) {
        const errors = result.error.errors.map(e => {
            const path = e.path.length > 0 ? e.path.join('.') : 'root';
            return `  - ${path}: ${e.message}`;
        }).join('\n');
        
        throw new Error(`Playbook schema validation failed:\n${errors}`);
    }
}

/**
 * Validate just the descriptions section of a playbook.
 * Useful for incremental validation during schema extraction.
 * 
 * @param descriptions - Descriptions object to validate
 * @throws {Error} If validation fails
 */
export function validateDescriptionSchemas(descriptions: unknown): void {
    const schema = z.record(z.string(), DescriptionSchemaSchema);
    const result = schema.safeParse(descriptions);
    
    if (!result.success) {
        const errors = result.error.errors.map(e => {
            const path = e.path.length > 0 ? e.path.join('.') : 'root';
            return `  - ${path}: ${e.message}`;
        }).join('\n');
        
        throw new Error(`Description schema validation failed:\n${errors}`);
    }
}

/**
 * Validate a single DescriptionConstraint.
 * Useful during rule generation.
 * 
 * @param constraint - Constraint to validate
 * @returns Validation result with success flag and error details
 */
export function validateConstraint(constraint: unknown): { success: boolean; errors?: string[] } {
    const result = DescriptionConstraintSchema.safeParse(constraint);
    
    if (!result.success) {
        return {
            success: false,
            errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        };
    }
    
    return { success: true };
}
