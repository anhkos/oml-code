/**
 * Tool: extract_description_schemas
 * 
 * Analyzes existing OML description files and generates description schema
 * suggestions for the methodology playbook.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
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
import type { DescriptionSchema, DescriptionConstraint, MethodologyPlaybook } from './playbook-types.js';

export const extractDescriptionSchemasTool = {
    name: 'extract_description_schemas' as const,
    description: `Analyze OML description files and add description schemas to the methodology playbook.

USE THIS TOOL when the user wants to:
- "Add description schemas to my playbook"
- "Analyze my description files"
- "Update the methodology with description rules"
- "Set up description-level constraints"

⚠️ IMPORTANT: To actually UPDATE the playbook, set mergeIntoPlaybook: true
Without this flag, the tool only outputs suggestions without modifying any files.

RECOMMENDED CALL for adding schemas to playbook:
{
  "workspacePath": "/path/to/project",
  "mergeIntoPlaybook": true
}

The tool AUTO-DETECTS:
- Description files in the workspace (uses the Langium parser to identify OML descriptions)
- Existing methodology playbook (looks for *_playbook.yaml or methodology_playbook.yaml)

The tool will:
1. Find all description files
2. Analyze instance types in each file
3. Infer routing priorities (which file should contain which types)
4. Suggest constraints based on property patterns
5. If mergeIntoPlaybook=true: UPDATE the playbook file directly
6. If mergeIntoPlaybook=false: Output YAML for manual review`,
    
    paramsSchema: {
        workspacePath: z.string().optional().describe('Root path to search for description files and playbook. Auto-detects if not provided.'),
        playbookPath: z.string().optional().describe('Path to existing playbook to merge into. Auto-detects if not provided.'),
        descriptionPath: z.string().optional().describe('Path to a single description file (optional - auto-detects all)'),
        descriptionPaths: z.array(z.string()).optional().describe('Paths to specific description files (optional - auto-detects all)'),
        directoryPath: z.string().optional().describe('Path to directory containing description files (optional - auto-detects)'),
        includeConstraintSuggestions: z.boolean().optional().default(true).describe('Whether to suggest constraints based on patterns'),
        outputFormat: z.enum(['yaml', 'json']).optional().default('yaml').describe('Output format for the schema'),
        mergeIntoPlaybook: z.boolean().optional().default(false).describe('⚠️ SET TO TRUE to actually modify the playbook file. If false, only outputs suggestions.'),
    },
};

/**
 * Information extracted from a single description file.
 */
interface DescriptionAnalysis {
    filePath: string;
    fileName: string;
    /** Map of type name -> count of instances */
    typeCounts: Map<string, number>;
    /** Map of type -> properties used on that type */
    typeProperties: Map<string, Set<string>>;
    /** Map of property -> target types (for relations) */
    propertyTargets: Map<string, Set<string>>;
    /** Total instance count */
    totalInstances: number;
}

/**
 * Parse a description file and extract analysis data.
 */
