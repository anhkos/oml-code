import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import {
    isDescription,
    Description,
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
    validateDescriptionPropertyConstraint,
    isTypeAllowed,
    getApplicableDescriptionRules,
} from './core/index.js';
import {
    resolvePlaybookPath,
    loadPlaybook,
} from './core/index.js';
import { createLogger } from '../common/logger.js';
import { handleError, PlaybookNotFoundError, DescriptionParseError } from '../common/error-handler.js';
import {
    parseDescriptionAst,
    type PropertyAssertion,
    type InstanceInfo,
    type ImportPrefixMap,
} from '../parsing/index.js';

export const enforceMethodologyRulesTool = {
    name: 'enforce_methodology_rules' as const,
    description: `Validate OML description files against a methodology playbook.

USE THIS TOOL when the user asks:
- "Check my OML file for methodology issues"  
- "Validate this description against the playbook"
- "Are there any wrong relation directions?"

AUTO-DETECTION:
- Playbook: Searches up the directory tree for *_playbook.yaml files
- Just provide the description file path - it will find the playbook

MINIMAL CALL (auto-detects playbook):
{
  "descriptionPath": "/path/to/description_file.oml"
}

EXPLICIT CALL:
{
  "playbookPath": "/path/to/methodology_playbook.yaml",
  "descriptionPath": "/path/to/description_file.oml"
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

export const enforceMethodologyRulesMetadata = {
    id: 'enforce_methodology_rules',
    displayName: 'Enforce Methodology Rules',
    layer: 'methodology' as const,
    severity: 'critical' as const,
    version: '1.0.0',
    shortDescription: 'Validate description files against methodology playbook rules',
    description: 'Validates OML description files for compliance with methodology rules including relation directions, property constraints, and type restrictions.',
    tags: ['validation', 'methodology', 'rules', 'enforcement'],
    dependencies: ['extract_description_schemas'],
    addedDate: '2024-01-01',
};

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
 * Parse an OML description file or code and extract assertions and instances.
 * Uses the Langium parser to load the description and imports.
 */
async function parseDescription(descriptionPath?: string, descriptionCode?: string): Promise<{
    assertions: PropertyAssertion[];
    instances: InstanceInfo[];
    sourceCode: string;
    importPrefixMap: ImportPrefixMap;
}> {
    const logger = createLogger('parseDescription');
    logger.debug(`Starting parse`, { descriptionPath, hasCode: !!descriptionCode });

    const services = createOmlServices(NodeFileSystem).Oml;
    
    let content: string;
    let uri: URI;
    
    if (descriptionPath) {
        // Resolve and read file
        let resolvedPath: string;
        if (path.isAbsolute(descriptionPath)) {
            resolvedPath = descriptionPath;
        } else {
            resolvedPath = resolveWorkspacePath(descriptionPath);
        }
        
        if (!fs.existsSync(resolvedPath)) {
            throw new DescriptionParseError(resolvedPath, new Error('File not found'));
        }
        
        content = fs.readFileSync(resolvedPath, 'utf-8');
        uri = URI.file(resolvedPath);
        logger.debug(`Loaded description file`, { path: resolvedPath, size: content.length });
    } else if (descriptionCode) {
        content = descriptionCode;
        uri = URI.parse('memory://temp-description.oml');
        logger.debug(`Using inline code`, { size: content.length });
    } else {
        throw new Error('Either descriptionPath or descriptionCode must be provided');
    }
    
    // Parse the description
    const langiumDocs = services.shared.workspace.LangiumDocuments;
    const tempDoc = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    const tempRoot = tempDoc.parseResult.value;
    
    if (!isDescription(tempRoot)) {
        throw new DescriptionParseError(descriptionPath || 'inline', new Error('Not a valid OML description'));
    }
    
    const description = tempRoot as Description;
    
    // Load and build the document with minimal workspace context
    const document = await langiumDocs.getOrCreateDocument(uri);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    
    // Parse the description AST using the new parser module
    const parsed = parseDescriptionAst(description, content, logger);
    logger.info(`Parse complete`, { assertions: parsed.assertions.length, instances: parsed.instances.length });
    
    return parsed;
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
    const logger = createLogger('validateAssertions');
    const violations: PlaybookViolation[] = [];
    const corrections: PlaybookCorrection[] = [];
    
    logger.debug(`Starting validation`, { assertionCount: assertions.length });
    
    // Build instance type map
    const instanceTypes = new Map<string, string[]>();
    for (const inst of instances) {
        instanceTypes.set(inst.name, inst.types);
    }
    
    for (const assertion of assertions) {
        // Check if this property is a relation with a rule
        const forwardRule = lookups.forwardToRule.get(assertion.propertyName);
        const reverseRule = lookups.reverseToRule.get(assertion.propertyName);
        
        const rule = forwardRule || reverseRule;
        if (!rule) {
            logger.debug(`No rule found for property`, { property: assertion.propertyName });
            continue;
        }
        
        // Determine if this is the forward or reverse direction
        const isForward = !!forwardRule && !reverseRule;
        const isReverse = !!reverseRule && !forwardRule;
        
        // Check if using wrong direction
        const usingWrongDirection = 
            (rule.preferredDirection === 'forward' && isReverse) ||
            (rule.preferredDirection === 'reverse' && isForward);
        
        if (usingWrongDirection) {
            const preferredRelation = rule.preferredDirection === 'forward' 
                ? rule.forwardRelation 
                : rule.reverseRelation;
            const currentRelation = isForward ? rule.forwardRelation : rule.reverseRelation;
            
            logger.warn(`Wrong direction detected`, {
                instance: assertion.instanceName,
                current: currentRelation,
                preferred: preferredRelation,
            });
            
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
    
    logger.info(`Validation complete`, { violations: violations.length, corrections: corrections.length });
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
    importPrefixMap: ImportPrefixMap,
    filePath?: string
): PlaybookViolation[] {
    const violations: PlaybookViolation[] = [];
    
    // Helper to resolve import prefix aliases (e.g., "ent:Actor" -> "entity:Actor")
    const resolveTypeAlias = (type: string): string => {
        const colonIndex = type.indexOf(':');
        if (colonIndex === -1) {
            return type;
        }
        const prefix = type.substring(0, colonIndex);
        const name = type.substring(colonIndex + 1);
        const canonicalPrefix = importPrefixMap[prefix];
        return canonicalPrefix ? `${canonicalPrefix}:${name}` : type;
    };
    
    // Helper to normalize an array of types
    const normalizeTypes = (types: string[]): string[] => types.map(resolveTypeAlias);
    
    if (!schema) {
        // No schema for this description, skip constraint validation
        return violations;
    }
    
    console.error(`[validateDescriptionConstraints] Validating against schema for "${schema.file}"`);
    console.error(`[validateDescriptionConstraints] Allowed types: ${schema.allowedTypes.join(', ')}`);
    console.error(`[validateDescriptionConstraints] ${schema.constraints.length} constraints defined`);
    
    // Normalize allowed types for alias resolution
    const normalizedAllowedTypes = normalizeTypes(schema.allowedTypes);
    console.error(`[validateDescriptionConstraints] Normalized allowed types: ${normalizedAllowedTypes.join(', ')}`);
    
    // 1. Check that all instances are of allowed types
    for (const inst of instances) {
        for (const instType of inst.types) {
            const normalizedType = resolveTypeAlias(instType);
            console.error(`[validateDescriptionConstraints] Checking type "${instType}" -> normalized "${normalizedType}"`);
            if (!isTypeAllowed(normalizedType, normalizedAllowedTypes)) {
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
            // Normalize the instance type for rule matching
            const normalizedType = resolveTypeAlias(instType);
                const applicableRules = getApplicableDescriptionRules(normalizedType, schema.constraints);
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
                        instanceType: normalizedType,
                    };
                    
                    const validationResult = validateDescriptionPropertyConstraint(
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
                        const normalizedTargetMustBe = resolveTypeAlias(constraint.targetMustBe);
                        for (const targetValue of matchingAssertion.values) {
                            const targetTypes = instanceTypes.get(targetValue);
                            
                            if (!targetTypes) {
                                // Target instance not found - could be from another file or invalid reference
                                console.error(`[validateDescriptionConstraints] Target "${targetValue}" not found in instance map - cannot verify type constraint`);
                                violations.push({
                                    type: 'invalid_target_type',
                                    location: {
                                        file: filePath || 'unknown',
                                        line: matchingAssertion.line,
                                        instance: inst.name,
                                    },
                                    rule: rule.id,
                                    message: `${rule.message}: Property "${constraint.property}" references "${targetValue}" ` +
                                        `which is not a known ${constraint.targetMustBe} instance in this description. ` +
                                        `Expected: a local instance of type "${constraint.targetMustBe}"`,
                                    severity: rule.severity || 'warning',
                                });
                            } else {
                                // Target found - check if it has the required type
                                const normalizedTargetTypes = normalizeTypes(targetTypes);
                                if (!normalizedTargetTypes.includes(normalizedTargetMustBe)) {
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
                    }
                    
                    // Check targetMustBeOneOf
                    if (constraint.targetMustBeOneOf && constraint.targetMustBeOneOf.length > 0 && matchingAssertion) {
                        const normalizedTargetMustBeOneOf = normalizeTypes(constraint.targetMustBeOneOf);
                        for (const targetValue of matchingAssertion.values) {
                            const targetTypes = instanceTypes.get(targetValue);
                            
                            if (!targetTypes) {
                                // Target instance not found
                                console.error(`[validateDescriptionConstraints] Target "${targetValue}" not found in instance map - cannot verify type constraint`);
                                violations.push({
                                    type: 'invalid_target_type',
                                    location: {
                                        file: filePath || 'unknown',
                                        line: matchingAssertion.line,
                                        instance: inst.name,
                                    },
                                    rule: rule.id,
                                    message: `${rule.message}: Property "${constraint.property}" references "${targetValue}" ` +
                                        `which is not a known instance in this description. ` +
                                        `Expected: a local instance of type(s) [${constraint.targetMustBeOneOf.join(', ')}]`,
                                    severity: rule.severity || 'warning',
                                });
                            } else {
                                // Normalize both sides for alias resolution
                                const normalizedTargetTypes = normalizeTypes(targetTypes);
                                const hasAllowedType = normalizedTargetTypes.some(t => 
                                    normalizedTargetMustBeOneOf.includes(t)
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
    workspacePath?: string;
    autoCorrect?: boolean;
    mode?: 'validate' | 'transform' | 'suggest';
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    const logger = createLogger('enforceMethodologyRulesHandler');
    
    try {
        logger.info(`Starting methodology rule enforcement`, {
            hasPlaybook: !!params.playbookPath,
            hasDescription: !!params.descriptionPath || !!params.descriptionCode,
            mode: params.mode || 'validate',
        });

        const { descriptionPath, descriptionCode, mode = 'validate' } = params;
        
        // Resolve playbook path
        const playbookPath = resolvePlaybookPath({
            playbookPath: params.playbookPath,
            descriptionPath: params.descriptionPath,
            workspacePath: params.workspacePath,
        });
        
        if (!playbookPath) {
            throw new PlaybookNotFoundError(params.workspacePath);
        }

        if (!descriptionPath && !descriptionCode) {
            throw new Error('Either descriptionPath or descriptionCode must be provided');
        }
        
        // Load playbook
        logger.debug(`Loading playbook`, { playbookPath });
        const playbook = loadPlaybook(playbookPath);
        logger.info(`Playbook loaded`, { methodology: playbook.metadata.methodology, rules: playbook.relationRules.length });
        
        const lookups = buildRuleLookups(playbook);
        logger.debug(`Rule lookups built`, { forward: lookups.forwardToRule.size, reverse: lookups.reverseToRule.size });
        
        // Parse description
        logger.debug(`Parsing description`, { path: descriptionPath, hasCode: !!descriptionCode });
        const { assertions, instances, importPrefixMap } = await parseDescription(descriptionPath, descriptionCode);
        logger.info(`Description parsed`, { assertions: assertions.length, instances: instances.length });
        
        // Build instance type map for constraint validation
        const instanceTypes = new Map<string, string[]>();
        for (const inst of instances) {
            instanceTypes.set(inst.name, inst.types);
        }
        
        // Validate relation direction rules
        logger.debug(`Validating relation directions`);
        const { violations, corrections } = validateAssertions(
            assertions, 
            instances, 
            lookups, 
            playbook, 
            descriptionPath
        );
        logger.debug(`Relation validation complete`, { violations: violations.length, corrections: corrections.length });
        
        // Validate description-level constraints
        logger.debug(`Validating description constraints`);
        const descriptionSchema = descriptionPath 
            ? getDescriptionSchema(playbook, descriptionPath)
            : undefined;
        
        const constraintViolations = validateDescriptionConstraints(
            assertions,
            instances,
            descriptionSchema,
            instanceTypes,
            importPrefixMap,
            descriptionPath
        );
        logger.debug(`Constraint validation complete`, { violations: constraintViolations.length });
        
        // Merge all violations
        const allViolations = [...violations, ...constraintViolations];
        logger.info(`Validation complete`, { totalViolations: allViolations.length });
        
        const result: PlaybookValidationResult = {
            isValid: allViolations.length === 0,
            violations: allViolations,
            corrections,
        };
        
        // Format and return result
        const formattedResult = formatValidationResult(result, playbook, mode);
        
        return {
            content: [{ type: 'text', text: formattedResult }],
        };
    } catch (error) {
        logger.error(`Tool execution failed`, error as Error);
        return handleError(error, 'enforce_methodology_rules', logger);
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
