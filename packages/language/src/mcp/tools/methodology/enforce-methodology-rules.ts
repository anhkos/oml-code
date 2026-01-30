import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import {
    isDescription,
    isConceptInstance,
    isRelationInstance,
    Description,
    ConceptInstance,
    RelationInstance,
} from '../../../generated/ast.js';
import { resolveWorkspacePath } from '../common.js';
import {
    MethodologyPlaybook,
    PlaybookValidationResult,
    PlaybookViolation,
    PlaybookCorrection,
    RelationRule,
    DescriptionSchema,
} from './playbook-types.js';
import { 
    getApplicableRules, 
    validatePropertyConstraint, 
    isTypeAllowed 
} from './rule-engine.js';

export const enforceMethodologyRulesTool = {
    name: 'enforce_methodology_rules' as const,
    description: `Validate OML description files against a methodology playbook.

USE THIS TOOL when the user asks:
- "Check my OML file for methodology issues"  
- "Validate this description against the playbook"
- "Are there any wrong relation directions?"
- "Fix my OML code"

AUTO-DETECTION:
- Playbook: Searches up the directory tree for *_playbook.yaml files
- Just provide the description file path - it will find the playbook

MINIMAL CALL (auto-detects playbook):
{
  "descriptionPath": "/path/to/stakeholders_requirements.oml"
}

EXPLICIT CALL:
{
  "playbookPath": "/path/to/methodology_playbook.yaml",
  "descriptionPath": "/path/to/stakeholders_requirements.oml"
}

RETURNS:
- Violations found (wrong relation directions, disallowed types, etc.)
- Suggested corrections with corrected code
- Formatted markdown report`,
    paramsSchema: {
        playbookPath: z.string().optional().describe('Path to YAML playbook file (auto-detects if not provided)'),
        methodologyName: z.string().optional().describe('Methodology name like "Sierra" to help find playbook'),
        descriptionPath: z.string().optional().describe('Path to OML description file to validate'),
        descriptionCode: z.string().optional().describe('Raw OML code to validate (instead of file)'),
        workspacePath: z.string().optional().describe('Workspace root for auto-detection (defaults to CWD)'),
        autoCorrect: z.boolean().optional().describe('If true, return corrected code'),
        mode: z.enum(['validate', 'transform', 'suggest']).optional().describe('Output mode'),
    },
};

/**
 * Load and parse the playbook YAML file.
 */
