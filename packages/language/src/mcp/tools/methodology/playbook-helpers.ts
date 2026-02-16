/**
 * Shared helper functions for methodology playbook tools.
 * These make tools more AI-friendly by auto-detecting paths and providing discovery utilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveWorkspacePath } from '../common.js';
import { loadPlaybook as loadPlaybookCached, savePlaybook as savePlaybookCached } from './core/index.js';
import type { MethodologyPlaybook, DescriptionSchema, DescriptionConstraint } from './playbook-types.js';

// ============================================================================
// Playbook Auto-Detection
// ============================================================================

/**
 * Find a methodology playbook in the given directory (recursive).
 * Searches for files matching *_playbook.yaml or methodology_playbook.yaml
 */
export function findPlaybook(dirPath: string, maxDepth: number = 10, currentDepth: number = 0): string | null {
    if (currentDepth > maxDepth) return null;
    
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        // Check for playbook files in current directory first
        for (const entry of entries) {
            if (entry.isFile() && (
                entry.name.endsWith('_playbook.yaml') || 
                entry.name === 'methodology_playbook.yaml' ||
                entry.name.endsWith('_playbook.yml')
            )) {
                return path.join(dirPath, entry.name);
            }
        }
        
        // Recurse into subdirectories
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                const found = findPlaybook(path.join(dirPath, entry.name), maxDepth, currentDepth + 1);
                if (found) return found;
            }
        }
    } catch {
        // Skip directories we can't read
    }
    return null;
}

/**
 * Find playbook starting from a description file path, searching upward.
 */
export function findPlaybookFromDescription(descriptionPath: string): string | null {
    const resolvedPath = resolveWorkspacePath(descriptionPath);
    let currentDir = path.dirname(resolvedPath);
    
    // Walk up to 10 levels looking for a playbook
    for (let i = 0; i < 10; i++) {
        const found = findPlaybook(currentDir, 3); // Shallow search at each level
        if (found) return found;
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break; // Reached root
        currentDir = parentDir;
    }
    
    return null;
}

/**
 * Auto-detect or validate playbook path.
 * Returns resolved path or throws helpful error.
 */
export function resolvePlaybookPath(params: {
    playbookPath?: string;
    descriptionPath?: string;
    workspacePath?: string;
}): string {
    // If explicit path provided, validate it
    if (params.playbookPath) {
        const resolved = resolveWorkspacePath(params.playbookPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Playbook not found at: ${resolved}\nTip: Omit playbookPath to auto-detect.`);
        }
        return resolved;
    }
    
    // Auto-detect from description file
    if (params.descriptionPath) {
        const found = findPlaybookFromDescription(params.descriptionPath);
        if (found) return found;
    }
    
    // Auto-detect from workspace
    if (params.workspacePath) {
        const found = findPlaybook(resolveWorkspacePath(params.workspacePath));
        if (found) return found;
    }
    
    // Try current working directory
    const cwd = process.cwd();
    const found = findPlaybook(cwd);
    if (found) return found;
    
    throw new Error(
        'Could not find methodology playbook.\n' +
        'Options:\n' +
        '  1. Provide playbookPath explicitly\n' +
        '  2. Ensure a *_playbook.yaml file exists in the workspace\n' +
        '  3. Provide workspacePath to search from'
    );
}

// ============================================================================
// Playbook Loading & Parsing
// ============================================================================

/**
 * Load and parse a playbook YAML file.
 */
export function loadPlaybook(playbookPath: string): MethodologyPlaybook {
    const resolvedPath = resolveWorkspacePath(playbookPath);
    
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Playbook not found: ${resolvedPath}`);
    }

    return loadPlaybookCached(resolvedPath);
}

/**
 * Save playbook to YAML file.
 */
export function savePlaybook(playbookPath: string, playbook: MethodologyPlaybook): void {
    const resolvedPath = resolveWorkspacePath(playbookPath);

    savePlaybookCached(resolvedPath, playbook);
}

// ============================================================================
// Constraint Discovery
// ============================================================================

export interface ConstraintInfo {
    id: string;
    message: string;
    descriptionFile: string;
    appliesTo: string;
    severity: string;
    properties: string[];
}

/**
 * List all constraints in a playbook, optionally filtered by description file.
 */
