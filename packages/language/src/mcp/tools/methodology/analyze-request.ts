/**
 * Tool: analyze_methodology_request
 * 
 * Analyzes a user's request against Sierra methodology rules.
 * Returns validation errors, warnings, questions to ask, and corrections.
 * 
 * Use this BEFORE executing actions to ensure methodology compliance.
 */

import { z } from 'zod';
import * as fs from 'fs';
import { resolvePlaybookPath, loadPlaybook } from './playbook-helpers.js';
import type { MethodologyPlaybook, DescriptionConstraint } from './playbook-types.js';

export const analyzeMethodologyRequestTool = {
    name: 'analyze_methodology_request' as const,
    description: `Analyze a user request against Sierra methodology rules BEFORE executing it.

USE THIS TOOL FIRST when the user asks to:
- Create instances (requirements, stakeholders, components, etc.)
- Add relations between instances
- Modify existing instances

This tool acts as a "methodology advisor" that:
1. Validates the request against playbook rules
2. Identifies violations (e.g., "requirements must be expressed by stakeholders")
3. Suggests corrections
4. Generates questions to ask the user for missing information

WORKFLOW:
1. User: "Add a requirement for data persistence"
2. AI calls: analyze_methodology_request(action: "create requirement", details: {...})
3. Tool returns: { questionsToAsk: ["Which stakeholder expresses this requirement?"] }
4. AI asks user the question
5. User provides answer
6. AI proceeds with creation

IMPORTANT: If isValid=false and severity="error", DO NOT proceed with the action.
Instead, explain the violation and ask the user how to fix it.`,
    
    paramsSchema: {
        action: z.enum([
            'create_instance',
            'add_relation',
            'modify_instance',
            'delete_instance',
            'general_query'
        ]).describe('The type of action the user wants to perform'),
        
        instanceType: z.string().optional()
            .describe('The type of instance involved (e.g., "requirement:Requirement", "requirement:Stakeholder")'),
        
        instanceName: z.string().optional()
            .describe('The name of the instance (if known)'),
        
        relations: z.array(z.object({
            property: z.string().describe('The relation property (e.g., "requirement:isExpressedBy")'),
            targetName: z.string().describe('The target instance name'),
            targetType: z.string().optional().describe('The target instance type (if known)'),
        })).optional().describe('Relations being added or modified'),
        
        properties: z.record(z.string()).optional()
            .describe('Scalar properties being set (e.g., {"description": "...", "expression": "..."})'),
        
        descriptionPath: z.string().optional()
            .describe('Path to the description file where the instance will be created'),
        
        workspacePath: z.string().optional()
            .describe('Workspace path for playbook auto-detection'),
        
        freeformRequest: z.string().optional()
            .describe('The user\'s original request in natural language (for context)'),
    },
};

interface AnalysisResult {
    isValid: boolean;
    violations: Array<{
        rule: string;
        severity: 'error' | 'warning' | 'info';
        message: string;
        details?: string;
    }>;
    suggestedCorrections: string[];
    questionsToAsk: string[];
    missingRequired: string[];
    availableOptions: Record<string, string[]>;
    summary: string;
}

/**
 * Find instances of a given type in description files.
 */
function findInstancesOfType(
    workspacePath: string,
    targetType: string
): string[] {
    const instances: string[] = [];
    
    function scanDir(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = `${dir}/${entry.name}`;
                if (entry.isDirectory() && !entry.name.startsWith('.') && 
                    entry.name !== 'node_modules' && entry.name !== 'build') {
                    scanDir(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.oml')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        // Check if it's a description file
                        if (!content.match(/^\s*description\s+/m)) continue;
                        
                        // Find instances of the target type
                        // Pattern: instance <name> : <types>
                        const instancePattern = /instance\s+(\w+)\s*:\s*([^[\]]+?)(?:\s*\[|$)/gm;
                        let match;
                        while ((match = instancePattern.exec(content)) !== null) {
                            const name = match[1];
                            const types = match[2];
                            // Check if any type matches (handle both qualified and unqualified)
                            const typeList = types.split(',').map(t => t.trim());
                            const targetUnqualified = targetType.split(':').pop() || targetType;
                            for (const t of typeList) {
                                const tUnqualified = t.split(':').pop() || t;
                                if (t === targetType || tUnqualified === targetUnqualified) {
                                    instances.push(name);
                                    break;
                                }
                            }
                        }
                    } catch {
                        // Skip files we can't read
                    }
                }
            }
        } catch {
            // Skip directories we can't read
        }
    }
    
    scanDir(workspacePath);
    return instances;
}

