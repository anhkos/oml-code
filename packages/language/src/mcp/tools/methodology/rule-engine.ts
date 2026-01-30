/**
 * Deterministic rule engine for matching and applying description constraints.
 * All functions are pure with no side effects for predictable behavior.
 */

import type { AppliesTo, DescriptionConstraint, PropertyConstraint } from './playbook-types.js';

/**
 * Specificity scores for deterministic precedence.
 * Higher score = more specific = higher precedence.
 */
export enum Specificity {
    EXACT_TYPE = 1000,              // conceptType without matchSubtypes
    EXACT_TYPE_WITH_SUBTYPES = 500,  // conceptType with matchSubtypes
    MULTIPLE_TYPES = 250,            // conceptTypes array
    PATTERN_MATCH = 100,             // conceptPattern
    SUBTYPE_MATCH = 50,              // anySubtypeOf
    NO_MATCH = 0                     // Doesn't match
}

/**
 * Result of matching a rule to an instance type.
 */
export interface RuleMatchResult {
    matches: boolean;
    specificity: number;
    matchReason?: string;
}

/**
 * Pure function: Check if a rule applies to an instance type.
 * 
 * @param instanceType - Fully qualified type (e.g., "requirement:SafetyRequirement")
 * @param appliesTo - Rule's appliesTo configuration
 * @param typeHierarchy - Optional: map of type -> parent types for subtype checking
 * @returns Match result with specificity score
 */
export function matchesAppliesTo(
    instanceType: string,
    appliesTo: AppliesTo,
    typeHierarchy?: Map<string, string[]>
): RuleMatchResult {
    // Strategy 1: Exact type match
    if (appliesTo.conceptType) {
        if (instanceType === appliesTo.conceptType) {
            const specificity = appliesTo.matchSubtypes 
                ? Specificity.EXACT_TYPE_WITH_SUBTYPES 
                : Specificity.EXACT_TYPE;
            return {
                matches: true,
                specificity,
                matchReason: `Exact match: ${instanceType}`
            };
        }
        
        // Check subtypes if enabled
        if (appliesTo.matchSubtypes && typeHierarchy) {
            const isSubtype = isSubtypeOf(instanceType, appliesTo.conceptType, typeHierarchy);
            if (isSubtype) {
                return {
                    matches: true,
                    specificity: Specificity.EXACT_TYPE_WITH_SUBTYPES,
                    matchReason: `Subtype match: ${instanceType} is subtype of ${appliesTo.conceptType}`
                };
            }
        }
    }
    
    // Strategy 2: Multiple types
    if (appliesTo.conceptTypes && appliesTo.conceptTypes.length > 0) {
        if (appliesTo.conceptTypes.includes(instanceType)) {
            return {
                matches: true,
                specificity: Specificity.MULTIPLE_TYPES,
                matchReason: `One of: ${appliesTo.conceptTypes.join(', ')}`
            };
        }
    }
    
    // Strategy 3: Pattern matching
    if (appliesTo.conceptPattern) {
        const regex = patternToRegex(appliesTo.conceptPattern);
        if (regex.test(instanceType)) {
            return {
                matches: true,
                specificity: Specificity.PATTERN_MATCH,
                matchReason: `Pattern match: ${appliesTo.conceptPattern}`
            };
        }
    }
    
    // Strategy 4: Any subtype of
    if (appliesTo.anySubtypeOf && typeHierarchy) {
        const isSubtype = isSubtypeOf(instanceType, appliesTo.anySubtypeOf, typeHierarchy);
        if (isSubtype) {
            return {
                matches: true,
                specificity: Specificity.SUBTYPE_MATCH,
                matchReason: `Subtype of: ${appliesTo.anySubtypeOf}`
            };
        }
    }
    
    return { matches: false, specificity: Specificity.NO_MATCH };
}

/**
 * Convert a simple pattern to regex.
 * Supports wildcards: *Requirement matches SafetyRequirement, FunctionalRequirement, etc.
 * 
 * @param pattern - Pattern string with wildcards (* and ?)
 * @returns RegExp for matching
 */
function patternToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
        .replace(/\*/g, '.*')                   // Convert * to .*
        .replace(/\?/g, '.');                   // Convert ? to .
    
    return new RegExp(`^${escaped}$`);
}