function loadPlaybook(playbookPath: string): MethodologyPlaybook {
    const resolvedPath = resolveWorkspacePath(playbookPath);
    
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Playbook not found: ${resolvedPath}`);
    }
    
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return yaml.load(content) as MethodologyPlaybook;
}

/**
 * Auto-detect playbook path from methodology name.
 * Walks up directory tree looking for *_playbook.yaml files.
 * Returns the first (nearest/most specific) one found.
 */
function detectPlaybookPath(methodologyName: string, startFromPath?: string): string | null {
    const path = require('path');
    const methodologyLower = methodologyName.toLowerCase();
    
    // Start from the description file's directory or workspace root
    let currentDir = startFromPath 
        ? path.dirname(resolveWorkspacePath(startFromPath))
        : process.cwd();
    
    // Walk up the directory tree (max 10 levels to avoid infinite loops)
    const maxLevels = 10;
    let level = 0;
    
    while (level < maxLevels) {
        // Check for any playbook files in current directory
        try {
            const files = fs.readdirSync(currentDir);
            
            // Look for exact methodology match first
            const exactMatch = files.find(f => 
                f.toLowerCase() === `${methodologyLower}_playbook.yaml` ||
                f.toLowerCase() === `${methodologyLower}_methodology.yaml`
            );
            
            if (exactMatch) {
                const candidate = path.join(currentDir, exactMatch);
                console.error(`[enforce_methodology_rules] Found playbook: ${candidate}`);
                return candidate;
            }
            
            // Then look for generic playbook files
            const genericMatch = files.find(f => 
                f.toLowerCase() === 'methodology_playbook.yaml' ||
                f.toLowerCase() === 'playbook.yaml'
            );
            
            if (genericMatch) {
                const candidate = path.join(currentDir, genericMatch);
                console.error(`[enforce_methodology_rules] Found playbook: ${candidate}`);
                return candidate;
            }
        } catch (err) {
            // Directory read failed, move up
        }
        
        // Move to parent directory
        const parentDir = path.dirname(currentDir);
        
        // Stop if we've reached filesystem root
        if (parentDir === currentDir) {
            break;
        }
        
        currentDir = parentDir;
        level++;
    }
    
    console.error(`[enforce_methodology_rules] Could not find playbook for "${methodologyName}"`);
    return null;
}

/**
 * Build lookup maps for quick rule access.
 */
interface RuleLookups {
    /** Map from forward relation to rule */
    forwardToRule: Map<string, RelationRule>;
    /** Map from reverse relation to rule */
    reverseToRule: Map<string, RelationRule>;
    /** All relation names that have rules */
    allRelationNames: Set<string>;
}

function buildRuleLookups(playbook: MethodologyPlaybook): RuleLookups {
    const forwardToRule = new Map<string, RelationRule>();
    const reverseToRule = new Map<string, RelationRule>();
    const allRelationNames = new Set<string>();
    
    for (const rule of playbook.relationRules) {
        // Store with full qualified name
        forwardToRule.set(rule.forwardRelation, rule);
        reverseToRule.set(rule.reverseRelation, rule);
        
        // Also store short names (after colon)
        const forwardShort = rule.forwardRelation.split(':').pop() || rule.forwardRelation;
        const reverseShort = rule.reverseRelation.split(':').pop() || rule.reverseRelation;
        forwardToRule.set(forwardShort, rule);
        reverseToRule.set(reverseShort, rule);
        
        allRelationNames.add(rule.forwardRelation);
        allRelationNames.add(rule.reverseRelation);
        allRelationNames.add(forwardShort);
        allRelationNames.add(reverseShort);
    }
    
    return { forwardToRule, reverseToRule, allRelationNames };
}

/**
 * Extract property assertions from an instance.
 */
interface PropertyAssertion {
    propertyName: string;
    propertyQualified: string;
    values: string[];
    instanceName: string;
    instanceTypes: string[];
    line?: number;
}

/**
 * Info about an instance parsed from a description.
 */
interface InstanceInfo {
    name: string;
    types: string[];
    line?: number;
}

/**
 * Parse a description and extract all property assertions.
 */
async function parseDescription(descriptionPath?: string, descriptionCode?: string): Promise<{
    assertions: PropertyAssertion[];
    instances: InstanceInfo[];
    sourceCode: string;
}> {
    const services = createOmlServices(NodeFileSystem).Oml;
    
    let content: string;
    let uri: URI;
    
    if (descriptionPath) {
        // For absolute paths, use them directly without resolveWorkspacePath
        let resolvedPath: string;
        if (path.isAbsolute(descriptionPath)) {
            resolvedPath = descriptionPath;
        } else {
            resolvedPath = resolveWorkspacePath(descriptionPath);
        }
        console.error(`[parseDescription] Description path: ${descriptionPath} -> ${resolvedPath}`);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Description file not found: ${resolvedPath}`);
        }
        content = fs.readFileSync(resolvedPath, 'utf-8');
        uri = URI.file(resolvedPath);
    } else if (descriptionCode) {
        content = descriptionCode;
        uri = URI.parse('memory://temp-description.oml');
    } else {
        throw new Error('Either descriptionPath or descriptionCode must be provided');
    }
    
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    
    const root = document.parseResult.value;
    if (!isDescription(root)) {
        throw new Error('Input is not a valid OML description');
    }
    
    const description = root as Description;
    const assertions: PropertyAssertion[] = [];
    const instances: InstanceInfo[] = [];
    
    console.error(`[parseDescription] Processing ${description.ownedStatements?.length || 0} statements`);
    
    // Process concept instances
    for (const statement of description.ownedStatements || []) {
        if (isConceptInstance(statement)) {
            const instance = statement as ConceptInstance;
            const instanceName = instance.name || 'unnamed';
            const instanceTypes = instance.ownedTypes?.map(t => {
                // Use $refText to get qualified name (e.g., "requirement:Stakeholder")
                // Fall back to ref.name for local references
                return t.type?.$refText || t.type?.ref?.name || 'Unknown';
            }) || [];
            
            // Get line number for instance
            const instanceLine = instance.$cstNode?.range?.start?.line 
                ? instance.$cstNode.range.start.line + 1 
                : undefined;
            
            console.error(`[parseDescription] Concept instance: ${instanceName}, types: ${instanceTypes.join(', ')}`);
            
            instances.push({ name: instanceName, types: instanceTypes, line: instanceLine });
            
            // Extract property value assertions
            const pvCount = instance.ownedPropertyValues?.length || 0;
            console.error(`[parseDescription]   Has ${pvCount} property values`);
            for (const pva of instance.ownedPropertyValues || []) {
                // Property is a Reference<SemanticProperty>
                // Try to get the name from the ref, or fallback to $refText (the text from the source)
                let propName = 'unknown';
                
                if (pva.property) {
                    if (pva.property.ref?.name) {
                        // Reference is resolved
                        propName = pva.property.ref.name;
                    } else if (pva.property.$refText) {
                        // Reference not resolved, but we have the text (e.g., "requirement:expresses")
                        propName = pva.property.$refText;
                    }
                }
                
                console.error(`[parseDescription]     property.ref?.name: ${pva.property?.ref?.name}`);
                console.error(`[parseDescription]     property.$refText: ${pva.property?.$refText}`);
                
                // Get referenced values (for relations)
                const values: string[] = [];
                for (const ref of pva.referencedValues || []) {
                    const refInstance = ref.ref;
                    values.push(refInstance?.name || 'unknown');
                }
                
                console.error(`[parseDescription]     Property: ${propName}, values: ${values.join(', ')}`);
                
                assertions.push({
                    propertyName: propName,
                    propertyQualified: propName, // Simplified - would need full resolution
                    values,
                    instanceName,
                    instanceTypes,
                    line: pva.$cstNode?.range?.start?.line,
                });
            }
        }
        
        if (isRelationInstance(statement)) {
            const instance = statement as RelationInstance;
            const instanceName = instance.name || 'unnamed';
            
            console.error(`[parseDescription] Relation instance: ${instanceName}`);
            
            // Get relation type
            const instanceTypes = instance.ownedTypes?.map(t => {
                // Use $refText to get qualified name (e.g., "process:DataFlow")
                // Fall back to ref.name for local references
                return t.type?.$refText || t.type?.ref?.name || 'Unknown';
            }) || [];
            
            // Get line number for instance
            const instanceLine = instance.$cstNode?.range?.start?.line 
                ? instance.$cstNode.range.start.line + 1 
                : undefined;
            
            instances.push({ name: instanceName, types: instanceTypes, line: instanceLine });
        }
    }
    
    console.error(`[parseDescription] Extracted ${assertions.length} assertions from ${instances.length} instances`);
    
    return { assertions, instances, sourceCode: content };
}

