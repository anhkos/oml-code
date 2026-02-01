export type ToolLayer = 'core' | 'vocabulary' | 'description' | 'axiom' | 'methodology' | 'query' | 'utility';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ToolMetadata {
    id: string;
    displayName: string;
    layer: ToolLayer;
    severity: Severity;
    version: string;
    shortDescription: string;
    description: string;
    tags: string[];
    dependencies: string[];
    addedDate: string;
}

export type ToolRegistration = {
    tool: { name: string; description: string; paramsSchema: unknown };
    handler: (...args: any[]) => any;
    metadata?: ToolMetadata;
};
