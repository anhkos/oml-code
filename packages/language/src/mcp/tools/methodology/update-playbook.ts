/**
 * Tool for updating methodology playbook YAML files.
 * Supports granular updates to any section: metadata, relations, concepts, constraints, etc.
 */

import { z } from 'zod';
import type { 
    RelationRule,
    RelationEntityRule,
    ConceptRule,
    ContainmentRule,
    AllocationRule,
    DescriptionConstraint,
    InstanceTemplate,
    NamingPattern,
    PropertyMapping,
} from './playbook-types.js';
import {
    resolvePlaybookPath,
    loadPlaybook as loadPlaybookHelper,
    savePlaybook as savePlaybookHelper,
    findDescriptionSchema as findDescriptionSchemaHelper,
    suggestConstraintIds,
    listDescriptionFiles,
} from './playbook-helpers.js';

// ============================================================================
// Schema Definitions
// ============================================================================

const PropertyConstraintSchema = z.object({
    property: z.string(),
    required: z.boolean().optional(),
    targetMustBe: z.string().optional(),
    targetMustBeOneOf: z.array(z.string()).optional(),
    targetMatchSubtypes: z.boolean().optional(),
    minOccurrences: z.number().optional(),
    maxOccurrences: z.number().optional(),
});

const AppliesToSchema = z.object({
    conceptType: z.string().optional(),
    conceptTypes: z.array(z.string()).optional(),
    conceptPattern: z.string().optional(),
    matchSubtypes: z.boolean().optional(),
    anySubtypeOf: z.string().optional(),
});

const DescriptionConstraintSchema = z.object({
    id: z.string(),
    message: z.string(),
    appliesTo: AppliesToSchema,
    constraints: z.array(PropertyConstraintSchema),
    severity: z.enum(['error', 'warning', 'info']).optional(),
    rationale: z.string().optional(),
});

const RelationRuleSchema = z.object({
    forwardRelation: z.string(),
    reverseRelation: z.string(),
    owningConcept: z.string(),
    preferredDirection: z.enum(['forward', 'reverse']),
    rationale: z.string().optional(),
    sourceFile: z.string().optional(),
});

const RelationEntityRuleSchema = z.object({
    relationEntity: z.string(),
    forwardRelation: z.string(),
    reverseRelation: z.string(),
    fromConcept: z.string(),
    toConcept: z.string(),
    preferredDirection: z.enum(['forward', 'reverse']),
    rationale: z.string().optional(),
    sourceFile: z.string().optional(),
});

const ConceptRuleSchema = z.object({
    concept: z.string(),
    requiredProperties: z.array(z.string()).optional(),
    recommendedProperties: z.array(z.string()).optional(),
    descriptionFilePattern: z.string().optional(),
    containerConcept: z.string().optional(),
    notes: z.string().optional(),
});

const ContainmentRuleSchema = z.object({
    container: z.string(),
    contained: z.array(z.string()),
    relation: z.string(),
    cardinality: z.object({
        min: z.number().optional(),
        max: z.number().optional(),
        exactly: z.number().optional(),
    }).optional(),
    sourceFile: z.string().optional(),
});

const AllocationRuleSchema = z.object({
    subject: z.string(),
    target: z.string(),
    relation: z.string(),
    reverseRelation: z.string(),
    owningConcept: z.string(),
    preferredDirection: z.enum(['forward', 'reverse']),
    rationale: z.string().optional(),
});

const RoutingEntrySchema = z.object({
    concept: z.string(),
    priority: z.number(),
});

const MetadataUpdateSchema = z.object({
    methodology: z.string().optional(),
    version: z.string().optional(),
    sourceVocabularies: z.array(z.string()).optional(),
});

// Instance template schemas
const NamingPatternSchema = z.object({
    prefix: z.string().describe('Prefix for the name (e.g., "R" for R1, R2)'),
    counterStyle: z.enum(['number', 'padded', 'alpha']).optional()
        .describe('Counter style: number (1,2,3), padded (001,002), alpha (A,B,C)'),
    paddingWidth: z.number().optional()
        .describe('Padding width for padded style (default: 3)'),
    startFrom: z.number().optional()
        .describe('Starting number (default: 1)'),
    suffix: z.string().optional()
        .describe('Optional suffix'),
});

const PropertyMappingSchema = z.object({
    property: z.string().describe('OML property name (e.g., "base:description")'),
    mapsFrom: z.string().describe('Semantic field name user provides (e.g., "name", "text")'),
    valueType: z.enum(['literal', 'reference']).describe('literal for scalars, reference for relations'),
    literalType: z.enum(['quoted', 'integer', 'decimal', 'double', 'boolean']).optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    defaultValue: z.string().optional(),
});