async function analyzeDescription(filePath: string): Promise<DescriptionAnalysis> {
    const services = createOmlServices(NodeFileSystem).Oml;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const uri = URI.file(filePath);
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
    
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    
    const root = document.parseResult.value;
    if (!isDescription(root)) {
        throw new Error(`File is not a description: ${filePath}`);
    }
    
    const analysis: DescriptionAnalysis = {
        filePath,
        fileName: path.basename(filePath),
        typeCounts: new Map(),
        typeProperties: new Map(),
        propertyTargets: new Map(),
        totalInstances: 0,
    };
    
    const description = root as Description;
    
    for (const statement of description.ownedStatements || []) {
        if (isConceptInstance(statement)) {
            const instance = statement as ConceptInstance;
            analysis.totalInstances++;
            
            // Count types
            const types = instance.ownedTypes?.map(t => {
                const ref = t.type?.ref;
                return ref?.name || 'Unknown';
            }) || [];
            
            for (const type of types) {
                const qualifiedType = getQualifiedType(type, instance);
                analysis.typeCounts.set(
                    qualifiedType, 
                    (analysis.typeCounts.get(qualifiedType) || 0) + 1
                );
                
                // Track properties used on this type
                if (!analysis.typeProperties.has(qualifiedType)) {
                    analysis.typeProperties.set(qualifiedType, new Set());
                }
                
                for (const pva of instance.ownedPropertyValues || []) {
                    let propName = 'unknown';
                    if (pva.property?.ref?.name) {
                        propName = pva.property.ref.name;
                    } else if (pva.property?.$refText) {
                        propName = pva.property.$refText;
                    }
                    
                    analysis.typeProperties.get(qualifiedType)!.add(propName);
                    
                    // Track property targets for relations
                    if (!analysis.propertyTargets.has(propName)) {
                        analysis.propertyTargets.set(propName, new Set());
                    }
                    
                    for (const val of (pva as any).ownedValues || []) {
                        if ('value' in val && val.value?.ref) {
                            const targetRef = val.value.ref as any;
                            if (targetRef.ownedTypes) {
                                for (const targetType of targetRef.ownedTypes) {
                                    if (targetType.type?.ref?.name) {
                                        analysis.propertyTargets.get(propName)!.add(targetType.type.ref.name);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if (isRelationInstance(statement)) {
            const instance = statement as RelationInstance;
            analysis.totalInstances++;
            
            const types = instance.ownedTypes?.map(t => {
                const ref = t.type?.ref;
                return ref?.name || 'Unknown';
            }) || [];
            
            for (const type of types) {
                const qualifiedType = getQualifiedType(type, instance);
                analysis.typeCounts.set(
                    qualifiedType, 
                    (analysis.typeCounts.get(qualifiedType) || 0) + 1
                );
            }
        }
    }
    
    return analysis;
}

/**
 * Try to get a qualified type name (prefix:Name) from context.
 */
function getQualifiedType(typeName: string, instance: any): string {
    // If already qualified, return as-is
    if (typeName.includes(':')) {
        return typeName;
    }
    
    // Try to infer from the instance's type reference
    const typeRef = instance.ownedTypes?.[0]?.type;
    if (typeRef?.$refText?.includes(':')) {
        return typeRef.$refText;
    }
    
    return typeName;
}

/**
 * Generate a description schema from analysis results.
 */
function generateSchema(
    analysis: DescriptionAnalysis,
    includeConstraints: boolean
): DescriptionSchema {
    // Sort types by count (most frequent first) for routing
    const sortedTypes = [...analysis.typeCounts.entries()]
        .sort((a, b) => b[1] - a[1]);
    
    const allowedTypes = sortedTypes.map(([type]) => type);
    
    // Generate routing based on counts
    const routing = sortedTypes.map(([concept, count], index) => ({
        concept,
        priority: index + 1,  // 1 = most frequent
    }));
    
    // Infer purpose from filename
    const purpose = inferPurpose(analysis.fileName, allowedTypes);
    
    // Generate constraint suggestions
    const constraints: DescriptionConstraint[] = [];
    
    if (includeConstraints) {
        // Suggest required properties based on usage patterns
        for (const [type, properties] of analysis.typeProperties) {
            for (const prop of properties) {
                // If a property is used on most instances of this type, suggest it as required
                // This is a heuristic - actual usage frequency would need more analysis
                constraints.push({
                    id: `${sanitizeId(type)}-has-${sanitizeId(prop)}`,
                    message: `${type} instances typically have ${prop}`,
                    appliesTo: { conceptType: type },
                    constraints: [{
                        property: prop,
                        required: false,  // Suggestion only, not enforced
                    }],
                    severity: 'info',
                    rationale: `Observed on instances in ${analysis.fileName}`,
                });
            }
        }
        
        // Suggest target type constraints for relations
        for (const [prop, targets] of analysis.propertyTargets) {
            if (targets.size > 0 && targets.size <= 3) {
                // If property targets a small set of types, suggest constraint
                const targetList = [...targets];
                
                for (const [type] of sortedTypes) {
                    if (analysis.typeProperties.get(type)?.has(prop)) {
                        constraints.push({
                            id: `${sanitizeId(type)}-${sanitizeId(prop)}-targets`,
                            message: `${prop} on ${type} should target ${targetList.join(' or ')}`,
                            appliesTo: { conceptType: type },
                            constraints: [{
                                property: prop,
                                targetMustBeOneOf: targetList,
                            }],
                            severity: 'info',
                            rationale: `Inferred from existing instances`,
                        });
                    }
                }
            }
        }
    }
    
    return {
        file: analysis.fileName,
        purpose,
        allowedTypes,
        routing,
        constraints,
    };
}

/**
 * Infer purpose from filename and types.
 */
function inferPurpose(fileName: string, types: string[]): string {
    const baseName = fileName.replace('.oml', '').replace(/_/g, ' ');
    
    if (types.length === 0) {
        return `Description file: ${baseName}`;
    }
    
    const primaryType = types[0].split(':').pop() || types[0];
    return `${baseName} - primarily contains ${primaryType} instances`;
}

/**
 * Check if an OML file is a description using the Langium parser.
 */
async function isDescriptionFile(filePath: string): Promise<boolean> {
    try {
        const services = createOmlServices(NodeFileSystem).Oml;
        const content = fs.readFileSync(filePath, 'utf-8');
        const uri = URI.file(filePath);
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);
        await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
        return isDescription(document.parseResult.value);
    } catch {
        return false;
    }
}

/**
 * Find all .oml description files in a directory.
 */
async function findDescriptionFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
            // Skip build and node_modules directories
            if (entry.name === 'build' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
                continue;
            }
            // Recurse into subdirectories
            files.push(...await findDescriptionFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.oml')) {
            // Check if it's a description using the parser
            if (await isDescriptionFile(fullPath)) {
                files.push(fullPath);
            }
        }
    }
    
    return files;
}



/**
 * Find a methodology playbook in the given directory (recursive).
 */
function findPlaybook(dirPath: string): string | null {
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        // Check for playbook files in current directory
        for (const entry of entries) {
            if (entry.isFile() && (
                entry.name.endsWith('_playbook.yaml') || 
                entry.name === 'methodology_playbook.yaml' ||
                entry.name.endsWith('_playbook.yml') ||
                entry.name.endsWith('_playbook.json')
            )) {
                return path.join(dirPath, entry.name);
            }
        }
        
        // Recurse into subdirectories
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                const found = findPlaybook(path.join(dirPath, entry.name));
                if (found) return found;
            }
        }
    } catch {
        // Skip directories we can't read
    }
    return null;
}

/**
 * Sanitize a string for use as an ID.
 */
function sanitizeId(str: string): string {
    return str
        .replace(/:/g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .toLowerCase();
}

/**
 * Format schemas as YAML.
 */
function formatAsYaml(schemas: Record<string, DescriptionSchema>): string {
    const output = {
        descriptions: schemas,
    };
    
    return yaml.dump(output, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
    });
}

/**
 * Format schemas as JSON.
 */
function formatAsJson(schemas: Record<string, DescriptionSchema>): string {
    return JSON.stringify({ descriptions: schemas }, null, 2);
}

/**
 * Find description directories - looks for directories containing .oml description files.
 */
async function findDescriptionDirectories(dirPath: string, maxDepth: number = 5, currentDepth: number = 0): Promise<string[]> {
    const result: string[] = [];
    
    if (currentDepth > maxDepth) return result;
    
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        let hasDescriptions = false;
        
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.oml')) {
                const fullPath = path.join(dirPath, entry.name);
                if (await isDescriptionFile(fullPath)) {
                    hasDescriptions = true;
                    break;
                }
            }
        }
        
        if (hasDescriptions) {
            result.push(dirPath);
        }
        
        // Recurse into subdirectories
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'build') {
                result.push(...await findDescriptionDirectories(path.join(dirPath, entry.name), maxDepth, currentDepth + 1));
            }
        }
    } catch {
        // Skip directories we can't read
    }
    
    return result;
}

