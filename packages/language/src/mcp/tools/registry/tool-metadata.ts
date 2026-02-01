/**
 * Tool Metadata Types and Definitions
 * 
 * Defines the standard metadata structure that all tools must export.
 * Enables auto-registration, discovery, and layer-based organization.
 */

/**
 * OML Modeling Layer - Tools are organized by which layer they operate on
 */
export type ModelingLayer = 
    | 'core'            // Core tools for validation, querying, analysis
    | 'vocabulary'      // Tools for creating/modifying types (concepts, relations, scalars)
    | 'description'     // Tools for creating/modifying instances
    | 'axiom'           // Tools for managing axioms (specialization, restriction, etc.)
    | 'methodology'     // Tools for enforcing rules and guidelines
    | 'query'           // Tools for searching/analyzing
    | 'utility';        // Utility tools applicable to multiple layers

/**
 * Tool severity - indicates how critical the tool is
 */
export type ToolSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Base metadata all tools must provide
 */
export interface ToolMetadata {
    /**
     * Unique tool identifier (snake_case)
     * Example: 'create_concept', 'enforce_methodology_rules'
     */
    id: string;

    /**
     * Human-readable tool name
     * Example: 'Create Concept', 'Enforce Methodology Rules'
     */
    displayName: string;

    /**
     * Which modeling layer does this tool operate on?
     */
    layer: ModelingLayer;

    /**
     * How critical is this tool?
     */
    severity: ToolSeverity;

    /**
     * Tool version (semantic versioning)
     */
    version: string;

    /**
     * Short one-line description
     */
    shortDescription: string;

    /**
     * Full description (can be multi-line markdown)
     */
    description: string;

    /**
     * Optional tags for categorization
     * Example: ['instance-creation', 'validation', 'ai-friendly']
     */
    tags?: string[];

    /**
     * Other tools this tool depends on
     * Example: ['create_concept_instance'] - if another tool must run first
     */
    dependencies?: string[];

    /**
     * Is this tool available in the current context?
     */
    isAvailable?: boolean;

    /**
     * When was this tool added? (ISO date string)
     */
    addedDate?: string;

    /**
     * Is this tool experimental or unstable?
     */
    isExperimental?: boolean;
}

/**
 * Tool implementation - the actual tool object exported by a tool module
 */
export interface Tool {
    /**
     * Tool name (should match metadata.id)
     */
    name: string;

    /**
     * Tool description
     */
    description: string;

    /**
     * Tool input schema (typically Zod schema)
     */
    paramsSchema?: Record<string, unknown>;

    /**
     * Tool execute function
     */
    execute?: (params: unknown) => Promise<unknown>;

    /**
     * Optional: Tool metadata for registry
     * If not provided, will be inferred from tool properties
     */
    metadata?: ToolMetadata;
}

/**
 * Tool package - groups related tools together
 * Example: All instance-related tools (create, update, delete)
 */
export interface ToolPackage {
    name: string;
    description: string;
    version: string;
    tools: Tool[];
    layer: ModelingLayer;
}

/**
 * Tool registry entry - what gets stored in the registry
 */
export interface ToolRegistryEntry {
    tool: Tool;
    metadata: ToolMetadata;
    modulePath: string;
    loadedAt?: Date;
    lastUsed?: Date;
    usageCount?: number;
}

/**
 * Tool query options for filtering
 */
export interface ToolQueryOptions {
    layer?: ModelingLayer | ModelingLayer[];
    severity?: ToolSeverity | ToolSeverity[];
    tags?: string[];
    available?: boolean;
    experimental?: boolean;
}
