/**
 * Tool: prepare_instance
 * 
 * Prepares instance creation by applying templates from the playbook.
 * Generates instance names based on naming patterns and maps semantic
 * fields to OML properties.
 * 
 * This tool helps AI models create instances with:
 * 1. Correct naming conventions (e.g., R1, R2 for requirements)
 * 2. Proper property mappings (description = name, expression = text)
 * 3. Required relations pre-populated
 */

import { z } from 'zod';
import * as fs from 'fs';
import { resolvePlaybookPath, loadPlaybook } from './playbook-helpers.js';
import type { MethodologyPlaybook, InstanceTemplate, NamingPattern, PropertyMapping, AppliesTo } from './playbook-types.js';

export const prepareInstanceTool = {
    name: 'prepare_instance' as const,
    description: `Prepare instance creation using methodology templates.

USE THIS TOOL BEFORE creating instances to get:
1. **Auto-generated name** based on naming conventions (e.g., R1, R2, R3 for requirements)
2. **Property mappings** that translate user-friendly fields to OML properties
3. **Required properties** pre-filled according to methodology

WORKFLOW:
1. Call prepare_instance with the concept type and semantic fields
2. Use the returned values with create_concept_instance

EXAMPLE - Creating a Requirement:
  Input:
    instanceType: "requirement:Requirement"
    fields: {
      "name": "Real-Time Map",
      "text": "The system shall display fire locations.",
      "expressedBy": "Operator"
    }
  
  Output:
    suggestedName: "R3"
    propertyValues: [
      { property: "base:description", literalValues: [{ type: "quoted", value: "Real-Time Map" }] },
      { property: "base:expression", literalValues: [{ type: "quoted", value: "The system shall display fire locations." }] },
      { property: "requirement:isExpressedBy", referencedValues: ["Operator"] }
    ]

This makes it easy for the user to say "add a requirement called X with text Y expressed by Z"
and have the tool figure out the proper OML structure.`,
    
    paramsSchema: {
        instanceType: z.string().describe('The concept type (e.g., "requirement:Requirement", "requirement:Stakeholder")'),
        fields: z.record(z.string()).describe('Semantic fields provided by the user (e.g., {"name": "...", "text": "...", "expressedBy": "..."})'),
        descriptionPath: z.string().optional().describe('Path to the description file (for counting existing instances)'),
        workspacePath: z.string().optional().describe('Workspace path for auto-detection'),
    },
};

/**
 * Check if a type matches an AppliesTo specification.
 */