/**
 * Check if a type is a subtype of another.
 * Uses type hierarchy map for lookup.
 * 
 * @param childType - Type to check
 * @param parentType - Potential parent type
 * @param typeHierarchy - Map of type -> parent types
 * @returns true if childType is a subtype of parentType
 */
function isSubtypeOf(
    childType: string,
    parentType: string,
    typeHierarchy: Map<string, string[]>
): boolean {
    if (childType === parentType) return true;
    
    const parents = typeHierarchy.get(childType);
    if (!parents) return false;
    
    // Direct parent match
    if (parents.includes(parentType)) return true;
    
    // Recursive parent check
    for (const parent of parents) {
        if (isSubtypeOf(parent, parentType, typeHierarchy)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Find all rules that apply to an instance type.
 * Returns rules sorted by specificity (most specific first).
 * 
 * DETERMINISTIC: Always returns same order for same inputs.
 * 
 * @param instanceType - Type to match rules against
 * @param allRules - All available rules
 * @param typeHierarchy - Optional type hierarchy for subtype checking
 * @returns Array of matching rules with specificity scores, sorted by precedence
 */
export function getApplicableRules(
    instanceType: string,
    allRules: DescriptionConstraint[],
    typeHierarchy?: Map<string, string[]>
): Array<{ rule: DescriptionConstraint; specificity: number; matchReason: string }> {
    const matches: Array<{ rule: DescriptionConstraint; specificity: number; matchReason: string }> = [];
    
    for (const rule of allRules) {
        const match = matchesAppliesTo(instanceType, rule.appliesTo, typeHierarchy);
        
        if (match.matches) {
            matches.push({
                rule,
                specificity: match.specificity,
                matchReason: match.matchReason || 'unknown'
            });
        }
    }
    
    // Sort by specificity (descending), then by rule ID (for determinism when tied)
    matches.sort((a, b) => {
        if (a.specificity !== b.specificity) {
            return b.specificity - a.specificity;  // Higher specificity first
        }
        // Tie-breaker: alphabetical by rule ID (deterministic)
        return a.rule.id.localeCompare(b.rule.id);
    });
    
    return matches;
}

/**
 * Validate a property assertion against a constraint.
 * Pure function - no side effects.
 * 
 * @param assertion - Property assertion to validate
 * @param constraint - Constraint to check against
 * @param typeHierarchy - Optional type hierarchy for subtype checking
 * @returns Validation result with isValid flag and reason
 */
export function validatePropertyConstraint(
    assertion: {
        propertyName: string;
        values: string[];
        instanceName: string;
        instanceType: string;
    },
    constraint: PropertyConstraint,
    typeHierarchy?: Map<string, string[]>
): { isValid: boolean; reason?: string } {
    // Check property name matches
    if (constraint.property !== assertion.propertyName) {
        return { isValid: true };  // Not applicable
    }
    
    // Check required property
    if (constraint.required && assertion.values.length === 0) {
        return {
            isValid: false,
            reason: `Property "${constraint.property}" is required but not set`
        };
    }
    
    // Check cardinality - minimum
    if (constraint.minOccurrences !== undefined && assertion.values.length < constraint.minOccurrences) {
        return {
            isValid: false,
            reason: `Property "${constraint.property}" requires at least ${constraint.minOccurrences} value(s), found ${assertion.values.length}`
        };
    }
    
    // Check cardinality - maximum
    if (constraint.maxOccurrences !== undefined && assertion.values.length > constraint.maxOccurrences) {
        return {
            isValid: false,
            reason: `Property "${constraint.property}" allows at most ${constraint.maxOccurrences} value(s), found ${assertion.values.length}`
        };
    }
    
    // Note: Target type checking requires instance type resolution
    // This would be implemented when integrating with the full validation pipeline
    // For now, we return valid for target constraints
    
    return { isValid: true };
}

/**
 * Check if an instance type is allowed in a description.
 * 
 * @param instanceType - Type to check
 * @param allowedTypes - List of allowed types
 * @returns true if allowed
 */
export function isTypeAllowed(instanceType: string, allowedTypes: string[]): boolean {
    return allowedTypes.includes(instanceType);
}
