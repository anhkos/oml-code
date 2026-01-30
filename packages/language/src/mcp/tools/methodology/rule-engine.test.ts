/**
 * Unit tests for rule-engine.ts
 * 
 * Tests the deterministic rule matching engine for description constraints.
 */

import { describe, it, expect } from 'vitest';
import {
    matchesAppliesTo,
    getApplicableRules,
    validatePropertyConstraint,
    isTypeAllowed,
    Specificity,
} from './rule-engine.js';
import type { AppliesTo, DescriptionConstraint, PropertyConstraint } from './playbook-types.js';

describe('matchesAppliesTo', () => {
    describe('exact type matching', () => {
        it('should match exact type without subtypes', () => {
            const appliesTo: AppliesTo = {
                conceptType: 'requirement:SafetyRequirement',
            };

            const result = matchesAppliesTo('requirement:SafetyRequirement', appliesTo);

            expect(result.matches).toBe(true);
            expect(result.specificity).toBe(Specificity.EXACT_TYPE);
        });

        it('should not match different type', () => {
            const appliesTo: AppliesTo = {
                conceptType: 'requirement:SafetyRequirement',
            };

            const result = matchesAppliesTo('requirement:FunctionalRequirement', appliesTo);

            expect(result.matches).toBe(false);
            expect(result.specificity).toBe(Specificity.NO_MATCH);
        });

        it('should match exact type with subtypes flag', () => {
            const appliesTo: AppliesTo = {
                conceptType: 'requirement:Requirement',
                matchSubtypes: true,
            };

            const result = matchesAppliesTo('requirement:Requirement', appliesTo);

            expect(result.matches).toBe(true);
            expect(result.specificity).toBe(Specificity.EXACT_TYPE_WITH_SUBTYPES);
        });
    });

    describe('multiple types matching', () => {
        it('should match any type in the list', () => {
            const appliesTo: AppliesTo = {
                conceptTypes: ['requirement:Stakeholder', 'requirement:Requirement'],
            };

            const result = matchesAppliesTo('requirement:Stakeholder', appliesTo);

            expect(result.matches).toBe(true);
            expect(result.specificity).toBe(Specificity.MULTIPLE_TYPES);
        });

        it('should not match type not in list', () => {
            const appliesTo: AppliesTo = {
                conceptTypes: ['requirement:Stakeholder', 'requirement:Requirement'],
            };

            const result = matchesAppliesTo('component:Component', appliesTo);

            expect(result.matches).toBe(false);
        });
    });

    describe('pattern matching', () => {
        it('should match wildcard at start', () => {
            const appliesTo: AppliesTo = {
                conceptPattern: '*Requirement',
            };

            const result = matchesAppliesTo('requirement:SafetyRequirement', appliesTo);

            expect(result.matches).toBe(true);
            expect(result.specificity).toBe(Specificity.PATTERN_MATCH);
        });

        it('should match wildcard at end', () => {
            const appliesTo: AppliesTo = {
                conceptPattern: 'requirement:*',
            };

            const result = matchesAppliesTo('requirement:SafetyRequirement', appliesTo);

            expect(result.matches).toBe(true);
        });

        it('should match wildcard in middle', () => {
            const appliesTo: AppliesTo = {
                conceptPattern: 'requirement:*Requirement',
            };

            const result = matchesAppliesTo('requirement:SafetyRequirement', appliesTo);

            expect(result.matches).toBe(true);
        });

        it('should not match non-matching pattern', () => {
            const appliesTo: AppliesTo = {
                conceptPattern: '*Component',
            };

            const result = matchesAppliesTo('requirement:SafetyRequirement', appliesTo);

            expect(result.matches).toBe(false);
        });
    });

    describe('subtype matching with hierarchy', () => {
        it('should match subtype when hierarchy provided', () => {
            const appliesTo: AppliesTo = {
                anySubtypeOf: 'requirement:Requirement',
            };

            const typeHierarchy = new Map<string, string[]>([
                ['requirement:SafetyRequirement', ['requirement:Requirement']],
                ['requirement:FunctionalRequirement', ['requirement:Requirement']],
            ]);

            const result = matchesAppliesTo(
                'requirement:SafetyRequirement',
                appliesTo,
                typeHierarchy
            );

            expect(result.matches).toBe(true);
            expect(result.specificity).toBe(Specificity.SUBTYPE_MATCH);
        });

        it('should match deeply nested subtype', () => {
            const appliesTo: AppliesTo = {
                anySubtypeOf: 'requirement:Requirement',
            };

            const typeHierarchy = new Map<string, string[]>([
                ['requirement:CriticalSafetyRequirement', ['requirement:SafetyRequirement']],
                ['requirement:SafetyRequirement', ['requirement:Requirement']],
            ]);

            const result = matchesAppliesTo(
                'requirement:CriticalSafetyRequirement',
                appliesTo,
                typeHierarchy
            );

            expect(result.matches).toBe(true);
        });

        it('should not match without hierarchy info', () => {
            const appliesTo: AppliesTo = {
                anySubtypeOf: 'requirement:Requirement',
            };

            const result = matchesAppliesTo(
                'requirement:SafetyRequirement',
                appliesTo
                // No hierarchy provided
            );

            expect(result.matches).toBe(false);
        });
    });
});