/**
 * Check if an instance exists and get its type.
 */
function getInstanceType(
    workspacePath: string,
    instanceName: string
): string | null {
    function scanDir(dir: string): string | null {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = `${dir}/${entry.name}`;
                if (entry.isDirectory() && !entry.name.startsWith('.') && 
                    entry.name !== 'node_modules' && entry.name !== 'build') {
                    const found = scanDir(fullPath);
                    if (found) return found;
                } else if (entry.isFile() && entry.name.endsWith('.oml')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        // Find the instance declaration
                        const pattern = new RegExp(`instance\\s+${instanceName}\\s*:\\s*([^\\[\\]]+?)(?:\\s*\\[|$)`, 'm');
                        const match = content.match(pattern);
                        if (match) {
                            // Return first type
                            const types = match[1].split(',').map(t => t.trim());
                            return types[0] || null;
                        }
                    } catch {
                        // Skip files we can't read
                    }
                }
            }
        } catch {
            // Skip directories we can't read
        }
        return null;
    }
    
    return scanDir(workspacePath);
}

/**
 * Find constraints that apply to a given instance type.
 */
function findApplicableConstraints(
    playbook: MethodologyPlaybook,
    instanceType: string
): DescriptionConstraint[] {
    const applicable: DescriptionConstraint[] = [];
    
    if (!playbook.descriptions) return applicable;
    
    const typeUnqualified = instanceType.split(':').pop() || instanceType;
    
    for (const schema of Object.values(playbook.descriptions)) {
        for (const constraint of schema.constraints || []) {
            const appliesTo = constraint.appliesTo;
            
            // Check exact match
            if (appliesTo.conceptType === instanceType || 
                appliesTo.conceptType === typeUnqualified) {
                applicable.push(constraint);
                continue;
            }
            
            // Check pattern match
            if (appliesTo.conceptPattern) {
                const pattern = appliesTo.conceptPattern
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.');
                const regex = new RegExp(`^${pattern}$`, 'i');
                if (regex.test(instanceType) || regex.test(typeUnqualified)) {
                    applicable.push(constraint);
                    continue;
                }
            }
            
            // Check multiple types
            if (appliesTo.conceptTypes?.some(t => 
                t === instanceType || t === typeUnqualified ||
                t.split(':').pop() === typeUnqualified
            )) {
                applicable.push(constraint);
            }
        }
    }
    
    return applicable;
}

/**
 * Analyze the request and return validation results.
 */
