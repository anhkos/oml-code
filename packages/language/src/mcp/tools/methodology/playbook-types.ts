/**
 * Type definitions for Sierra Methodology Playbook
 * 
 * A Playbook captures the modeling conventions and rules extracted from OML vocabularies.
 * It provides guidance for:
 * - Which direction to assert bidirectional relations
 * - Required properties for concepts
 * - Instance containment/placement rules
 * - Cardinality guidance
 */

export interface PlaybookMetadata {
    /** Name of the methodology (e.g., "Sierra") */
    methodology: string;
    /** Version of the playbook */
    version: string;
    /** When the playbook was generated */
    generatedAt: string;
    /** Source vocabulary files used */
    sourceVocabularies: string[];
}

/**
 * Rule for bidirectional relations.
 * Specifies which end "owns" the assertion in descriptions.
 */
export interface RelationRule {
    /** The forward relation name (e.g., "requirement:expresses") */
    forwardRelation: string;
    /** The reverse relation name (e.g., "requirement:isExpressedBy") */
    reverseRelation: string;
    /** The concept that should own/contain the assertion */
    owningConcept: string;
    /** Which direction to use: "forward" or "reverse" */
    preferredDirection: 'forward' | 'reverse';
    /** Human-readable explanation of the rule */
    rationale?: string;
    /** Source vocabulary file where this relation is defined */
    sourceFile?: string;
}

/**
 * Rule for relation entities (reified relations).
 * These create instances of the relation itself.
 */
export interface RelationEntityRule {
    /** The relation entity name (e.g., "process:DataFlow") */
    relationEntity: string;
    /** The forward relation name (e.g., "flowsTo") */
    forwardRelation: string;
    /** The reverse relation name (e.g., "flowsFrom") */
    reverseRelation: string;
    /** The source concept type */
    fromConcept: string;
    /** The target concept type */
    toConcept: string;
    /** Preferred modeling direction */
    preferredDirection: 'forward' | 'reverse';
    /** Human-readable explanation */
    rationale?: string;
    /** Source vocabulary file */
    sourceFile?: string;
}

/**
 * Rules for concept instantiation.
 */
export interface ConceptRule {
    /** Fully qualified concept name (e.g., "requirement:Requirement") */
    concept: string;
    /** Properties that should always be set */
    requiredProperties?: string[];
    /** Properties that are recommended */
    recommendedProperties?: string[];
    /** Description file pattern where instances should live */
    descriptionFilePattern?: string;
    /** Parent container concept (for containment hierarchy) */
    containerConcept?: string;
    /** Human-readable notes */
    notes?: string;
}

/**
 * Containment rules from base:Container/base:Contained patterns.
 */
export interface ContainmentRule {
    /** The container concept (e.g., "state:StateMachine") */
    container: string;
    /** The contained concept(s) (e.g., ["state:State"]) */
    contained: string[];
    /** The relation used (e.g., "base:contains") */
    relation: string;
    /** Any cardinality restrictions */
    cardinality?: {
        min?: number;
        max?: number;
        exactly?: number;
    };
    /** Source vocabulary file */
    sourceFile?: string;
}

/**
 * Allocation/assignment rules (e.g., Activity isAllocatedTo Entity).
 */
export interface AllocationRule {
    /** What is being allocated (e.g., "process:Activity") */
    subject: string;
    /** What it's allocated to (e.g., "entity:Entity") */
    target: string;
    /** The allocation relation */
    relation: string;
    /** The reverse relation */
    reverseRelation: string;
    /** Which side owns the assertion */
    owningConcept: string;
    /** Preferred direction */
    preferredDirection: 'forward' | 'reverse';
    /** Human-readable rationale */
    rationale?: string;
}

/**
 * Pending decision that requires user input.
 */
export interface PendingDecision {
    /** Type of decision needed */
    type: 'relation_direction' | 'containment' | 'required_property';
    /** The relation or concept in question */
    subject: string;
    /** Options to choose from */
    options: {
        id: string;
        label: string;
        description: string;
    }[];
    /** Context/explanation for the user */
    context: string;
    /** Default suggestion if any */
    suggestedDefault?: string;
}

/**
 * Determines which instances a rule applies to.
 * Supports multiple matching strategies with explicit precedence.
 */
export interface AppliesTo {
    /** Exact concept type (e.g., "requirement:SafetyRequirement") */
    conceptType?: string;
    
    /** Include all subtypes? Default: false */
    matchSubtypes?: boolean;
    
    /** Pattern matching (e.g., "*Requirement" matches all types ending in "Requirement") */
    conceptPattern?: string;
    
    /** Match any of these types */
    conceptTypes?: string[];
    
    /** Match any subtype of this base type */
    anySubtypeOf?: string;
}

/**
 * Naming pattern for auto-generating instance names.
 */
export interface NamingPattern {
    /** Prefix for the name (e.g., "R" for R1, R2, ...) */
    prefix: string;
    
    /** Counter style: 'number' (1,2,3), 'padded' (001,002), 'alpha' (A,B,C) */
    counterStyle?: 'number' | 'padded' | 'alpha';
    
    /** Padding width for 'padded' style (default: 3) */
    paddingWidth?: number;
    
    /** Starting number (default: 1) */
    startFrom?: number;
    
    /** Optional suffix (e.g., "_req" for R1_req) */
    suffix?: string;
}

/**
 * Property mapping for auto-populating instance properties.
 * Maps user-provided semantic fields to OML properties.
 */
export interface PropertyMapping {
    /** OML property name (e.g., "base:description") */
    property: string;
    