export function listConstraints(
    playbook: MethodologyPlaybook,
    options?: {
        descriptionFile?: string;
        propertyFilter?: string;
    }
): ConstraintInfo[] {
    const results: ConstraintInfo[] = [];
    
    if (!playbook.descriptions) return results;
    
    for (const [descFile, schema] of Object.entries(playbook.descriptions)) {
        // Filter by description file if specified
        if (options?.descriptionFile && !descFile.includes(options.descriptionFile)) {
            continue;
        }
        
        if (!schema.constraints) continue;
        
        for (const constraint of schema.constraints) {
            // Filter by property if specified
            if (options?.propertyFilter) {
                const hasProperty = constraint.constraints?.some(
                    c => c.property.includes(options.propertyFilter!)
                );
                if (!hasProperty) continue;
            }
            
            results.push({
                id: constraint.id,
                message: constraint.message,
                descriptionFile: descFile,
                appliesTo: formatAppliesTo(constraint.appliesTo),
                severity: constraint.severity || 'info',
                properties: constraint.constraints?.map(c => c.property) || [],
            });
        }
    }
    
    return results;
}

function formatAppliesTo(appliesTo: DescriptionConstraint['appliesTo']): string {
    if (!appliesTo) return 'all instances';
    if (appliesTo.conceptType) return appliesTo.conceptType;
    if (appliesTo.conceptPattern) return `pattern: ${appliesTo.conceptPattern}`;
    if (appliesTo.conceptTypes) return appliesTo.conceptTypes.join(' | ');
    if (appliesTo.anySubtypeOf) return `subtypes of ${appliesTo.anySubtypeOf}`;
    return 'all instances';
}

/**
 * Find a constraint by ID, with fuzzy matching for similar IDs.
 */
export function findConstraint(
    playbook: MethodologyPlaybook,
    constraintId: string,
    descriptionFile?: string
): { constraint: DescriptionConstraint; descFile: string; schema: DescriptionSchema } | null {
    if (!playbook.descriptions) return null;
    
    // Try exact match first
    for (const [descFile, schema] of Object.entries(playbook.descriptions)) {
        if (descriptionFile && !descFile.includes(descriptionFile)) continue;
        
        const constraint = schema.constraints?.find(c => c.id === constraintId);
        if (constraint) {
            return { constraint, descFile, schema };
        }
    }
    
    // Try partial match (constraint ID contains the search term)
    for (const [descFile, schema] of Object.entries(playbook.descriptions)) {
        if (descriptionFile && !descFile.includes(descriptionFile)) continue;
        
        const constraint = schema.constraints?.find(c => 
            c.id.includes(constraintId) || constraintId.includes(c.id)
        );
        if (constraint) {
            return { constraint, descFile, schema };
        }
    }
    
    return null;
}

/**
 * Get suggestions for a constraint ID that wasn't found.
 */
export function suggestConstraintIds(
    playbook: MethodologyPlaybook,
    searchTerm: string,
    descriptionFile?: string
): string[] {
    const allConstraints = listConstraints(playbook, { descriptionFile });
    
    // Score each constraint by similarity to search term
    const scored = allConstraints.map(c => ({
        id: c.id,
        score: similarityScore(c.id, searchTerm) + 
               (c.properties.some(p => p.includes(searchTerm)) ? 0.5 : 0)
    }));
    
    // Return top 5 suggestions
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(s => s.id);
}

function similarityScore(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    // Check for substring match
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    
    // Check for word overlap
    const words1 = s1.split(/[-_]/);
    const words2 = s2.split(/[-_]/);
    const overlap = words1.filter(w => words2.includes(w)).length;
    
    return overlap / Math.max(words1.length, words2.length);
}

// ============================================================================
// Description Schema Discovery
// ============================================================================

/**
 * Find the description schema for a given file.
 */
export function findDescriptionSchema(
    playbook: MethodologyPlaybook, 
    descriptionFile: string
): { key: string; schema: DescriptionSchema } | null {
    if (!playbook.descriptions) return null;
    
    // Try exact match first
    if (playbook.descriptions[descriptionFile]) {
        return { key: descriptionFile, schema: playbook.descriptions[descriptionFile] };
    }
    
    // Try matching by file property or partial path
    for (const [key, schema] of Object.entries(playbook.descriptions)) {
        if (schema.file === descriptionFile || 
            schema.file?.endsWith(descriptionFile) ||
            descriptionFile.endsWith(schema.file || '') ||
            key.includes(path.basename(descriptionFile)) ||
            descriptionFile.includes(key)) {
            return { key, schema };
        }
    }
    
    return null;
}

/**
 * List all description files configured in the playbook.
 */
export function listDescriptionFiles(playbook: MethodologyPlaybook): string[] {
    if (!playbook.descriptions) return [];
    return Object.keys(playbook.descriptions);
}