describe('getApplicableRules', () => {
    const createRule = (id: string, appliesTo: AppliesTo): DescriptionConstraint => ({
        id,
        message: `Rule ${id}`,
        appliesTo,
        constraints: [],
    });

    it('should return rules sorted by specificity', () => {
        const rules: DescriptionConstraint[] = [
            createRule('pattern-rule', { conceptPattern: '*Requirement' }),
            createRule('exact-rule', { conceptType: 'requirement:SafetyRequirement' }),
            createRule('multiple-rule', { conceptTypes: ['requirement:SafetyRequirement', 'requirement:Requirement'] }),
        ];

        const result = getApplicableRules('requirement:SafetyRequirement', rules);

        expect(result).toHaveLength(3);
        expect(result[0].rule.id).toBe('exact-rule');       // Specificity 1000
        expect(result[1].rule.id).toBe('multiple-rule');    // Specificity 250
        expect(result[2].rule.id).toBe('pattern-rule');     // Specificity 100
    });

    it('should use alphabetical ordering for tie-breaking', () => {
        const rules: DescriptionConstraint[] = [
            createRule('b-rule', { conceptType: 'requirement:Requirement' }),
            createRule('a-rule', { conceptType: 'requirement:Requirement' }),
            createRule('c-rule', { conceptType: 'requirement:Requirement' }),
        ];

        const result = getApplicableRules('requirement:Requirement', rules);

        expect(result).toHaveLength(3);
        expect(result[0].rule.id).toBe('a-rule');
        expect(result[1].rule.id).toBe('b-rule');
        expect(result[2].rule.id).toBe('c-rule');
    });

    it('should be deterministic (same result for same input)', () => {
        const rules: DescriptionConstraint[] = [
            createRule('z-rule', { conceptPattern: '*Req*' }),
            createRule('a-rule', { conceptPattern: '*Requirement' }),
            createRule('m-rule', { conceptPattern: 'requirement:*' }),
        ];

        // Run 100 times to ensure determinism
        const firstResult = getApplicableRules('requirement:SafetyRequirement', rules);
        
        for (let i = 0; i < 100; i++) {
            const result = getApplicableRules('requirement:SafetyRequirement', rules);
            expect(result.map(r => r.rule.id)).toEqual(firstResult.map(r => r.rule.id));
        }
    });

    it('should exclude non-matching rules', () => {
        const rules: DescriptionConstraint[] = [
            createRule('matching', { conceptType: 'requirement:Requirement' }),
            createRule('non-matching', { conceptType: 'component:Component' }),
        ];

        const result = getApplicableRules('requirement:Requirement', rules);

        expect(result).toHaveLength(1);
        expect(result[0].rule.id).toBe('matching');
    });
});