const InstanceTemplateSchema = z.object({
    id: z.string().describe('Unique identifier for this template'),
    appliesTo: AppliesToSchema.describe('What concept type(s) this template applies to'),
    naming: NamingPatternSchema.optional().describe('Naming pattern for auto-generating names'),
    propertyMappings: z.array(PropertyMappingSchema).describe('Property mappings from semantic fields'),
    description: z.string().optional(),
    example: z.object({
        input: z.record(z.string()),
        output: z.string(),
    }).optional(),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const updatePlaybookTool = {
    name: 'update_playbook' as const,
    description: `Update a methodology playbook YAML file. Supports granular updates to any section.

AUTO-DETECTION: If playbookPath is not provided, searches the workspace for *_playbook.yaml files.

FINDING CONSTRAINT IDs: Use list_playbook_constraints first to discover constraint IDs before updating them.

USE THIS TOOL when the user asks to:
- Add/update relation direction rules
- Add/update concept rules (required properties)
- Add/update containment rules
- Add/update description constraints (targetMustBe, required, severity)
- Modify allowed types for descriptions
- Update metadata

FLEXIBLE UPDATES - You can update:
- **One thing**: Just the targetMustBe for one constraint
- **Multiple things**: Several constraints + allowed types
- **Everything**: Full playbook sections

SECTIONS:
- \`metadata\`: Methodology name, version, sources
- \`relationRules\`: Bidirectional relation direction preferences
- \`relationEntityRules\`: Reified relation rules  
- \`conceptRules\`: Required/recommended properties per concept
- \`containmentRules\`: Container/Contained hierarchy
- \`allocationRules\`: Allocation/assignment rules
- \`descriptions\`: Per-file schemas, constraints, routing

EXAMPLES:

**Add target type to constraint (auto-detect playbook):**
{
  "workspacePath": "/path/to/project",
  "descriptionUpdates": {
    "stakeholders_requirements.oml": {
      "constraintUpdates": {
        "stakeholders-req-requirement-has-stakeholder": {
          "propertyUpdates": {
            "requirement:isExpressedBy": {
              "targetMustBe": "requirement:Stakeholder"
            }
          }
        }
      }
    }
  }
}

**Add allowed types:**
{
  "workspacePath": "/path/to/project",
  "descriptionUpdates": {
    "stakeholders_requirements.oml": {
      "addAllowedTypes": ["entity:Actor"]
    }
  }
}

**Add relation rule:**
{
  "workspacePath": "/path/to/project",
  "addRelationRules": [{
    "forwardRelation": "requirement:expresses",
    "reverseRelation": "requirement:isExpressedBy",
    "owningConcept": "requirement:Requirement",
    "preferredDirection": "reverse",
    "rationale": "Requirements are expressed BY stakeholders"
  }]
}

**Add concept rule:**
{
  "workspacePath": "/path/to/project",
  "addConceptRules": [{
    "concept": "requirement:Requirement",
    "requiredProperties": ["base:description", "base:expression"],
    "recommendedProperties": ["requirement:isExpressedBy"]
  }]
}

**Multiple updates at once:**
{
  "workspacePath": "/path/to/project",
  "metadata": { "version": "2.0.0" },
  "addRelationRules": [...],
  "descriptionUpdates": {
    "file1.oml": { "addAllowedTypes": [...] },
    "file2.oml": { "addConstraints": [...] }
  }
}`,
    paramsSchema: {
        playbookPath: z.string().optional()
            .describe('Path to playbook YAML file (auto-detects if not provided)'),
        workspacePath: z.string().optional()
            .describe('Workspace root for auto-detection when playbookPath is not provided'),
        
        // Metadata updates
        metadata: MetadataUpdateSchema.optional()
            .describe('Update playbook metadata (methodology name, version, sources)'),
        
        // Relation rules
        addRelationRules: z.array(RelationRuleSchema).optional()
            .describe('Add new relation direction rules'),
        updateRelationRule: z.object({
            forwardRelation: z.string().describe('Forward relation to find/update'),
            updates: RelationRuleSchema.partial(),
        }).optional().describe('Update an existing relation rule'),
        removeRelationRule: z.string().optional()
            .describe('Remove relation rule by forward relation name'),
        
        // Relation entity rules
        addRelationEntityRules: z.array(RelationEntityRuleSchema).optional()
            .describe('Add new relation entity rules'),
        updateRelationEntityRule: z.object({
            relationEntity: z.string().describe('Relation entity to find/update'),
            updates: RelationEntityRuleSchema.partial(),
        }).optional().describe('Update an existing relation entity rule'),
        removeRelationEntityRule: z.string().optional()
            .describe('Remove relation entity rule by name'),
        
        // Concept rules
        addConceptRules: z.array(ConceptRuleSchema).optional()
            .describe('Add new concept rules'),
        updateConceptRule: z.object({
            concept: z.string().describe('Concept to find/update'),
            updates: ConceptRuleSchema.partial(),
            addRequiredProperties: z.array(z.string()).optional(),
            removeRequiredProperties: z.array(z.string()).optional(),
            addRecommendedProperties: z.array(z.string()).optional(),
            removeRecommendedProperties: z.array(z.string()).optional(),
        }).optional().describe('Update an existing concept rule'),
        removeConceptRule: z.string().optional()
            .describe('Remove concept rule by concept name'),
        
        // Containment rules
        addContainmentRules: z.array(ContainmentRuleSchema).optional()
            .describe('Add new containment rules'),
        updateContainmentRule: z.object({
            container: z.string().describe('Container concept to find/update'),
            updates: ContainmentRuleSchema.partial(),
            addContained: z.array(z.string()).optional(),
            removeContained: z.array(z.string()).optional(),
        }).optional().describe('Update an existing containment rule'),
        removeContainmentRule: z.string().optional()
            .describe('Remove containment rule by container name'),
        
        // Allocation rules
        addAllocationRules: z.array(AllocationRuleSchema).optional()
            .describe('Add new allocation rules'),
        updateAllocationRule: z.object({
            subject: z.string().describe('Subject to find/update'),
            updates: AllocationRuleSchema.partial(),
        }).optional().describe('Update an existing allocation rule'),
        removeAllocationRule: z.string().optional()
            .describe('Remove allocation rule by subject name'),
        
        // Description-level updates (most flexible)
        descriptionUpdates: z.record(z.string(), z.object({
            // Allowed types
            allowedTypes: z.array(z.string()).optional()
                .describe('Replace all allowed types'),
            addAllowedTypes: z.array(z.string()).optional()
                .describe('Add to existing allowed types'),
            removeAllowedTypes: z.array(z.string()).optional()
                .describe('Remove from allowed types'),
            
            // Purpose
            purpose: z.string().optional()
                .describe('Update description purpose text'),
            
            // Routing
            routing: z.array(RoutingEntrySchema).optional()
                .describe('Replace routing priorities'),
            addRouting: z.array(RoutingEntrySchema).optional()
                .describe('Add routing entries'),
            removeRoutingConcepts: z.array(z.string()).optional()
                .describe('Remove routing entries by concept'),
            
            // Constraints - add new
            addConstraints: z.array(DescriptionConstraintSchema).optional()
                .describe('Add new constraints'),
            
            // Constraints - remove
            removeConstraints: z.array(z.string()).optional()
                .describe('Remove constraints by ID'),
            
            // Constraints - update existing (most granular)
            constraintUpdates: z.record(z.string(), z.object({
                message: z.string().optional(),
                appliesTo: AppliesToSchema.optional(),
                severity: z.enum(['error', 'warning', 'info']).optional(),
                rationale: z.string().optional(),
                
                // Property-level updates within constraint
                propertyUpdates: z.record(z.string(), z.object({
                    required: z.boolean().optional(),
                    targetMustBe: z.string().optional(),
                    targetMustBeOneOf: z.array(z.string()).optional(),
                    targetMatchSubtypes: z.boolean().optional(),
                    minOccurrences: z.number().optional(),
                    maxOccurrences: z.number().optional(),
                    clearTargetMustBe: z.boolean().optional(),
                    clearTargetMustBeOneOf: z.boolean().optional(),
                }).optional()).optional()
                    .describe('Update specific properties within the constraint'),
                
                addProperties: z.array(PropertyConstraintSchema).optional()
                    .describe('Add new property constraints'),
                removeProperties: z.array(z.string()).optional()
                    .describe('Remove property constraints by property name'),
            })).optional().describe('Update existing constraints by ID'),
        })).optional().describe('Updates to description schemas, keyed by file name'),
        
        // Instance template operations
        addInstanceTemplates: z.array(InstanceTemplateSchema).optional()
            .describe('Add new instance templates for naming conventions and property mappings'),
        updateInstanceTemplate: z.object({
            id: z.string().describe('Template ID to update'),
            naming: NamingPatternSchema.optional(),
            propertyMappings: z.array(PropertyMappingSchema).optional()
                .describe('Replace all property mappings'),
            addPropertyMappings: z.array(PropertyMappingSchema).optional()
                .describe('Add property mappings'),
            removePropertyMappings: z.array(z.string()).optional()
                .describe('Remove property mappings by mapsFrom field name'),
            description: z.string().optional(),
        }).optional().describe('Update an existing instance template'),
        removeInstanceTemplate: z.string().optional()
            .describe('Remove instance template by ID'),
    },
};

// ============================================================================
// Types
// ============================================================================

interface PropertyConstraintUpdate {
    required?: boolean;
    targetMustBe?: string;
    targetMustBeOneOf?: string[];
    targetMatchSubtypes?: boolean;
    minOccurrences?: number;
    maxOccurrences?: number;
    clearTargetMustBe?: boolean;
    clearTargetMustBeOneOf?: boolean;
}

interface ConstraintUpdate {
    message?: string;
    appliesTo?: { instanceType: string } | { instancePattern: string };
    severity?: 'error' | 'warning' | 'info';
    rationale?: string;
    propertyUpdates?: Record<string, PropertyConstraintUpdate>;
    addProperties?: Array<{
        property: string;
        required?: boolean;
        targetMustBe?: string;
        targetMustBeOneOf?: string[];
        targetMatchSubtypes?: boolean;
        minOccurrences?: number;
        maxOccurrences?: number;
    }>;
    removeProperties?: string[];
}

interface DescriptionUpdate {
    allowedTypes?: string[];
    addAllowedTypes?: string[];
    removeAllowedTypes?: string[];
    purpose?: string;
    routing?: Array<{ concept: string; priority: number }>;
    addRouting?: Array<{ concept: string; priority: number }>;
    removeRoutingConcepts?: string[];
    addConstraints?: Array<{
        id: string;
        message: string;
        appliesTo?: { instanceType: string } | { instancePattern: string };
        severity?: 'error' | 'warning' | 'info';
        rationale?: string;
        constraints: Array<{
            property: string;
            required?: boolean;
            targetMustBe?: string;
            targetMustBeOneOf?: string[];
            targetMatchSubtypes?: boolean;
            minOccurrences?: number;
            maxOccurrences?: number;
        }>;
    }>;
    removeConstraints?: string[];
    constraintUpdates?: Record<string, ConstraintUpdate>;
}

interface UpdatePlaybookParams {
    playbookPath?: string;
    workspacePath?: string;
    
    // Metadata
    metadata?: {
        methodology?: string;
        version?: string;
        sourceVocabularies?: string[];
    };
    
    // Relation rules
    addRelationRules?: Array<{
        forwardRelation: string;
        reverseRelation: string;
        owningConcept: string;
        preferredDirection: 'forward' | 'reverse';
        rationale?: string;
    }>;
    updateRelationRule?: {
        forwardRelation: string;
        updates: Partial<{
            forwardRelation: string;
            reverseRelation: string;
            owningConcept: string;
            preferredDirection: 'forward' | 'reverse';
            rationale?: string;
        }>;
    };
    removeRelationRule?: string;
    
    // Relation entity rules
    addRelationEntityRules?: Array<{
        relationEntity: string;
        forwardRelation: string;
        reverseRelation: string;
        fromConcept: string;
        toConcept: string;
        preferredDirection: 'forward' | 'reverse';
        rationale?: string;
    }>;
    updateRelationEntityRule?: {
        relationEntity: string;
        updates: Partial<{
            relationEntity: string;
            forwardRelation: string;
            reverseRelation: string;
            fromConcept: string;
            toConcept: string;
            preferredDirection: 'forward' | 'reverse';
            rationale?: string;
        }>;
    };
    removeRelationEntityRule?: string;
    
    // Concept rules
    addConceptRules?: Array<{
        concept: string;
        requiredProperties?: string[];
        recommendedProperties?: string[];
        rationale?: string;
    }>;
    updateConceptRule?: {
        concept: string;
        updates: Partial<{
            concept: string;
            requiredProperties?: string[];
            recommendedProperties?: string[];
            rationale?: string;
        }>;
        addRequiredProperties?: string[];
        removeRequiredProperties?: string[];
        addRecommendedProperties?: string[];
        removeRecommendedProperties?: string[];
    };
    removeConceptRule?: string;
    
    // Containment rules
    addContainmentRules?: Array<{
        container: string;
        contained: string[];
        relation?: string;
        rationale?: string;
    }>;
    updateContainmentRule?: {
        container: string;
        updates: Partial<{
            container: string;
            contained: string[];
            relation?: string;
            rationale?: string;
        }>;
        addContained?: string[];
        removeContained?: string[];
    };
    removeContainmentRule?: string;
    
    // Allocation rules
    addAllocationRules?: Array<{
        subject: string;
        target: string;
        relation: string;
        reverseRelation: string;
        owningConcept: string;
        preferredDirection: 'forward' | 'reverse';
        rationale?: string;
    }>;
    updateAllocationRule?: {
        subject: string;
        updates: Partial<{
            subject: string;
            target: string;
            relation: string;
            reverseRelation: string;
            owningConcept: string;
            preferredDirection: 'forward' | 'reverse';
            rationale?: string;
        }>;
    };
    removeAllocationRule?: string;
    
    // Description updates
    descriptionUpdates?: Record<string, DescriptionUpdate>;
    
    // Instance template updates
    addInstanceTemplates?: InstanceTemplate[];
    updateInstanceTemplate?: {
        id: string;
        naming?: NamingPattern;
        propertyMappings?: PropertyMapping[];
        addPropertyMappings?: PropertyMapping[];
        removePropertyMappings?: string[];
        description?: string;
    };
    removeInstanceTemplate?: string;
}

// ============================================================================
// Handler
// ============================================================================

export async function updatePlaybookHandler(params: UpdatePlaybookParams): Promise<{
    content: Array<{ type: 'text'; text: string }>;
}> {
    const changes: string[] = [];

    try {
        // Auto-detect playbook path if not provided
        const playbookPath = resolvePlaybookPath({
            playbookPath: params.playbookPath,
            workspacePath: params.workspacePath,
        });
        
        const playbook = loadPlaybookHelper(playbookPath);

        // ====================================================================
        // Metadata Updates
        // ====================================================================
        if (params.metadata) {
            if (params.metadata.methodology) {
                playbook.metadata.methodology = params.metadata.methodology;
                changes.push(`Updated methodology name to "${params.metadata.methodology}"`);
            }
            if (params.metadata.version) {
                playbook.metadata.version = params.metadata.version;
                changes.push(`Updated version to "${params.metadata.version}"`);
            }
            if (params.metadata.sourceVocabularies) {
                playbook.metadata.sourceVocabularies = params.metadata.sourceVocabularies;
                changes.push(`Updated source vocabularies`);
            }
        }

        // ====================================================================
        // Relation Rules
        // ====================================================================
        if (params.addRelationRules) {
            playbook.relationRules = playbook.relationRules || [];
            for (const rule of params.addRelationRules) {
                // Check for duplicate
                const existing = playbook.relationRules.find(r => r.forwardRelation === rule.forwardRelation);
                if (existing) {
                    Object.assign(existing, rule);
                    changes.push(`Updated relation rule: ${rule.forwardRelation}`);
                } else {
                    playbook.relationRules.push(rule as RelationRule);
                    changes.push(`Added relation rule: ${rule.forwardRelation} / ${rule.reverseRelation}`);
                }
            }
        }

        if (params.updateRelationRule) {
            const rule = playbook.relationRules?.find(r => r.forwardRelation === params.updateRelationRule!.forwardRelation);
            if (rule) {
                Object.assign(rule, params.updateRelationRule.updates);
                changes.push(`Updated relation rule: ${params.updateRelationRule.forwardRelation}`);
            } else {
                throw new Error(`Relation rule not found: ${params.updateRelationRule.forwardRelation}`);
            }
        }

        if (params.removeRelationRule) {
            const idx = playbook.relationRules?.findIndex(r => r.forwardRelation === params.removeRelationRule);
            if (idx !== undefined && idx >= 0) {
                playbook.relationRules!.splice(idx, 1);
                changes.push(`Removed relation rule: ${params.removeRelationRule}`);
            }
        }

        // ====================================================================
        // Relation Entity Rules
        // ====================================================================
        if (params.addRelationEntityRules) {
            playbook.relationEntityRules = playbook.relationEntityRules || [];
            for (const rule of params.addRelationEntityRules) {
                const existing = playbook.relationEntityRules.find(r => r.relationEntity === rule.relationEntity);
                if (existing) {
                    Object.assign(existing, rule);
                    changes.push(`Updated relation entity rule: ${rule.relationEntity}`);
                } else {
                    playbook.relationEntityRules.push(rule as RelationEntityRule);
                    changes.push(`Added relation entity rule: ${rule.relationEntity}`);
                }
            }
        }

        if (params.updateRelationEntityRule) {
            const rule = playbook.relationEntityRules?.find(r => r.relationEntity === params.updateRelationEntityRule!.relationEntity);
            if (rule) {
                Object.assign(rule, params.updateRelationEntityRule.updates);
                changes.push(`Updated relation entity rule: ${params.updateRelationEntityRule.relationEntity}`);
            } else {
                throw new Error(`Relation entity rule not found: ${params.updateRelationEntityRule.relationEntity}`);
            }
        }

        if (params.removeRelationEntityRule) {
            const idx = playbook.relationEntityRules?.findIndex(r => r.relationEntity === params.removeRelationEntityRule);
            if (idx !== undefined && idx >= 0) {
                playbook.relationEntityRules!.splice(idx, 1);
                changes.push(`Removed relation entity rule: ${params.removeRelationEntityRule}`);
            }
        }

        // ====================================================================
        // Concept Rules
        // ====================================================================
        if (params.addConceptRules) {
            playbook.conceptRules = playbook.conceptRules || [];
            for (const rule of params.addConceptRules) {
                const existing = playbook.conceptRules.find(r => r.concept === rule.concept);
                if (existing) {
                    Object.assign(existing, rule);
                    changes.push(`Updated concept rule: ${rule.concept}`);
                } else {
                    playbook.conceptRules.push(rule as ConceptRule);
                    changes.push(`Added concept rule: ${rule.concept}`);
                }
            }
        }

        if (params.updateConceptRule) {
            const rule = playbook.conceptRules?.find(r => r.concept === params.updateConceptRule!.concept);
            if (rule) {
                if (params.updateConceptRule.updates) {
                    Object.assign(rule, params.updateConceptRule.updates);
                }
                if (params.updateConceptRule.addRequiredProperties) {
                    rule.requiredProperties = rule.requiredProperties || [];
                    for (const prop of params.updateConceptRule.addRequiredProperties) {
                        if (!rule.requiredProperties.includes(prop)) {
                            rule.requiredProperties.push(prop);
                        }
                    }
                }
                if (params.updateConceptRule.removeRequiredProperties) {
                    rule.requiredProperties = rule.requiredProperties?.filter(
                        p => !params.updateConceptRule!.removeRequiredProperties!.includes(p)
                    );
                }
                if (params.updateConceptRule.addRecommendedProperties) {
                    rule.recommendedProperties = rule.recommendedProperties || [];
                    for (const prop of params.updateConceptRule.addRecommendedProperties) {
                        if (!rule.recommendedProperties.includes(prop)) {
                            rule.recommendedProperties.push(prop);
                        }
                    }
                }
                if (params.updateConceptRule.removeRecommendedProperties) {
                    rule.recommendedProperties = rule.recommendedProperties?.filter(
                        p => !params.updateConceptRule!.removeRecommendedProperties!.includes(p)
                    );
                }
                changes.push(`Updated concept rule: ${params.updateConceptRule.concept}`);
            } else {
                throw new Error(`Concept rule not found: ${params.updateConceptRule.concept}`);
            }
        }

        if (params.removeConceptRule) {
            const idx = playbook.conceptRules?.findIndex(r => r.concept === params.removeConceptRule);
            if (idx !== undefined && idx >= 0) {
                playbook.conceptRules!.splice(idx, 1);
                changes.push(`Removed concept rule: ${params.removeConceptRule}`);
            }
        }

        // ====================================================================
        // Containment Rules
        // ====================================================================
        if (params.addContainmentRules) {
            playbook.containmentRules = playbook.containmentRules || [];
            for (const rule of params.addContainmentRules) {
                const existing = playbook.containmentRules.find(r => r.container === rule.container);
                if (existing) {
                    Object.assign(existing, rule);
                    changes.push(`Updated containment rule: ${rule.container}`);
                } else {
                    playbook.containmentRules.push(rule as ContainmentRule);
                    changes.push(`Added containment rule: ${rule.container} contains [${rule.contained.join(', ')}]`);
                }
            }
        }

        if (params.updateContainmentRule) {
            const rule = playbook.containmentRules?.find(r => r.container === params.updateContainmentRule!.container);
            if (rule) {
                if (params.updateContainmentRule.updates) {
                    Object.assign(rule, params.updateContainmentRule.updates);
                }
                if (params.updateContainmentRule.addContained) {
                    for (const c of params.updateContainmentRule.addContained) {
                        if (!rule.contained.includes(c)) {
                            rule.contained.push(c);
                        }
                    }
                }
                if (params.updateContainmentRule.removeContained) {
                    rule.contained = rule.contained.filter(
                        c => !params.updateContainmentRule!.removeContained!.includes(c)
                    );
                }
                changes.push(`Updated containment rule: ${params.updateContainmentRule.container}`);
            } else {
                throw new Error(`Containment rule not found: ${params.updateContainmentRule.container}`);
            }
        }

        if (params.removeContainmentRule) {
            const idx = playbook.containmentRules?.findIndex(r => r.container === params.removeContainmentRule);
            if (idx !== undefined && idx >= 0) {
                playbook.containmentRules!.splice(idx, 1);
                changes.push(`Removed containment rule: ${params.removeContainmentRule}`);
            }
        }

        // ====================================================================
        // Allocation Rules
        // ====================================================================
        if (params.addAllocationRules) {
            playbook.allocationRules = playbook.allocationRules || [];
            for (const rule of params.addAllocationRules) {
                const existing = playbook.allocationRules.find(r => r.subject === rule.subject && r.target === rule.target);
                if (existing) {
                    Object.assign(existing, rule);
                    changes.push(`Updated allocation rule: ${rule.subject} -> ${rule.target}`);
                } else {
                    playbook.allocationRules.push(rule as AllocationRule);
                    changes.push(`Added allocation rule: ${rule.subject} -> ${rule.target}`);
                }
            }
        }

        if (params.updateAllocationRule) {
            const rule = playbook.allocationRules?.find(r => r.subject === params.updateAllocationRule!.subject);
            if (rule) {
                Object.assign(rule, params.updateAllocationRule.updates);
                changes.push(`Updated allocation rule: ${params.updateAllocationRule.subject}`);
            } else {
                throw new Error(`Allocation rule not found: ${params.updateAllocationRule.subject}`);
            }
        }

        if (params.removeAllocationRule) {
            const idx = playbook.allocationRules?.findIndex(r => r.subject === params.removeAllocationRule);
            if (idx !== undefined && idx >= 0) {
                playbook.allocationRules!.splice(idx, 1);
                changes.push(`Removed allocation rule: ${params.removeAllocationRule}`);
            }
        }

        // ====================================================================
        // Description Updates (most granular)
        // ====================================================================
        if (params.descriptionUpdates) {
            playbook.descriptions = playbook.descriptions || {};

            for (const [descFile, updates] of Object.entries(params.descriptionUpdates)) {
                const schemaResult = findDescriptionSchemaHelper(playbook, descFile);
                
                if (!schemaResult) {
                    const available = listDescriptionFiles(playbook);
                    throw new Error(
                        `Description schema not found for: ${descFile}\n` +
                        `Available description files:\n${available.map(f => `  - ${f}`).join('\n') || '  (none)'}\n\n` +
                        `Tip: Use extract_description_schemas to generate schemas first.`
                    );
                }
                
                const schema = schemaResult.schema;

                // Allowed types
                if (updates.allowedTypes) {
                    schema.allowedTypes = updates.allowedTypes;
                    changes.push(`Set allowed types for ${descFile}: [${updates.allowedTypes.join(', ')}]`);
                }
                if (updates.addAllowedTypes) {
                    for (const type of updates.addAllowedTypes) {
                        if (!schema.allowedTypes.includes(type)) {
                            schema.allowedTypes.push(type);
                        }
                    }
                    changes.push(`Added allowed types to ${descFile}: [${updates.addAllowedTypes.join(', ')}]`);
                }
                if (updates.removeAllowedTypes) {
                    schema.allowedTypes = schema.allowedTypes.filter(t => !updates.removeAllowedTypes!.includes(t));
                    changes.push(`Removed allowed types from ${descFile}: [${updates.removeAllowedTypes.join(', ')}]`);
                }

                // Purpose
                if (updates.purpose) {
                    schema.purpose = updates.purpose;
                    changes.push(`Updated purpose for ${descFile}`);
                }

                // Routing
                if (updates.routing) {
                    schema.routing = updates.routing;
                    changes.push(`Set routing for ${descFile}`);
                }
                if (updates.addRouting) {
                    schema.routing = schema.routing || [];
                    for (const entry of updates.addRouting) {
                        const existing = schema.routing.find(r => r.concept === entry.concept);
                        if (existing) {
                            existing.priority = entry.priority;
                        } else {
                            schema.routing.push(entry);
                        }
                    }
                    changes.push(`Added routing entries to ${descFile}`);
                }
                if (updates.removeRoutingConcepts) {
                    schema.routing = schema.routing?.filter(r => !updates.removeRoutingConcepts!.includes(r.concept));
                    changes.push(`Removed routing concepts from ${descFile}`);
                }

                // Add constraints
                if (updates.addConstraints) {
                    schema.constraints = schema.constraints || [];
                    for (const constraint of updates.addConstraints) {
                        const existing = schema.constraints.find(c => c.id === constraint.id);
                        if (existing) {
                            Object.assign(existing, constraint);
                            changes.push(`Updated constraint ${constraint.id} in ${descFile}`);
                        } else {
                            schema.constraints.push(constraint as DescriptionConstraint);
                            changes.push(`Added constraint ${constraint.id} to ${descFile}`);
                        }
                    }
                }

                // Remove constraints
                if (updates.removeConstraints) {
                    schema.constraints = schema.constraints?.filter(c => !updates.removeConstraints!.includes(c.id));
                    changes.push(`Removed constraints from ${descFile}: [${updates.removeConstraints.join(', ')}]`);
                }

                // Update existing constraints (most granular)
                if (updates.constraintUpdates) {
                    for (const [constraintId, constraintUpdate] of Object.entries(updates.constraintUpdates)) {
                        const constraint = schema.constraints?.find(c => c.id === constraintId);
                        if (!constraint) {
                            // Provide helpful suggestions
                            const suggestions = suggestConstraintIds(playbook, constraintId, descFile);
                            const availableIds = schema.constraints?.map(c => c.id) || [];
                            throw new Error(
                                `Constraint not found: "${constraintId}" in ${descFile}\n\n` +
                                `Available constraints in this file:\n${availableIds.map(id => `  - ${id}`).join('\n') || '  (none)'}\n\n` +
                                (suggestions.length > 0 
                                    ? `Did you mean one of these?\n${suggestions.map(s => `  - ${s}`).join('\n')}\n\n`
                                    : '') +
                                `Tip: Use list_playbook_constraints to discover constraint IDs.`
                            );
                        }

                        // Update constraint-level fields
                        if (constraintUpdate.message) constraint.message = constraintUpdate.message;
                        if (constraintUpdate.appliesTo) constraint.appliesTo = constraintUpdate.appliesTo as typeof constraint.appliesTo;
                        if (constraintUpdate.severity) constraint.severity = constraintUpdate.severity;
                        if (constraintUpdate.rationale) constraint.rationale = constraintUpdate.rationale;

                        // Add properties
                        if (constraintUpdate.addProperties) {
                            constraint.constraints = constraint.constraints || [];
                            for (const prop of constraintUpdate.addProperties) {
                                const existing = constraint.constraints.find(p => p.property === prop.property);
                                if (existing) {
                                    Object.assign(existing, prop);
                                } else {
                                    constraint.constraints.push(prop);
                                }
                            }
                            changes.push(`Added properties to constraint ${constraintId}`);
                        }

                        // Remove properties
                        if (constraintUpdate.removeProperties) {
                            constraint.constraints = constraint.constraints?.filter(
                                p => !constraintUpdate.removeProperties!.includes(p.property)
                            );
                            changes.push(`Removed properties from constraint ${constraintId}`);
                        }

                        // Update individual properties (most granular)
                        if (constraintUpdate.propertyUpdates) {
                            for (const [propName, propUpdate] of Object.entries(constraintUpdate.propertyUpdates)) {
                                const prop = constraint.constraints?.find(p => p.property === propName);
                                if (!prop) {
                                    throw new Error(`Property not found: ${propName} in constraint ${constraintId}`);
                                }

                                if (propUpdate.required !== undefined) prop.required = propUpdate.required;
                                if (propUpdate.targetMustBe !== undefined) {
                                    prop.targetMustBe = propUpdate.targetMustBe;
                                    delete prop.targetMustBeOneOf;
                                }
                                if (propUpdate.targetMustBeOneOf !== undefined) {
                                    prop.targetMustBeOneOf = propUpdate.targetMustBeOneOf;
                                    delete prop.targetMustBe;
                                }
                                if (propUpdate.targetMatchSubtypes !== undefined) prop.targetMatchSubtypes = propUpdate.targetMatchSubtypes;
                                if (propUpdate.minOccurrences !== undefined) prop.minOccurrences = propUpdate.minOccurrences;
                                if (propUpdate.maxOccurrences !== undefined) prop.maxOccurrences = propUpdate.maxOccurrences;
                                if (propUpdate.clearTargetMustBe) delete prop.targetMustBe;
                                if (propUpdate.clearTargetMustBeOneOf) delete prop.targetMustBeOneOf;

                                changes.push(`Updated ${propName} in constraint ${constraintId}`);
                            }
                        }
                    }
                }
            }
        }

        // ====================================================================
        // Instance Template Updates
        // ====================================================================
        if (params.addInstanceTemplates) {
            playbook.instanceTemplates = playbook.instanceTemplates || [];
            for (const template of params.addInstanceTemplates) {
                const existing = playbook.instanceTemplates.find(t => t.id === template.id);
                if (existing) {
                    Object.assign(existing, template);
                    changes.push(`Updated instance template: ${template.id}`);
                } else {
                    playbook.instanceTemplates.push(template);
                    changes.push(`Added instance template: ${template.id}`);
                }
            }
        }

        if (params.updateInstanceTemplate) {
            playbook.instanceTemplates = playbook.instanceTemplates || [];
            const template = playbook.instanceTemplates.find(t => t.id === params.updateInstanceTemplate!.id);
            if (!template) {
                throw new Error(`Instance template not found: ${params.updateInstanceTemplate.id}`);
            }

            if (params.updateInstanceTemplate.naming) {
                template.naming = params.updateInstanceTemplate.naming;
                changes.push(`Updated naming pattern for template ${template.id}`);
            }
            if (params.updateInstanceTemplate.description) {
                template.description = params.updateInstanceTemplate.description;
            }
            if (params.updateInstanceTemplate.propertyMappings) {
                template.propertyMappings = params.updateInstanceTemplate.propertyMappings;
                changes.push(`Replaced property mappings for template ${template.id}`);
            }
            if (params.updateInstanceTemplate.addPropertyMappings) {
                for (const mapping of params.updateInstanceTemplate.addPropertyMappings) {
                    const existing = template.propertyMappings.find(m => m.mapsFrom === mapping.mapsFrom);
                    if (existing) {
                        Object.assign(existing, mapping);
                    } else {
                        template.propertyMappings.push(mapping);
                    }
                }
                changes.push(`Added property mappings to template ${template.id}`);
            }
            if (params.updateInstanceTemplate.removePropertyMappings) {
                template.propertyMappings = template.propertyMappings.filter(
                    m => !params.updateInstanceTemplate!.removePropertyMappings!.includes(m.mapsFrom)
                );
                changes.push(`Removed property mappings from template ${template.id}`);
            }
        }

        if (params.removeInstanceTemplate) {
            const idx = playbook.instanceTemplates?.findIndex(t => t.id === params.removeInstanceTemplate);
            if (idx !== undefined && idx >= 0) {
                playbook.instanceTemplates!.splice(idx, 1);
                changes.push(`Removed instance template: ${params.removeInstanceTemplate}`);
            }
        }

        // ====================================================================
        // Save and Return
        // ====================================================================
        if (changes.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: `# No Changes Made\n\nNo update parameters were provided.`
                }]
            };
        }

        savePlaybookHelper(playbookPath, playbook);

        const changeList = changes.map(c => `- ${c}`).join('\n');
        return {
            content: [{
                type: 'text',
                text: `# Playbook Updated Successfully\n\n**File:** ${playbookPath}\n\n**Changes (${changes.length}):**\n${changeList}\n\n✅ Run \`enforce_methodology_rules\` to validate against the updated playbook.`
            }]
        };

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                type: 'text',
                text: `# Error Updating Playbook\n\n❌ ${message}`
            }]
        };
    }
}
