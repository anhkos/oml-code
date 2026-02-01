/**
 * Constraint Engine: Pure constraint matching and validation logic
 * 
 * This module contains all the business logic for:
 * - Property constraint validation
 * - Type allowance checking
 * - Relation rule matching and validation
 * 
 * All functions are pure (no side effects) for predictable behavior and testability.
 */

import { MethodologyPlaybook, PropertyConstraint, RelationRule, DescriptionConstraint, AppliesTo } from '../playbook-types.js';

/**
 * Specificity ranking for rule priority determination.
 * Higher values = higher priority (more specific rules override general ones)
 */
export enum Specificity {
    EXACT_TYPE = 1000,
    EXACT_TYPE_WITH_SUBTYPES = 500,
    WILDCARD_SUFFIX = 200,
    WILDCARD_PREFIX = 100,
    GENERIC = 0,
}

/**
 * Result of rule matching with specificity scoring
 */
export interface RuleMatchResult {
    matches: boolean;
    specificity: Specificity;
    reason?: string;
}

/**
 * Pure function: Get all relation rules from playbook
 * Returns rules that can be validated
 */
export function getRelationRules(playbook: MethodologyPlaybook): RelationRule[] {
    return playbook.relationRules || [];
}

/**
 * Pure function: Validate a property against constraints
 * Checks target type constraints
 *
 * @returns Object with validation result and error details
 */
export function validatePropertyConstraint(
    property: string,
    values: any[],
    constraint: PropertyConstraint,
): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Target type constraint: check that target matches required type
    if (constraint.targetMustBe) {
        if (!isTypeAllowed(constraint.targetMustBe, [constraint.targetMustBe])) {
            errors.push(`Property "${property}" target does not match required type`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Check if a property type is in the allowed list
 * Simple type check - can be extended for complex type hierarchies
 */
export function isTypeAllowed(propertyType: string, allowedTypes: string[]): boolean {
    return allowedTypes.includes(propertyType);
}

/**
 * Check if a relation rule matches given direction requirements
 */
export function ruleMatchesDirection(
    rule: RelationRule,
    forwardRelation: string,
    reverseRelation: string,
): boolean {
    return (
        (rule.forwardRelation === forwardRelation && rule.reverseRelation === reverseRelation) ||
        (rule.forwardRelation === reverseRelation && rule.reverseRelation === forwardRelation)
    );
}

/**
 * Get the preferred direction from a relation rule
 */
export function getPreferredDirection(rule: RelationRule): 'forward' | 'reverse' {
    return rule.preferredDirection;
}

/**
 * Check if a relation is in forward direction according to rule
 */
export function isForwardDirection(
    rule: RelationRule,
    actualRelation: string,
): boolean {
    return rule.forwardRelation === actualRelation && rule.preferredDirection === 'forward';
}

/**
 * Check if a relation is in reverse direction according to rule
 */
export function isReverseDirection(
    rule: RelationRule,
    actualRelation: string,
): boolean {
    return rule.reverseRelation === actualRelation && rule.preferredDirection === 'reverse';
}

/**
 * Check if instance type matches the AppliesTo criteria
 * Used for description constraint filtering
 */
export function matchesAppliesTo(
    instanceType: string,
    appliesTo: AppliesTo,
    typeHierarchy?: Map<string, string[]>,
): RuleMatchResult {
    // Empty appliesTo means applies to everything
    if (
        !appliesTo.conceptType &&
        !appliesTo.conceptPattern &&
        (!appliesTo.conceptTypes || appliesTo.conceptTypes.length === 0) &&
        !appliesTo.anySubtypeOf
    ) {
        return { matches: true, specificity: Specificity.GENERIC };
    }

    // Check against exact type match
    if (appliesTo.conceptType && instanceType === appliesTo.conceptType) {
        return { matches: true, specificity: Specificity.EXACT_TYPE };
    }

    // Check against conceptTypes array
    if (appliesTo.conceptTypes && appliesTo.conceptTypes.includes(instanceType)) {
        return { matches: true, specificity: Specificity.EXACT_TYPE };
    }

    // Check if instanceType is a subtype of anySubtypeOf
    if (appliesTo.anySubtypeOf && typeHierarchy?.has(instanceType)) {
        const supertypes = typeHierarchy.get(instanceType) || [];
        if (supertypes.includes(appliesTo.anySubtypeOf)) {
            return { matches: true, specificity: Specificity.EXACT_TYPE_WITH_SUBTYPES };
        }
    }

    // Check pattern matching
    if (appliesTo.conceptPattern) {
        const regex = patternToRegex(appliesTo.conceptPattern);
        if (regex.test(instanceType)) {
            // Determine specificity based on wildcard position
            if (appliesTo.conceptPattern.startsWith('*')) {
                return { matches: true, specificity: Specificity.WILDCARD_SUFFIX };
            } else {
                return { matches: true, specificity: Specificity.WILDCARD_PREFIX };
            }
        }
    }

    return { matches: false, specificity: Specificity.GENERIC };
}

/**
 * Convert pattern string with wildcards to regex
 * Supports: "Requirement" (exact), "*Requirement" (suffix), "Requirement*" (prefix)
 */
function patternToRegex(pattern: string): RegExp {
    // Escape special regex characters
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    return new RegExp(`^${escaped}$`);
}

/**
 * Get applicable description constraint rules for an instance type
 * Used for description-level constraint validation
 */
export function getApplicableDescriptionRules(
    instanceType: string,
    constraints: DescriptionConstraint[],
    typeHierarchy?: Map<string, string[]>,
): Array<{
    rule: DescriptionConstraint;
    specificity: number;
    matchReason: string;
}> {
    const matches: Array<{
        rule: DescriptionConstraint;
        specificity: number;
        matchReason: string;
    }> = [];

    for (const rule of constraints) {
        const match = matchesAppliesTo(instanceType, rule.appliesTo, typeHierarchy);

        if (match.matches) {
            matches.push({
                rule,
                specificity: match.specificity,
                matchReason: match.reason || 'matched',
            });
        }
    }

    // Sort by specificity (descending), then by rule ID (for determinism when tied)
    matches.sort((a, b) => {
        if (a.specificity !== b.specificity) {
            return b.specificity - a.specificity; // Higher specificity first
        }
        // Tie-breaker: alphabetical by rule ID (deterministic)
        return a.rule.id.localeCompare(b.rule.id);
    });

    return matches;
}

/**
 * Validate a property assertion against a PropertyConstraint
 * Checks required properties, cardinality, and target types
 */
export function validateDescriptionPropertyConstraint(
    assertion: {
        propertyName: string;
        values: string[];
        instanceName: string;
        instanceType: string;
    },
    constraint: PropertyConstraint,
    typeHierarchy?: Map<string, string[]>,
): { isValid: boolean; reason?: string } {
    // Check property name matches
    if (constraint.property !== assertion.propertyName) {
        return { isValid: true }; // Not applicable
    }

    // Check required property
    if (constraint.targetMustBe && assertion.values.length === 0) {
        return {
            isValid: false,
            reason: `Property "${constraint.property}" is required but not set`,
        };
    }

    return { isValid: true };
}