function matchesAppliesTo(instanceType: string, appliesTo: AppliesTo): boolean {
    // Exact match
    if (appliesTo.conceptType && appliesTo.conceptType === instanceType) {
        return true;
    }
    
    // Pattern match
    if (appliesTo.conceptPattern) {
        const pattern = appliesTo.conceptPattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${pattern}$`, 'i');
        if (regex.test(instanceType)) {
            return true;
        }
    }
    
    // Multiple types
    if (appliesTo.conceptTypes?.includes(instanceType)) {
        return true;
    }
    
    // Check unqualified name
    const unqualified = instanceType.split(':').pop() || instanceType;
    if (appliesTo.conceptType?.endsWith(`:${unqualified}`) || appliesTo.conceptType === unqualified) {
        return true;
    }
    
    if (appliesTo.conceptPattern) {
        const pattern = appliesTo.conceptPattern
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(`^${pattern}$`, 'i');
        if (regex.test(unqualified)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Find the template that applies to a given instance type.
 */
function findTemplate(instanceType: string, templates: InstanceTemplate[]): InstanceTemplate | null {
    // First, try exact match
    for (const template of templates) {
        if (template.appliesTo.conceptType === instanceType) {
            return template;
        }
    }
    
    // Then try pattern/multi-type matches
    for (const template of templates) {
        if (matchesAppliesTo(instanceType, template.appliesTo)) {
            return template;
        }
    }
    
    return null;
}

/**
 * Count existing instances that match a naming pattern in a description file.
 */
function countExistingInstances(descriptionPath: string, prefix: string): number {
    if (!fs.existsSync(descriptionPath)) {
        return 0;
    }
    
    try {
        const content = fs.readFileSync(descriptionPath, 'utf-8');
        
        // Match instances like "instance R1", "instance R2", etc.
        const pattern = new RegExp(`instance\\s+${prefix}(\\d+)`, 'g');
        const matches = [...content.matchAll(pattern)];
        
        if (matches.length === 0) {
            return 0;
        }
        
        // Find the highest number
        const numbers = matches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n));
        return Math.max(0, ...numbers);
    } catch {
        return 0;
    }
}

/**
 * Generate the next instance name based on a naming pattern.
 */
function generateNextName(
    pattern: NamingPattern, 
    existingCount: number
): string {
    const nextNumber = existingCount + (pattern.startFrom ?? 1);
    
    let counter: string;
    switch (pattern.counterStyle) {
        case 'padded':
            const width = pattern.paddingWidth ?? 3;
            counter = nextNumber.toString().padStart(width, '0');
            break;
        case 'alpha':
            // A=1, B=2, ... Z=26, AA=27, etc.
            counter = numberToAlpha(nextNumber);
            break;
        case 'number':
        default:
            counter = nextNumber.toString();
    }
    
    return `${pattern.prefix}${counter}${pattern.suffix ?? ''}`;
}

/**
 * Convert a number to alpha representation (1=A, 2=B, ..., 27=AA).
 */
function numberToAlpha(num: number): string {
    let result = '';
    while (num > 0) {
        num--;
        result = String.fromCharCode(65 + (num % 26)) + result;
        num = Math.floor(num / 26);
    }
    return result || 'A';
}

/**
 * Build property values from semantic fields using property mappings.
 */
function mapFieldsToProperties(
    fields: Record<string, string>,
    mappings: PropertyMapping[]
): Array<{
    property: string;
    literalValues?: Array<{ type: string; value: string }>;
    referencedValues?: string[];
}> {
    const propertyValues: Array<{
        property: string;
        literalValues?: Array<{ type: string; value: string }>;
        referencedValues?: string[];
    }> = [];
    
    for (const mapping of mappings) {
        // Check if user provided this field (case-insensitive)
        const fieldKey = Object.keys(fields).find(
            k => k.toLowerCase() === mapping.mapsFrom.toLowerCase()
        );
        
        let value = fieldKey ? fields[fieldKey] : mapping.defaultValue;
        
        if (!value && mapping.required) {
            // Required but not provided - leave it for the AI to ask
            continue;
        }
        
        if (!value) {
            continue;
        }
        
        if (mapping.valueType === 'literal') {
            propertyValues.push({
                property: mapping.property,
                literalValues: [{
                    type: mapping.literalType ?? 'quoted',
                    value: value,
                }],
            });
        } else if (mapping.valueType === 'reference') {
            // Handle comma-separated references
            const refs = value.split(',').map(v => v.trim()).filter(Boolean);
            propertyValues.push({
                property: mapping.property,
                referencedValues: refs,
            });
        }
    }
    
    return propertyValues;
}

/**
 * Get default templates for common types.
 */
function getDefaultTemplates(): InstanceTemplate[] {
    return [
        {
            id: 'requirement-template',
            appliesTo: { conceptPattern: '*Requirement' },
            description: 'Template for requirement instances',
            naming: {
                prefix: 'R',
                counterStyle: 'number',
            },
            propertyMappings: [
                {
                    property: 'base:description',
                    mapsFrom: 'name',
                    valueType: 'literal',
                    literalType: 'quoted',
                    required: true,
                    description: 'Short name/title of the requirement',
                },
                {
                    property: 'base:expression',
                    mapsFrom: 'text',
                    valueType: 'literal',
                    literalType: 'quoted',
                    required: true,
                    description: 'The full requirement statement (shall statement)',
                },
                {
                    property: 'requirement:isExpressedBy',
                    mapsFrom: 'expressedBy',
                    valueType: 'reference',
                    required: true,
                    description: 'The stakeholder who expresses this requirement',
                },
            ],
            example: {
                input: {
                    name: 'Real-Time Map',
                    text: 'The system shall display real-time fire locations.',
                    expressedBy: 'Operator',
                },
                output: 'instance R1 : requirement:Requirement [\n  base:description "Real-Time Map"\n  base:expression "The system shall display real-time fire locations."\n  requirement:isExpressedBy Operator\n]',
            },
        },
        {
            id: 'stakeholder-template',
            appliesTo: { conceptPattern: '*Stakeholder' },
            description: 'Template for stakeholder instances',
            naming: {
                prefix: 'SH',
                counterStyle: 'number',
            },
            propertyMappings: [
                {
                    property: 'base:description',
                    mapsFrom: 'description',
                    valueType: 'literal',
                    literalType: 'quoted',
                    required: false,
                    description: 'Description of the stakeholder role',
                },
            ],
        },
        {
            id: 'component-template',
            appliesTo: { conceptPattern: '*Component' },
            description: 'Template for component instances',
            naming: {
                prefix: 'C',
                counterStyle: 'number',
            },
            propertyMappings: [
                {
                    property: 'base:description',
                    mapsFrom: 'description',
                    valueType: 'literal',
                    literalType: 'quoted',
                    required: false,
                },
            ],
        },
    ];
}

export const prepareInstanceHandler = async (params: {
    instanceType: string;
    fields: Record<string, string>;
    descriptionPath?: string;
    workspacePath?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const { instanceType, fields, descriptionPath } = params;
        const workspacePath = params.workspacePath || process.cwd();
        
        // Load playbook to get templates
        let playbook: MethodologyPlaybook | null = null;
        try {
            const playbookPath = resolvePlaybookPath({ workspacePath });
            playbook = loadPlaybook(playbookPath);
        } catch {
            // No playbook - use defaults
        }
        
        // Get templates (from playbook or defaults)
        const templates = playbook?.instanceTemplates ?? getDefaultTemplates();
        
        // Find matching template
        const template = findTemplate(instanceType, templates);
        
        const lines: string[] = [];
        lines.push(`# Instance Preparation: ${instanceType}`);
        lines.push(``);
        
        if (!template) {
            lines.push(`## ⚠️ No Template Found`);
            lines.push(``);
            lines.push(`No template defined for "${instanceType}".`);
            lines.push(`Using raw fields as property values.`);
            lines.push(``);
            
            // Just pass through fields as-is
            const propertyValues = Object.entries(fields).map(([key, value]) => ({
                property: key.includes(':') ? key : `base:${key}`,
                literalValues: [{ type: 'quoted', value }],
            }));
            
            lines.push(`## Property Values`);
            lines.push('```json');
            lines.push(JSON.stringify(propertyValues, null, 2));
            lines.push('```');
            
            return {
                content: [{ type: 'text', text: lines.join('\n') }],
            };
        }
        
        lines.push(`## Template: ${template.id}`);
        if (template.description) {
            lines.push(template.description);
        }
        lines.push(``);
        
        // Generate name if pattern exists
        let suggestedName: string | null = null;
        if (template.naming) {
            const existingCount = descriptionPath 
                ? countExistingInstances(descriptionPath, template.naming.prefix)
                : 0;
            suggestedName = generateNextName(template.naming, existingCount);
            
            lines.push(`## Suggested Name`);
            lines.push(`**${suggestedName}**`);
            lines.push(``);
            lines.push(`- Pattern: ${template.naming.prefix}${template.naming.counterStyle === 'padded' ? '###' : '#'}`);
            lines.push(`- Existing count: ${existingCount}`);
            lines.push(``);
        }
        
        // Map fields to properties
        const propertyValues = mapFieldsToProperties(fields, template.propertyMappings);
        
        // Check for missing required fields
        const missingRequired = template.propertyMappings
            .filter(m => m.required)
            .filter(m => !Object.keys(fields).some(k => k.toLowerCase() === m.mapsFrom.toLowerCase()));
        
        if (missingRequired.length > 0) {
            lines.push(`## ⚠️ Missing Required Fields`);
            for (const m of missingRequired) {
                lines.push(`- **${m.mapsFrom}**: ${m.description ?? `Maps to ${m.property}`}`);
            }
            lines.push(``);
            lines.push(`Please ask the user for these fields before creating the instance.`);
            lines.push(``);
        }
        
        // Show property mappings
        lines.push(`## Property Mappings`);
        lines.push(``);
        lines.push(`| User Field | OML Property | Value |`);
        lines.push(`|------------|--------------|-------|`);
        for (const mapping of template.propertyMappings) {
            const fieldKey = Object.keys(fields).find(k => k.toLowerCase() === mapping.mapsFrom.toLowerCase());
            const value = fieldKey ? fields[fieldKey] : (mapping.defaultValue || '(not provided)');
            const status = mapping.required && !fieldKey ? '❌' : '✅';
            lines.push(`| ${status} ${mapping.mapsFrom} | ${mapping.property} | ${value.substring(0, 40)}${value.length > 40 ? '...' : ''} |`);
        }
        lines.push(``);
        
        // Output the ready-to-use data
        lines.push(`## Ready-to-Use Data`);
        lines.push(``);
        lines.push(`Use these values with \`create_concept_instance\`:`);
        lines.push(``);
        lines.push('```json');
        lines.push(JSON.stringify({
            name: suggestedName ?? fields.name ?? 'PROVIDE_NAME',
            types: [instanceType],
            propertyValues,
        }, null, 2));
        lines.push('```');
        
        // Show example if available
        if (template.example) {
            lines.push(``);
            lines.push(`## Example`);
            lines.push(``);
            lines.push(`Input fields:`);
            lines.push('```json');
            lines.push(JSON.stringify(template.example.input, null, 2));
            lines.push('```');
            lines.push(``);
            lines.push(`Generated OML:`);
            lines.push('```oml');
            lines.push(template.example.output);
            lines.push('```');
        }
        
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
        };
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                type: 'text',
                text: `**Error preparing instance:**\n\n${errorMsg}`,
            }],
            isError: true,
        };
    }
};
