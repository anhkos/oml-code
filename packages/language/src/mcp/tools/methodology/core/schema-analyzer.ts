/**
 * Schema Analyzer: Description schema extraction and analysis
 * 
 * This module provides logic for:
 * - Analyzing description files to extract their structure
 * - Building description schemas from instances
 * - Inferring purposes and patterns from file structure
 * - Merging schemas into playbooks
 */

import { DescriptionSchema, InstanceTemplate, NamingPattern } from '../playbook-types.js';

/**
 * Information extracted from analyzing a description file
 */
export interface DescriptionAnalysis {
    filePath: string;
    fileName: string;
    instanceCount: number;
    types: Set<string>;
    properties: Map<string, Set<string>>;
    relations: Map<string, Set<string>>;
    namingPatterns: NamingPattern[];
}

/**
 * Generate a description schema from analysis results
 * Creates schema structure that can be added to playbooks
 *
 * @param analysis Results from analyzing a description file
 * @param purpose Optional description schema purpose
 * @returns Schema object ready for playbook integration
 */
export function generateDescriptionSchema(
    analysis: DescriptionAnalysis,
    purpose?: string,
): DescriptionSchema {
    return {
        file: analysis.filePath,
        purpose: purpose || inferPurpose(analysis.fileName, Array.from(analysis.types)),
        allowedTypes: Array.from(analysis.types),
        routing: Array.from(analysis.types).map((type, index) => ({
            concept: type,
            priority: index + 1,
        })),
        constraints: [],
    };
}

/**
 * Infer purpose of a description file from its name and types
 * Uses heuristics based on common naming patterns
 *
 * @param fileName Name of the description file
 * @param types Types used in the description
 * @returns Inferred purpose string
 */
export function inferPurpose(fileName: string, types: string[]): string {
    const fileBaseName = fileName.replace('.oml', '').toLowerCase();

    // Check for common patterns
    if (
        fileBaseName.includes('requirement') ||
        fileBaseName.includes('req') ||
        types.some((t) => t.toLowerCase().includes('requirement'))
    ) {
        return 'Requirement specification and management';
    }

    if (
        fileBaseName.includes('system') ||
        fileBaseName.includes('sys') ||
        types.some((t) => t.toLowerCase().includes('system'))
    ) {
        return 'System architecture and design';
    }

    if (
        fileBaseName.includes('interface') ||
        fileBaseName.includes('api') ||
        types.some((t) => t.toLowerCase().includes('interface'))
    ) {
        return 'Interface and API definitions';
    }

    if (
        fileBaseName.includes('data') ||
        fileBaseName.includes('db') ||
        fileBaseName.includes('schema')
    ) {
        return 'Data and schema definitions';
    }

    if (fileBaseName.includes('test') || fileBaseName.includes('tc')) {
        return 'Test cases and test scenarios';
    }

    if (fileBaseName.includes('config') || fileBaseName.includes('cfg')) {
        return 'Configuration and parameters';
    }

    // Default based on instance count
    if (types.length > 5) {
        return 'Complex domain model with multiple entity types';
    }

    return `Description of ${types.length > 0 ? types.join(', ') : 'various concepts'}`;
}

/**
 * Detect common naming patterns used in a description file
 * Returns array of naming patterns that can be documented
 *
 * @param instanceNames Array of instance names from description
 * @returns Array of inferred naming patterns
 */
export function detectNamingPatterns(instanceNames: string[]): NamingPattern[] {
    const patterns: NamingPattern[] = [];

    if (instanceNames.length === 0) return patterns;

    // Check for numeric suffix pattern (e.g., Req1, Req2, Req3)
    const numericSuffix = instanceNames.filter((n) => /\d+$/.test(n));
    if (numericSuffix.length > instanceNames.length * 0.5) {
        const prefix = numericSuffix[0]?.replace(/\d+$/, '');
        if (prefix) {
            patterns.push({
                prefix: prefix,
                counterStyle: 'number',
                startFrom: 1,
            });
        }
    }

    // Check for padded numeric pattern
    const paddedNumeric = instanceNames.filter((n) => /0\d+$/.test(n));
    if (paddedNumeric.length > instanceNames.length * 0.5) {
        patterns.push({
            prefix: 'padded_numeric',
            counterStyle: 'padded',
            paddingWidth: 3,
            startFrom: 1,
        });
    }

    // Check for alpha suffix pattern (e.g., ReqA, ReqB)
    const alphaSuffix = instanceNames.filter((n) => /[A-Z]$/.test(n));
    if (alphaSuffix.length > instanceNames.length * 0.5) {
        patterns.push({
            prefix: 'alpha_suffix',
            counterStyle: 'alpha',
            startFrom: 1,
        });
    }

    return patterns;
}

/**
 * Create instance template from analyzed instances
 * Provides structure for creating new instances of a type
 *
 * @param typeName Name of the type
 * @param count How many instances of this type were found
 * @param commonProperties Common properties used across instances
 * @returns Template for creating new instances
 */
export function createInstanceTemplate(
    typeName: string,
    count: number,
    commonProperties: string[],
): InstanceTemplate {
    const prefix = sanitizeId(typeName).substring(0, 3).toUpperCase();
    
    return {
        id: `${prefix}_template_${count}`,
        appliesTo: {
            conceptType: typeName,
        },
        naming: {
            prefix: prefix,
            counterStyle: 'number',
            startFrom: 1,
        },
        propertyMappings: commonProperties.map((prop) => ({
            property: prop,
            mapsFrom: prop.toLowerCase(),
            valueType: 'literal',
            required: false,
        })),
        description: `Template for creating ${typeName} instances`,
    };
}

/**
 * Sanitize a string for use as an OML identifier
 * Removes special characters and spaces, converts to valid identifier
 *
 * @param str String to sanitize
 * @returns Valid OML identifier
 */
export function sanitizeId(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

/**
 * Merge new schemas into existing playbook schemas
 * Handles deduplication and updates
 *
 * @param existing Existing schemas array
 * @param newSchemas New schemas to merge
 * @returns Merged schemas array
 */
export function mergeSchemas(
    existing: DescriptionSchema[],
    newSchemas: DescriptionSchema[],
): DescriptionSchema[] {
    const result = new Map(existing.map((s) => [s.file, s]));

    for (const schema of newSchemas) {
        result.set(schema.file, schema);
    }

    return Array.from(result.values());
}

/**
 * Validate that a description schema has required fields
 */
export function validateDescriptionSchema(schema: DescriptionSchema): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!schema.file) errors.push('Schema missing required field: file');
    if (!schema.purpose) errors.push('Schema missing required field: purpose');
    if (!schema.allowedTypes || schema.allowedTypes.length === 0) {
        errors.push('Schema missing required field: allowedTypes');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