describe('validatePropertyConstraint', () => {
    const createAssertion = (property: string, values: string[]) => ({
        propertyName: property,
        values,
        instanceName: 'TestInstance',
        instanceType: 'requirement:Requirement',
    });

    describe('required property validation', () => {
        it('should fail when required property is missing', () => {
            const constraint: PropertyConstraint = {
                property: 'description',
                required: true,
            };

            const result = validatePropertyConstraint(
                createAssertion('description', []),
                constraint
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('required');
        });

        it('should pass when required property has value', () => {
            const constraint: PropertyConstraint = {
                property: 'description',
                required: true,
            };

            const result = validatePropertyConstraint(
                createAssertion('description', ['Some description']),
                constraint
            );

            expect(result.isValid).toBe(true);
        });
    });

    describe('cardinality validation', () => {
        it('should fail when below minimum occurrences', () => {
            const constraint: PropertyConstraint = {
                property: 'isExpressedBy',
                minOccurrences: 2,
            };

            const result = validatePropertyConstraint(
                createAssertion('isExpressedBy', ['Stakeholder1']),
                constraint
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('at least 2');
        });

        it('should fail when above maximum occurrences', () => {
            const constraint: PropertyConstraint = {
                property: 'isExpressedBy',
                maxOccurrences: 2,
            };

            const result = validatePropertyConstraint(
                createAssertion('isExpressedBy', ['S1', 'S2', 'S3']),
                constraint
            );

            expect(result.isValid).toBe(false);
            expect(result.reason).toContain('at most 2');
        });

        it('should pass when within cardinality bounds', () => {
            const constraint: PropertyConstraint = {
                property: 'isExpressedBy',
                minOccurrences: 1,
                maxOccurrences: 3,
            };

            const result = validatePropertyConstraint(
                createAssertion('isExpressedBy', ['S1', 'S2']),
                constraint
            );

            expect(result.isValid).toBe(true);
        });
    });

    describe('property name matching', () => {
        it('should return valid for non-matching property', () => {
            const constraint: PropertyConstraint = {
                property: 'description',
                required: true,
            };

            // Different property name
            const result = validatePropertyConstraint(
                createAssertion('isExpressedBy', []),
                constraint
            );

            expect(result.isValid).toBe(true);  // Not applicable
        });
    });
});

describe('isTypeAllowed', () => {
    it('should return true for allowed type', () => {
        const allowed = ['requirement:Requirement', 'requirement:Stakeholder'];
        
        expect(isTypeAllowed('requirement:Requirement', allowed)).toBe(true);
        expect(isTypeAllowed('requirement:Stakeholder', allowed)).toBe(true);
    });

    it('should return false for disallowed type', () => {
        const allowed = ['requirement:Requirement', 'requirement:Stakeholder'];
        
        expect(isTypeAllowed('component:Component', allowed)).toBe(false);
    });

    it('should be case-sensitive', () => {
        const allowed = ['requirement:Requirement'];
        
        expect(isTypeAllowed('Requirement:requirement', allowed)).toBe(false);
        expect(isTypeAllowed('requirement:requirement', allowed)).toBe(false);
    });
});

describe('Specificity enum', () => {
    it('should have correct precedence ordering', () => {
        expect(Specificity.EXACT_TYPE).toBeGreaterThan(Specificity.EXACT_TYPE_WITH_SUBTYPES);
        expect(Specificity.EXACT_TYPE_WITH_SUBTYPES).toBeGreaterThan(Specificity.MULTIPLE_TYPES);
        expect(Specificity.MULTIPLE_TYPES).toBeGreaterThan(Specificity.PATTERN_MATCH);
        expect(Specificity.PATTERN_MATCH).toBeGreaterThan(Specificity.SUBTYPE_MATCH);
        expect(Specificity.SUBTYPE_MATCH).toBeGreaterThan(Specificity.NO_MATCH);
    });

    it('should have expected values', () => {
        expect(Specificity.EXACT_TYPE).toBe(1000);
        expect(Specificity.EXACT_TYPE_WITH_SUBTYPES).toBe(500);
        expect(Specificity.MULTIPLE_TYPES).toBe(250);
        expect(Specificity.PATTERN_MATCH).toBe(100);
        expect(Specificity.SUBTYPE_MATCH).toBe(50);
        expect(Specificity.NO_MATCH).toBe(0);
    });
});