/**
 * Check assertions against playbook rules.
 */
function validateAssertions(
    assertions: PropertyAssertion[],
    instances: InstanceInfo[],
    lookups: RuleLookups,
    playbook: MethodologyPlaybook,
    filePath?: string
): { violations: PlaybookViolation[]; corrections: PlaybookCorrection[] } {
    const violations: PlaybookViolation[] = [];
    const corrections: PlaybookCorrection[] = [];
    
    console.error(`[validateAssertions] Starting validation of ${assertions.length} assertions`);
    
    // Build instance type map
    const instanceTypes = new Map<string, string[]>();
    for (const inst of instances) {
        instanceTypes.set(inst.name, inst.types);
    }
    
    for (const assertion of assertions) {
        console.error(`[validateAssertions] Checking: ${assertion.instanceName}.${assertion.propertyName} = ${assertion.values.join(', ')}`);
        
        // Check if this property is a relation with a rule
        const forwardRule = lookups.forwardToRule.get(assertion.propertyName);
        const reverseRule = lookups.reverseToRule.get(assertion.propertyName);
        
        console.error(`[validateAssertions]   forwardRule: ${forwardRule ? 'found' : 'not found'}, reverseRule: ${reverseRule ? 'found' : 'not found'}`);
        
        const rule = forwardRule || reverseRule;
        if (!rule) {
            console.error(`[validateAssertions]   No rule found, skipping`);
            continue;
        }
        
        // Determine if this is the forward or reverse direction
        const isForward = !!forwardRule && !reverseRule;
        const isReverse = !!reverseRule && !forwardRule;
        
        console.error(`[validateAssertions]   Direction: isForward=${isForward}, isReverse=${isReverse}, preferred=${rule.preferredDirection}`);
        
        // Check if using wrong direction
        const usingWrongDirection = 
            (rule.preferredDirection === 'forward' && isReverse) ||
            (rule.preferredDirection === 'reverse' && isForward);
        
        console.error(`[validateAssertions]   usingWrongDirection=${usingWrongDirection}`);
        
        if (usingWrongDirection) {
            const preferredRelation = rule.preferredDirection === 'forward' 
                ? rule.forwardRelation 
                : rule.reverseRelation;
            const currentRelation = isForward ? rule.forwardRelation : rule.reverseRelation;
            
            violations.push({
                type: 'wrong_direction',
                location: {
                    file: filePath || 'unknown',
                    line: assertion.line,
                    instance: assertion.instanceName,
                },
                rule: `Relation direction: use ${preferredRelation}`,
                message: `Instance "${assertion.instanceName}" uses "${currentRelation}" but playbook specifies "${preferredRelation}" should be used. ` +
                    `Move this assertion to the target instance using the ${rule.preferredDirection} relation.`,
                severity: 'warning',
            });
            
            // Generate correction
            for (const targetValue of assertion.values) {
                corrections.push({
                    violationType: 'wrong_direction',
                    remove: {
                        instance: assertion.instanceName,
                        property: currentRelation,
                        value: targetValue,
                    },
                    add: {
                        instance: targetValue,
                        property: preferredRelation,
                        value: assertion.instanceName,
                    },
                    explanation: `Move assertion from "${assertion.instanceName} [ ${assertion.propertyName} ${targetValue} ]" ` +
                        `to "${targetValue} [ ${preferredRelation} ${assertion.instanceName} ]"`,
                });
            }
        }
    }
    
    return { violations, corrections };
}