function analyzeRequest(
    playbook: MethodologyPlaybook,
    params: {
        action: string;
        instanceType?: string;
        instanceName?: string;
        relations?: Array<{ property: string; targetName: string; targetType?: string }>;
        properties?: Record<string, string>;
        workspacePath: string;
    }
): AnalysisResult {
    const result: AnalysisResult = {
        isValid: true,
        violations: [],
        suggestedCorrections: [],
        questionsToAsk: [],
        missingRequired: [],
        availableOptions: {},
        summary: '',
    };
    
    const { instanceType, relations, properties, workspacePath } = params;
    // action is available for future use in different analysis modes
    
    if (!instanceType) {
        result.questionsToAsk.push('What type of instance do you want to create?');
        result.summary = 'Need more information about the instance type.';
        return result;
    }
    
    // Find applicable constraints
    const constraints = findApplicableConstraints(playbook, instanceType);
    
    if (constraints.length === 0) {
        result.summary = `No specific methodology rules found for "${instanceType}". Proceeding with standard validation.`;
        return result;
    }
    
    // Check each constraint
    for (const constraint of constraints) {
        for (const propConstraint of constraint.constraints || []) {
            const propName = propConstraint.property;
            const propUnqualified = propName.split(':').pop() || propName;
            
            // Find if this property is being set
            const relationForProp = relations?.find(r => {
                const rProp = r.property.split(':').pop() || r.property;
                return r.property === propName || rProp === propUnqualified;
            });
            
            const scalarForProp = properties?.[propName] || properties?.[propUnqualified];
            
            // Check if required
            if (propConstraint.required && !relationForProp && !scalarForProp) {
                result.missingRequired.push(propName);
                
                // Generate question based on property type
                if (propConstraint.targetMustBe) {
                    const targetType = propConstraint.targetMustBe;
                    const availableInstances = findInstancesOfType(workspacePath, targetType);
                    
                    if (availableInstances.length > 0) {
                        result.availableOptions[propName] = availableInstances;
                        result.questionsToAsk.push(
                            `Which ${targetType.split(':').pop()} should be linked via "${propUnqualified}"? ` +
                            `Available: ${availableInstances.join(', ')}`
                        );
                    } else {
                        result.questionsToAsk.push(
                            `Property "${propUnqualified}" is required but no ${targetType.split(':').pop()} instances exist. ` +
                            `Would you like to create one first?`
                        );
                    }
                } else {
                    result.questionsToAsk.push(
                        `What value should "${propUnqualified}" have? (required)`
                    );
                }
            }
            
            // Check target type constraints
            if (propConstraint.targetMustBe && relationForProp) {
                const expectedType = propConstraint.targetMustBe;
                const expectedUnqualified = expectedType.split(':').pop() || expectedType;
                
                // Get actual type of target
                let actualType = relationForProp.targetType;
                if (!actualType) {
                    actualType = getInstanceType(workspacePath, relationForProp.targetName) ?? undefined;
                }
                
                if (actualType) {
                    const actualUnqualified = actualType.split(':').pop() || actualType;
                    
                    // Check if types match
                    if (actualType !== expectedType && actualUnqualified !== expectedUnqualified) {
                        result.isValid = false;
                        result.violations.push({
                            rule: constraint.id,
                            severity: constraint.severity || 'error',
                            message: constraint.message,
                            details: `"${propUnqualified}" must reference a ${expectedUnqualified}, but "${relationForProp.targetName}" is a ${actualUnqualified}.`,
                        });
                        
                        // Find valid alternatives
                        const validInstances = findInstancesOfType(workspacePath, expectedType);
                        if (validInstances.length > 0) {
                            result.suggestedCorrections.push(
                                `Use one of these ${expectedUnqualified} instances instead: ${validInstances.join(', ')}`
                            );
                            result.availableOptions[propName] = validInstances;
                        } else {
                            result.suggestedCorrections.push(
                                `Create a ${expectedUnqualified} instance first, then reference it.`
                            );
                        }
                    }
                } else {
                    // Target instance not found
                    result.violations.push({
                        rule: constraint.id,
                        severity: 'warning',
                        message: `Cannot verify target type`,
                        details: `Instance "${relationForProp.targetName}" not found in workspace. Cannot verify it's a ${expectedUnqualified}.`,
                    });
                }
            }
            
            // Check targetMustBeOneOf
            if (propConstraint.targetMustBeOneOf && relationForProp) {
                const allowedTypes = propConstraint.targetMustBeOneOf;
                
                let actualType = relationForProp.targetType;
                if (!actualType) {
                    actualType = getInstanceType(workspacePath, relationForProp.targetName) ?? undefined;
                }
                
                if (actualType) {
                    const actualUnqualified = actualType.split(':').pop() || actualType;
                    const isAllowed = allowedTypes.some(t => {
                        const tUnqualified = t.split(':').pop() || t;
                        return t === actualType || tUnqualified === actualUnqualified;
                    });
                    
                    if (!isAllowed) {
                        result.isValid = false;
                        result.violations.push({
                            rule: constraint.id,
                            severity: constraint.severity || 'error',
                            message: constraint.message,
                            details: `"${propUnqualified}" must reference one of: ${allowedTypes.join(', ')}. But "${relationForProp.targetName}" is a ${actualType}.`,
                        });
                    }
                }
            }
        }
    }
    
    // Build summary
    if (result.violations.length > 0) {
        const errors = result.violations.filter(v => v.severity === 'error');
        const warnings = result.violations.filter(v => v.severity === 'warning');
        result.summary = `Found ${errors.length} error(s) and ${warnings.length} warning(s).`;
        if (errors.length > 0) {
            result.summary += ' Cannot proceed until errors are resolved.';
        }
    } else if (result.questionsToAsk.length > 0) {
        result.summary = `Need ${result.questionsToAsk.length} piece(s) of information before proceeding.`;
    } else {
        result.summary = 'Request validated successfully. Ready to proceed.';
    }
    
    return result;
}