/**
 * Merge new schemas into an existing playbook file.
 */
function mergeIntoPlaybook(playbookPath: string, newSchemas: Record<string, DescriptionSchema>): string {
    const content = fs.readFileSync(playbookPath, 'utf-8');
    const playbook = yaml.load(content) as MethodologyPlaybook;
    
    // Initialize descriptions if not present
    if (!playbook.descriptions) {
        playbook.descriptions = {};
    }
    
    // Merge new schemas (overwrite existing entries for same files)
    for (const [fileName, schema] of Object.entries(newSchemas)) {
        playbook.descriptions[fileName] = schema;
    }
    
    // Write back
    const updatedContent = yaml.dump(playbook, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
    });
    
    fs.writeFileSync(playbookPath, updatedContent, 'utf-8');
    
    return updatedContent;
}

export const extractDescriptionSchemasHandler = async (params: {
    workspacePath?: string;
    playbookPath?: string;
    descriptionPath?: string;
    descriptionPaths?: string[];
    directoryPath?: string;
    includeConstraintSuggestions?: boolean;
    outputFormat?: 'yaml' | 'json';
    mergeIntoPlaybook?: boolean;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> => {
    try {
        const { 
            includeConstraintSuggestions = true, 
            outputFormat = 'yaml',
            mergeIntoPlaybook: shouldMerge = false,
        } = params;
        
        let workspacePath = params.workspacePath;
        let playbookPath: string | undefined = params.playbookPath;
        
        // Auto-detect workspace from CWD if not provided
        if (!workspacePath) {
            workspacePath = process.cwd();
        }
        
        // Auto-detect playbook if not provided
        if (!playbookPath && workspacePath) {
            playbookPath = findPlaybook(workspacePath) ?? undefined;
        }
        
        // Collect all files to analyze
        let filesToAnalyze: string[] = [];
        
        if (params.descriptionPath) {
            filesToAnalyze.push(params.descriptionPath);
        }
        
        if (params.descriptionPaths) {
            filesToAnalyze.push(...params.descriptionPaths);
        }
        
        if (params.directoryPath) {
            const dirFiles = await findDescriptionFiles(params.directoryPath);
            filesToAnalyze.push(...dirFiles);
        }
        
        // If no explicit paths, auto-detect from workspace
        if (filesToAnalyze.length === 0 && workspacePath) {
            // Find all directories containing description files
            const descDirs = await findDescriptionDirectories(workspacePath);
            
            for (const dir of descDirs) {
                filesToAnalyze.push(...await findDescriptionFiles(dir));
            }
        }
        
        if (filesToAnalyze.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: `**Error:** No description files found.

**Searched in:** ${workspacePath || 'current directory'}

**Tips:**
- Provide \`workspacePath\` pointing to your OML project root
- Or provide \`directoryPath\` to a specific folder with .oml files
- Or provide \`descriptionPath\` for a single file

Description files are OML ontologies declared with \`description <IRI> as <prefix> {...}\`.`,
                }],
                isError: true,
            };
        }
        
        // Remove duplicates
        filesToAnalyze = [...new Set(filesToAnalyze)];
        
        // Analyze each file
        const analyses: DescriptionAnalysis[] = [];
        const errors: string[] = [];
        
        for (const filePath of filesToAnalyze) {
            try {
                const analysis = await analyzeDescription(filePath);
                analyses.push(analysis);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push(`${filePath}: ${msg}`);
            }
        }
        
        if (analyses.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: `**Error:** Could not analyze any files.\n\nErrors:\n${errors.map(e => `- ${e}`).join('\n')}`,
                }],
                isError: true,
            };
        }
        
        // Generate schemas
        const schemas: Record<string, DescriptionSchema> = {};
        
        for (const analysis of analyses) {
            const schema = generateSchema(analysis, includeConstraintSuggestions);
            schemas[analysis.fileName] = schema;
        }
        
        // Handle merge into playbook
        let mergeMessage = '';
        if (shouldMerge && playbookPath) {
            try {
                mergeIntoPlaybook(playbookPath, schemas);
                mergeMessage = `\n\n✅ **Merged into playbook:** ${playbookPath}`;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                mergeMessage = `\n\n⚠️ **Could not merge into playbook:** ${msg}`;
            }
        }
        
        // Format output
        const formatted = outputFormat === 'yaml' 
            ? formatAsYaml(schemas) 
            : formatAsJson(schemas);
        
        // Build summary
        const summaryLines: string[] = [
            `# Description Schema Extraction Results`,
            ``,
            `**Workspace:** ${workspacePath}`,
            playbookPath ? `**Playbook found:** ${playbookPath}` : `**No playbook found** - consider creating one`,
            ``,
            `Analyzed **${analyses.length}** description file(s):`,
            ``,
        ];
        
        for (const analysis of analyses) {
            summaryLines.push(`## ${analysis.fileName}`);
            summaryLines.push(`- **Path:** ${analysis.filePath}`);
            summaryLines.push(`- **Instances:** ${analysis.totalInstances}`);
            summaryLines.push(`- **Types found:** ${[...analysis.typeCounts.keys()].join(', ') || 'none'}`);
            summaryLines.push(``);
        }
        
        if (errors.length > 0) {
            summaryLines.push(`## Warnings`);
            for (const err of errors) {
                summaryLines.push(`- ${err}`);
            }
            summaryLines.push(``);
        }
        
        summaryLines.push(`## Generated Schema (${outputFormat.toUpperCase()})`);
        summaryLines.push(`\`\`\`${outputFormat}`);
        summaryLines.push(formatted);
        summaryLines.push(`\`\`\``);
        summaryLines.push(mergeMessage);
        summaryLines.push(``);
        
        if (!shouldMerge && playbookPath) {
            summaryLines.push(`> **Tip:** Call again with \`mergeIntoPlaybook: true\` to automatically add these schemas to your playbook.`);
        }
        
        summaryLines.push(`> Review and customize these schemas as needed.`);
        
        return {
            content: [{
                type: 'text',
                text: summaryLines.join('\n'),
            }],
        };
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                type: 'text',
                text: `**Error extracting description schemas:**\n\n${errorMsg}`,
            }],
            isError: true,
        };
    }
};