/**
 * Validates description-level constraints using the rule engine.
 * This enforces rules like "requirements can only be expressed by stakeholders".
 * 
 * @param assertions - Property assertions from the description
 * @param instances - Instances defined in the description
 * @param schema - Description schema defining allowed types and constraints
 * @param instanceTypes - Map of instance name to its types
 * @param filePath - Path to the description file (for error reporting)
 * @returns Violations found
 */
function validateDescriptionConstraints(
    assertions: PropertyAssertion[],
    instances: InstanceInfo[],
    schema: DescriptionSchema | undefined,
    instanceTypes: Map<string, string[]>,
    filePath?: string
): PlaybookViolation[] {
    const violations: PlaybookViolation[] = [];
    
    if (!schema) {
        // No schema for this description, skip constraint validation
        return violations;
    }
    
    console.error(`[validateDescriptionConstraints] Validating against schema for "${schema.file}"`);
    console.error(`[validateDescriptionConstraints] Allowed types: ${schema.allowedTypes.join(', ')}`);
    console.error(`[validateDescriptionConstraints] ${schema.constraints.length} constraints defined`);
    
    // 1. Check that all instances are of allowed types
    for (const inst of instances) {
        for (const instType of inst.types) {
            if (!isTypeAllowed(instType, schema.allowedTypes)) {
                violations.push({
                    type: 'type_not_allowed',
                    location: {
                        file: filePath || 'unknown',
                        line: inst.line,
                        instance: inst.name,
                    },
                    rule: `Type placement: ${schema.file}`,
                    message: `Instance "${inst.name}" of type "${instType}" is not allowed in this description. ` +
                        `Allowed types: ${schema.allowedTypes.join(', ')}`,
                    severity: 'warning',
                });
            }
        }
    }
    
    // 2. Validate property constraints for each instance
    for (const inst of instances) {
        const types = inst.types;
        
        // Get assertions for this instance
        const instanceAssertions = assertions.filter(a => a.instanceName === inst.name);
        
        // For each type of the instance, find applicable rules
        for (const instType of types) {
            const applicableRules = getApplicableRules(instType, schema.constraints);
            
            console.error(`[validateDescriptionConstraints] Instance "${inst.name}" type "${instType}" has ${applicableRules.length} applicable rules`);
            
            // For each matching rule, check its constraints
            for (const { rule, matchReason } of applicableRules) {
                console.error(`[validateDescriptionConstraints]   Rule "${rule.id}": ${matchReason}`);
                
                for (const constraint of rule.constraints) {
                    // Find assertion for this property
                    const matchingAssertion = instanceAssertions.find(
                        a => a.propertyName === constraint.property
                    );
                    
                    // Build assertion object for validation
                    const assertionForValidation = {
                        propertyName: constraint.property,
                        values: matchingAssertion?.values || [],
                        instanceName: inst.name,
                        instanceType: instType,
                    };
                    
                    const validationResult = validatePropertyConstraint(
                        assertionForValidation,
                        constraint
                    );
                    
                    if (!validationResult.isValid) {
                        violations.push({
                            type: 'missing_property',  // Reusing existing violation type for required properties
                            location: {
                                file: filePath || 'unknown',
                                line: matchingAssertion?.line || inst.line,
                                instance: inst.name,
                            },
                            rule: rule.id,
                            message: `${rule.message}: ${validationResult.reason}`,
                            severity: rule.severity || 'warning',
                        });
                    }
                    
                    // Check target type constraints if we have target type info
                    if (constraint.targetMustBe && matchingAssertion) {
                        for (const targetValue of matchingAssertion.values) {
                            const targetTypes = instanceTypes.get(targetValue);
                            if (targetTypes && !targetTypes.includes(constraint.targetMustBe)) {
                                violations.push({
                                    type: 'invalid_target_type',
                                    location: {
                                        file: filePath || 'unknown',
                                        line: matchingAssertion.line,
                                        instance: inst.name,
                                    },
                                    rule: rule.id,
                                    message: `${rule.message}: Property "${constraint.property}" target "${targetValue}" ` +
                                        `must be of type "${constraint.targetMustBe}" but has types [${targetTypes.join(', ')}]`,
                                    severity: rule.severity || 'warning',
                                });
                            }
                        }
                    }
                    
                    // Check targetMustBeOneOf
                    if (constraint.targetMustBeOneOf && matchingAssertion) {
                        for (const targetValue of matchingAssertion.values) {
                            const targetTypes = instanceTypes.get(targetValue);
                            if (targetTypes) {
                                const hasAllowedType = targetTypes.some(t => 
                                    constraint.targetMustBeOneOf!.includes(t)
                                );
                                if (!hasAllowedType) {
                                    violations.push({
                                        type: 'invalid_target_type',
                                        location: {
                                            file: filePath || 'unknown',
                                            line: matchingAssertion.line,
                                            instance: inst.name,
                                        },
                                        rule: rule.id,
                                        message: `${rule.message}: Property "${constraint.property}" target "${targetValue}" ` +
                                            `must be one of [${constraint.targetMustBeOneOf.join(', ')}] ` +
                                            `but has types [${targetTypes.join(', ')}]`,
                                        severity: rule.severity || 'warning',
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    return violations;
}

/**
 * Get the description schema for a file from the playbook.
 * Matches by filename or file path pattern.
 * 
 * @param playbook - The methodology playbook
 * @param filePath - Path to the description file
 * @returns DescriptionSchema if found, undefined otherwise
 */
function getDescriptionSchema(
    playbook: MethodologyPlaybook,
    filePath: string
): DescriptionSchema | undefined {
    if (!playbook.descriptions) {
        return undefined;
    }
    
    const fileName = path.basename(filePath);
    
    // Try exact match first
    if (playbook.descriptions[fileName]) {
        return playbook.descriptions[fileName];
    }
    
    // Try pattern matching (file paths can contain patterns)
    for (const [key, schema] of Object.entries(playbook.descriptions)) {
        // Simple pattern: if key contains *, treat as glob
        if (key.includes('*')) {
            const regexPattern = key
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*');
            const regex = new RegExp(`^${regexPattern}$`);
            
            if (regex.test(fileName) || regex.test(filePath)) {
                return schema;
            }
        }
    }
    
    return undefined;
}

/**
 * Transform code to fix violations.
 */
function transformCode(
    sourceCode: string,
    _corrections: PlaybookCorrection[]
): string {
    // For now, this is a simplified transformation - a full implementation would use
    // proper AST manipulation. For now, we provide guidance.
    
    // For a full implementation, we would parse the source code into an AST, find and remove
    // the incorrect assertions, find or create the target instances, add the corrected assertions,
    // and regenerate the code. Could be another tool? 

    // For now, we will just return original code - corrections are shown in output

    return sourceCode;
}

/**
 * Format validation result as markdown.
 */
function formatValidationResult(
    result: PlaybookValidationResult,
    playbook: MethodologyPlaybook,
    mode: 'validate' | 'transform' | 'suggest'
): string {
    const lines: string[] = [];
    
    lines.push(`# Methodology Enforcement: ${playbook.metadata.methodology}`);
    lines.push(``);
    
    if (result.isValid) {
        lines.push(`✅ **All assertions conform to the playbook!**`);
        return lines.join('\n');
    }
    
    lines.push(`⚠️ **Found ${result.violations.length} violation(s)**`);
    lines.push(``);
    
    // Group violations by type
    const byType = new Map<string, PlaybookViolation[]>();
    for (const v of result.violations) {
        const existing = byType.get(v.type) || [];
        existing.push(v);
        byType.set(v.type, existing);
    }
    
    for (const [type, violations] of byType) {
        lines.push(`## ${type.replace('_', ' ').toUpperCase()}`);
        lines.push(``);
        
        for (const v of violations) {
            const locationStr = v.location 
                ? `(${v.location.file}${v.location.line ? `:${v.location.line}` : ''}, instance: ${v.location.instance})`
                : '';
            
            lines.push(`### ${v.severity === 'error' ? '❌' : '⚠️'} ${v.rule}`);
            lines.push(`${v.message}`);
            if (locationStr) lines.push(`*Location:* ${locationStr}`);
            lines.push(``);
        }
    }
    
    if (result.corrections.length > 0 && (mode === 'suggest' || mode === 'transform')) {
        lines.push(`## Suggested Corrections`);
        lines.push(``);
        
        for (const c of result.corrections) {
            lines.push(`### ${c.explanation}`);
            if (c.remove) {
                lines.push(`**Remove from** \`${c.remove.instance}\`:`);
                lines.push('```oml');
                lines.push(`    ${c.remove.property} ${c.remove.value}`);
                lines.push('```');
            }
            if (c.add) {
                lines.push(`**Add to** \`${c.add.instance}\`:`);
                lines.push('```oml');
                lines.push(`    ${c.add.property} ${c.add.value}`);
                lines.push('```');
            }
            lines.push(``);
        }
    }
    
    return lines.join('\n');
}

export const enforceMethodologyRulesHandler = async (params: {
    playbookPath?: string;
    methodologyName?: string;
    descriptionPath?: string;
    descriptionCode?: string;
    autoCorrect?: boolean;
    mode?: 'validate' | 'transform' | 'suggest';
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    const debugLines: string[] = [];
    debugLines.push(`[DEBUG] enforce_methodology_rules called`);
    debugLines.push(`[DEBUG] playbookPath: ${params.playbookPath}`);
    debugLines.push(`[DEBUG] methodologyName: ${params.methodologyName}`);
    debugLines.push(`[DEBUG] descriptionPath: ${params.descriptionPath}`);
    debugLines.push(`[DEBUG] mode: ${params.mode}`);
    
    try {
        const { methodologyName, descriptionPath, descriptionCode, autoCorrect = false, mode = 'validate' } = params;
        
        let { playbookPath } = params;
        
        // Auto-detect playbook if not provided
        if (!playbookPath) {
            debugLines.push(`[DEBUG] No playbookPath, attempting auto-detect with methodologyName: ${methodologyName}`);
            if (!methodologyName) {
                const msg = `**Error:** Either playbookPath or methodologyName must be provided.\n\n- playbookPath: Direct path to YAML playbook\n- methodologyName: Name like "Sierra" to auto-detect playbook`;
                console.error(`[enforce_methodology_rules] ERROR: ${msg}`);
                return {
                    content: [{ type: 'text', text: msg }],
                    isError: true,
                };
            }
            
            const detected = detectPlaybookPath(methodologyName, descriptionPath);
            debugLines.push(`[DEBUG] detectPlaybookPath result: ${detected}`);
            console.error(`[enforce_methodology_rules] detectPlaybookPath result: ${detected}`);
            if (!detected) {
                const msg = `**Could not auto-detect playbook for "${methodologyName}"**\n\nSearched for: ${methodologyName.toLowerCase()}_playbook.yaml, methodology_playbook.yaml, etc.\n\nSpecify playbookPath explicitly or ensure playbook is in project root or parent directories.`;
                console.error(`[enforce_methodology_rules] ERROR: ${msg}`);
                return {
                    content: [{ type: 'text', text: msg }],
                    isError: true,
                };
            }
            
            playbookPath = detected;
        }
        
        debugLines.push(`[DEBUG] Using playbookPath: ${playbookPath}`);
        debugLines.push(`[DEBUG] Loading playbook...`);
        
        if (!descriptionPath && !descriptionCode) {
            const msg = 'Error: Either descriptionPath or descriptionCode must be provided';
            console.error(`[enforce_methodology_rules] ERROR: ${msg}`);
            debugLines.push(`[DEBUG] ERROR: ${msg}`);
            return {
                content: [{ type: 'text', text: msg }, { type: 'text', text: debugLines.join('\n') }],
                isError: true,
            };
        }
        
        // Load playbook
        debugLines.push(`[DEBUG] Loading playbook from: ${playbookPath}`);
        const playbook = loadPlaybook(playbookPath);
        debugLines.push(`[DEBUG] Playbook loaded: ${playbook.metadata.methodology}`);
        debugLines.push(`[DEBUG] Playbook has ${playbook.relationRules.length} relation rules`);
        
        const lookups = buildRuleLookups(playbook);
        debugLines.push(`[DEBUG] Built rule lookups: ${lookups.forwardToRule.size} forward, ${lookups.reverseToRule.size} reverse`);
        
        // Parse description
        debugLines.push(`[DEBUG] Parsing description from: ${descriptionPath || 'inline code'}`);
        const { assertions, instances, sourceCode } = await parseDescription(descriptionPath, descriptionCode);
        debugLines.push(`[DEBUG] Parsed: ${assertions.length} assertions, ${instances.length} instances`);
        
        for (const a of assertions) {
            debugLines.push(`[DEBUG]   Assertion: ${a.instanceName}.${a.propertyName} = ${a.values.join(', ')}`);
        }
        
        // Build instance type map for constraint validation
        const instanceTypes = new Map<string, string[]>();
        for (const inst of instances) {
            instanceTypes.set(inst.name, inst.types);
        }
        
        // Validate relation direction rules
        debugLines.push(`[DEBUG] Validating relation direction rules...`);
        const { violations, corrections } = validateAssertions(
            assertions, 
            instances, 
            lookups, 
            playbook, 
            descriptionPath
        );
        debugLines.push(`[DEBUG] Relation validation complete: ${violations.length} violations, ${corrections.length} corrections`);
        
        // Validate description-level constraints (Phase 2 integration)
        debugLines.push(`[DEBUG] Validating description-level constraints...`);
        const descriptionSchema = descriptionPath 
            ? getDescriptionSchema(playbook, descriptionPath)
            : undefined;
        
        if (descriptionSchema) {
            debugLines.push(`[DEBUG] Found schema for description: ${descriptionSchema.file}`);
            debugLines.push(`[DEBUG]   Allowed types: ${descriptionSchema.allowedTypes.join(', ')}`);
            debugLines.push(`[DEBUG]   Constraints: ${descriptionSchema.constraints.length}`);
        } else {
            debugLines.push(`[DEBUG] No description schema found - skipping constraint validation`);
        }
        
        const constraintViolations = validateDescriptionConstraints(
            assertions,
            instances,
            descriptionSchema,
            instanceTypes,
            descriptionPath
        );
        debugLines.push(`[DEBUG] Constraint validation complete: ${constraintViolations.length} additional violations`);
        
        // Merge all violations
        const allViolations = [...violations, ...constraintViolations];
        debugLines.push(`[DEBUG] Total violations: ${allViolations.length}`);
        
        const result: PlaybookValidationResult = {
            isValid: allViolations.length === 0,
            violations: allViolations,
            corrections,
        };
        
        // Format output based on mode
        if (mode === 'transform' && autoCorrect && corrections.length > 0) {
            const transformedCode = transformCode(sourceCode, corrections);
            
            // If we have a file path, could write back
            if (descriptionPath && autoCorrect) {
                // For safety, we don't auto-write. Instead, return the transformed code.
                return {
                    content: [
                        { type: 'text', text: formatValidationResult(result, playbook, mode) },
                        { type: 'text', text: `\n## Transformed Code\n\`\`\`oml\n${transformedCode}\n\`\`\`` },
                    ],
                };
            }
        }
        
        const formattedResult = formatValidationResult(result, playbook, mode);
        debugLines.push(`[DEBUG] Returning formatted result (${formattedResult.length} chars)`);
        return {
            content: [
                { type: 'text', text: formattedResult },
                { type: 'text', text: `\n## Debug Info\n\`\`\`\n${debugLines.join('\n')}\n\`\`\`` },
            ],
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? (error.stack || '') : '';
        console.error(`[enforce_methodology_rules] CAUGHT EXCEPTION: ${errorMsg}`);
        console.error(stack);
        debugLines.push(`[DEBUG] EXCEPTION: ${errorMsg}`);
        debugLines.push(stack || 'no stack trace');
        return {
            content: [
                { 
                    type: 'text', 
                    text: `**Error enforcing methodology rules:**\n\n${errorMsg}\n\n(Check server logs for full stack trace)` 
                },
                { type: 'text', text: debugLines.join('\n') },
            ],
            isError: true,
        };
    }
};

/**
 * Utility function to check a single assertion direction.
 * Useful for real-time validation during description authoring.
 */
export function checkAssertionDirection(
    playbook: MethodologyPlaybook,
    instanceType: string,
    relationName: string,
    targetType: string
): { isCorrect: boolean; suggestion?: string; correctRelation?: string; correctOwner?: string } {
    const lookups = buildRuleLookups(playbook);
    
    const forwardRule = lookups.forwardToRule.get(relationName);
    const reverseRule = lookups.reverseToRule.get(relationName);
    const rule = forwardRule || reverseRule;
    
    if (!rule) {
        return { isCorrect: true }; // No rule, assume correct
    }
    
    const isForward = !!forwardRule && !reverseRule;
    const usingWrongDirection = 
        (rule.preferredDirection === 'forward' && !isForward) ||
        (rule.preferredDirection === 'reverse' && isForward);
    
    if (usingWrongDirection) {
        const correctRelation = rule.preferredDirection === 'forward' 
            ? rule.forwardRelation 
            : rule.reverseRelation;
        
        return {
            isCorrect: false,
            suggestion: `Use "${correctRelation}" from the target instance instead`,
            correctRelation,
            correctOwner: rule.owningConcept,
        };
    }
    
    return { isCorrect: true };
}

/**
 * Pre-process an assertion request and return the corrected version.
 * This is the "intercept and reformat" function for AI integration.
 */
export function interceptAndReformat(
    playbook: MethodologyPlaybook,
    request: {
        sourceInstance: string;
        sourceType: string;
        relation: string;
        targetInstance: string;
        targetType: string;
    }
): {
    reformatted: boolean;
    result: {
        sourceInstance: string;
        relation: string;
        targetInstance: string;
    };
    explanation?: string;
} {
    const check = checkAssertionDirection(
        playbook,
        request.sourceType,
        request.relation,
        request.targetType
    );
    
    if (check.isCorrect) {
        return {
            reformatted: false,
            result: {
                sourceInstance: request.sourceInstance,
                relation: request.relation,
                targetInstance: request.targetInstance,
            },
        };
    }
    
    // Reformat: swap source and target, use correct relation
    return {
        reformatted: true,
        result: {
            sourceInstance: request.targetInstance,
            relation: check.correctRelation || request.relation,
            targetInstance: request.sourceInstance,
        },
        explanation: `Reformatted from "${request.sourceInstance} [ ${request.relation} ${request.targetInstance} ]" ` +
            `to "${request.targetInstance} [ ${check.correctRelation} ${request.sourceInstance} ]" per playbook rules.`,
    };
}