export const analyzeMethodologyRequestHandler = async (params: {
    action: 'create_instance' | 'add_relation' | 'modify_instance' | 'delete_instance' | 'general_query';
    instanceType?: string;
    instanceName?: string;
    relations?: Array<{ property: string; targetName: string; targetType?: string }>;
    properties?: Record<string, string>;
    descriptionPath?: string;
    workspacePath?: string;
    freeformRequest?: string;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const workspacePath = params.workspacePath || process.cwd();
        
        // Load playbook
        let playbook: MethodologyPlaybook | null = null;
        try {
            const playbookPath = resolvePlaybookPath({ workspacePath });
            playbook = loadPlaybook(playbookPath);
        } catch {
            return {
                content: [{
                    type: 'text',
                    text: `# No Methodology Playbook Found\n\n` +
                        `Cannot analyze request against methodology rules without a playbook.\n\n` +
                        `To enable methodology enforcement:\n` +
                        `1. Use \`extract_description_schemas\` to generate a playbook\n` +
                        `2. Or create a \`*_playbook.yaml\` file manually\n\n` +
                        `Proceeding without methodology validation.`,
                }],
            };
        }
        
        // Analyze the request
        const result = analyzeRequest(playbook, {
            action: params.action,
            instanceType: params.instanceType,
            instanceName: params.instanceName,
            relations: params.relations,
            properties: params.properties,
            workspacePath,
        });
        
        // Format output
        const lines: string[] = [];
        
        lines.push(`# Methodology Analysis`);
        lines.push(``);
        
        if (params.freeformRequest) {
            lines.push(`**Request:** "${params.freeformRequest}"`);
            lines.push(``);
        }
        
        // Status indicator
        if (result.isValid && result.questionsToAsk.length === 0) {
            lines.push(`## ✅ Valid Request`);
        } else if (result.violations.some(v => v.severity === 'error')) {
            lines.push(`## ❌ Invalid Request`);
        } else if (result.questionsToAsk.length > 0) {
            lines.push(`## ❓ Need More Information`);
        } else {
            lines.push(`## ⚠️ Warnings`);
        }
        lines.push(``);
        lines.push(result.summary);
        lines.push(``);
        
        // Violations
        if (result.violations.length > 0) {
            lines.push(`## Violations`);
            lines.push(``);
            for (const v of result.violations) {
                const icon = v.severity === 'error' ? '🚫' : v.severity === 'warning' ? '⚠️' : 'ℹ️';
                lines.push(`### ${icon} ${v.message}`);
                if (v.details) {
                    lines.push(v.details);
                }
                lines.push(`- Rule: \`${v.rule}\``);
                lines.push(`- Severity: ${v.severity}`);
                lines.push(``);
            }
        }
        
        // Questions to ask
        if (result.questionsToAsk.length > 0) {
            lines.push(`## Questions to Ask User`);
            lines.push(``);
            for (const q of result.questionsToAsk) {
                lines.push(`- ${q}`);
            }
            lines.push(``);
        }
        
        // Suggested corrections
        if (result.suggestedCorrections.length > 0) {
            lines.push(`## Suggested Corrections`);
            lines.push(``);
            for (const c of result.suggestedCorrections) {
                lines.push(`- ${c}`);
            }
            lines.push(``);
        }
        
        // Available options
        if (Object.keys(result.availableOptions).length > 0) {
            lines.push(`## Available Options`);
            lines.push(``);
            for (const [prop, options] of Object.entries(result.availableOptions)) {
                lines.push(`**${prop}:** ${options.join(', ')}`);
            }
            lines.push(``);
        }
        
        // JSON for programmatic use
        lines.push(`## Analysis Data (JSON)`);
        lines.push(``);
        lines.push('```json');
        lines.push(JSON.stringify({
            isValid: result.isValid,
            hasErrors: result.violations.some(v => v.severity === 'error'),
            hasWarnings: result.violations.some(v => v.severity === 'warning'),
            needsMoreInfo: result.questionsToAsk.length > 0,
            missingRequired: result.missingRequired,
            availableOptions: result.availableOptions,
        }, null, 2));
        lines.push('```');
        
        // Guidance for AI
        lines.push(``);
        lines.push(`---`);
        if (result.violations.some(v => v.severity === 'error')) {
            lines.push(`**⛔ DO NOT proceed with this action.** Explain the violations to the user and ask how they want to fix it.`);
        } else if (result.questionsToAsk.length > 0) {
            lines.push(`**❓ Ask the user** the questions above before proceeding.`);
        } else if (result.violations.some(v => v.severity === 'warning')) {
            lines.push(`**⚠️ Warn the user** about the issues above, but you may proceed if they confirm.`);
        } else {
            lines.push(`**✅ You may proceed** with the action.`);
        }
        
        return {
            content: [{ type: 'text', text: lines.join('\n') }],
        };
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                type: 'text',
                text: `**Error analyzing request:**\n\n${errorMsg}`,
            }],
            isError: true,
        };
    }
};
