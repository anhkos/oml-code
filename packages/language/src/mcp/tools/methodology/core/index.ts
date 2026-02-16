/**
 * Methodology Core Modules
 * 
 * Centralized exports for all methodology subsystem core logic.
 * These modules contain reusable business logic extracted from tools.
 */

// Constraint Engine: Rule matching and constraint validation
export {
    Specificity,
    type RuleMatchResult,
    getRelationRules,
    validatePropertyConstraint,
    isTypeAllowed,
    ruleMatchesDirection,
    getPreferredDirection,
    isForwardDirection,
    isReverseDirection,
    matchesAppliesTo,
    getApplicableDescriptionRules,
    validateDescriptionPropertyConstraint,
} from './constraint-engine.js';

// Playbook Loader: File I/O and playbook discovery
export {
    findPlaybook,
    findPlaybookFromDescription,
    resolvePlaybookPath,
    loadPlaybook,
    savePlaybook,
    getPlaybookCacheInfo,
    invalidatePlaybookCache,
    isDescriptionFile,
    findDescriptionFiles,
    detectPlaybookPath,
} from './playbook-loader.js';

// Schema Analyzer: Description schema extraction
export {
    type DescriptionAnalysis,
    generateDescriptionSchema,
    inferPurpose,
    detectNamingPatterns,
    createInstanceTemplate,
    sanitizeId,
    mergeSchemas,
    validateDescriptionSchema,
} from './schema-analyzer.js';

// Re-export commonly used types from playbook-types
export type {
    MethodologyPlaybook,
    PlaybookMetadata,
    DescriptionSchema,
    InstanceTemplate,
    NamingPattern,
    RelationRule,
    ConceptRule,
    PropertyConstraint,
    DescriptionConstraint,
    AppliesTo,
    PendingDecision,
    PlaybookValidationResult,
    PlaybookViolation,
    PlaybookCorrection,
} from '../playbook-types.js';