    /** Semantic field name that user provides (e.g., "name", "text", "target") */
    mapsFrom: string;
    
    /** Is this a literal (scalar) or reference (relation)? */
    valueType: 'literal' | 'reference';
    
    /** For literals: the scalar type (default: string/quoted) */
    literalType?: 'quoted' | 'integer' | 'decimal' | 'double' | 'boolean';
    
    /** Is this mapping required? */
    required?: boolean;
    
    /** Human-readable description of what this field means */
    description?: string;
    
    /** Default value if not provided */
    defaultValue?: string;
}

/**
 * Template for creating instances of a specific type.
 * Defines naming conventions and property mappings.
 */
export interface InstanceTemplate {
    /** Unique identifier for this template */
    id: string;
    
    /** What concept type(s) this template applies to */
    appliesTo: AppliesTo;
    
    /** Naming pattern for auto-generating instance names */
    naming?: NamingPattern;
    
    /** Property mappings from semantic fields to OML properties */
    propertyMappings: PropertyMapping[];
    
    /** Human-readable description of this template */
    description?: string;
    
    /** Example usage */
    example?: {
        input: Record<string, string>;
        output: string;
    };
}

/**
 * Defines a constraint on a property.
 */
export interface PropertyConstraint {
    /** Property name (e.g., "isExpressedBy", "description") */
    property: string;
    
    /** Target must be this type */
    targetMustBe?: string;
    
    /** Allow subtypes of target? Default: false */
    targetMatchSubtypes?: boolean;
    
    /** Target must be one of these types */
    targetMustBeOneOf?: string[];
    
    /** Property must exist (for required properties) */
    required?: boolean;
    
    /** Minimum occurrences */
    minOccurrences?: number;
    
    /** Maximum occurrences */
    maxOccurrences?: number;
}

/**
 * A constraint rule for a description.
 * Rules are matched by precedence (most specific first).
 */
export interface DescriptionConstraint {
    /** Unique identifier for this rule */
    id: string;
    
    /** Human-readable message */
    message: string;
    
    /** What instances does this apply to? */
    appliesTo: AppliesTo;
    
    /** What constraint(s) to enforce? */
    constraints: PropertyConstraint[];
    
    /** Severity level */
    severity?: 'error' | 'warning' | 'info';
    
    /** Rationale for this rule */
    rationale?: string;
}

/**
 * Schema for a single description file.
 * Defines what types are allowed and what constraints apply.
 */
export interface DescriptionSchema {
    /** File path or name */
    file: string;
    
    /** Human-readable purpose */
    purpose: string;
    
    /** Allowed instance types in this description */
    allowedTypes: string[];
    
    /** Routing priorities for LLM placement */
    routing: Array<{
        concept: string;
        priority: number;  // 1 = primary, higher = lower priority
    }>;
    
    /** Constraints specific to this description */
    constraints: DescriptionConstraint[];
}

/**
 * The complete Playbook structure.
 */
export interface MethodologyPlaybook {
    /** Playbook metadata */
    metadata: PlaybookMetadata;
    
    /** Rules for standard bidirectional relations */
    relationRules: RelationRule[];
    
    /** Rules for relation entities (reified relations) */
    relationEntityRules: RelationEntityRule[];
    
    /** Rules for concept instantiation */
    conceptRules: ConceptRule[];
    
    /** Containment hierarchy rules */
    containmentRules: ContainmentRule[];
    
    /** Allocation/assignment rules */
    allocationRules: AllocationRule[];
    
    /** Description-level schemas (NEW) */
    descriptions?: Record<string, DescriptionSchema>;
    
    /** Instance templates for naming and property mappings */
    instanceTemplates?: InstanceTemplate[];
}

/**
 * Result of playbook extraction with pending decisions.
 */
export interface PlaybookExtractionResult {
    /** Partially completed playbook */
    playbook: MethodologyPlaybook;
    /** Decisions that need user input */
    pendingDecisions: PendingDecision[];
    /** Whether extraction is complete */
    isComplete: boolean;
}

/**
 * User's decision response.
 */
export interface DecisionResponse {
    /** The subject (relation/concept) being decided */
    subject: string;
    /** The chosen option ID */
    chosenOption: string;
    /** Optional rationale provided by user */
    rationale?: string;
}

/**
 * Validation result when enforcing playbook rules.
 */
export interface PlaybookValidationResult {
    /** Whether the description is valid according to playbook */
    isValid: boolean;
    /** Violations found */
    violations: PlaybookViolation[];
    /** Suggested corrections */
    corrections: PlaybookCorrection[];
}

/**
 * A single playbook rule violation.
 */
export interface PlaybookViolation {
    /** Type of violation */
    type: 'wrong_direction' | 'missing_property' | 'wrong_container' | 'invalid_cardinality' | 'invalid_target_type' | 'type_not_allowed';
    /** Location in the OML file */
    location?: {
        file: string;
        line?: number;
        instance?: string;
    };
    /** The rule that was violated */
    rule: string;
    /** Human-readable message */
    message: string;
    /** Severity level */
    severity: 'error' | 'warning' | 'info';
}

/**
 * A suggested correction for a violation.
 */
export interface PlaybookCorrection {
    /** The violation this corrects */
    violationType: string;
    /** What to remove (if applicable) */
    remove?: {
        instance: string;
        property: string;
        value: string;
    };
    /** What to add (if applicable) */
    add?: {
        instance: string;
        property: string;
        value: string;
    };
    /** Human-readable explanation */
    explanation: string;
    /** The corrected OML code snippet */
    correctedCode?: string;
}
