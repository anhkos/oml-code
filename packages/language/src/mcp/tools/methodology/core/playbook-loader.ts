/**
 * Playbook Loader: File I/O and playbook discovery logic
 * 
 * This module handles:
 * - Finding playbook files in the workspace
 * - Loading YAML playbooks
 * - Saving playbooks back to disk
 * - Auto-detection of playbooks from description files
 * 
 * Encapsulates all filesystem operations for playbook management.
 */

import * as fs from 'fs';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import yaml from 'js-yaml';
import { MethodologyPlaybook } from '../playbook-types.js';
import { Logger, getLogger } from '../../common/logger.js';

interface CachedPlaybook {
    playbook: MethodologyPlaybook;
    modifiedTime: number;
}

const playbookCache = new Map<string, CachedPlaybook>();
const MAX_PLAYBOOK_CACHE_SIZE = 10;

function getCachedPlaybook(resolvedPath: string): MethodologyPlaybook | null {
    const cached = playbookCache.get(resolvedPath);
    if (!cached) return null;

    try {
        const stats = fs.statSync(resolvedPath);
        if (stats.mtimeMs === cached.modifiedTime) {
            return cached.playbook;
        }
        playbookCache.delete(resolvedPath);
        return null;
    } catch {
        playbookCache.delete(resolvedPath);
        return null;
    }
}

async function getCachedPlaybookAsync(resolvedPath: string): Promise<{ cachedPlaybook?: MethodologyPlaybook; stats: fs.Stats } | null> {
    const cached = playbookCache.get(resolvedPath);
    try {
        const stats = await fsPromises.stat(resolvedPath);
        if (cached && stats.mtimeMs === cached.modifiedTime) {
            return { cachedPlaybook: cached.playbook, stats };
        }
        if (cached) playbookCache.delete(resolvedPath);
        return { stats };
    } catch {
        playbookCache.delete(resolvedPath);
        return null;
    }
}

function setPlaybookCache(resolvedPath: string, playbook: MethodologyPlaybook, stats?: fs.Stats): void {
    try {
        const fileStats = stats ?? fs.statSync(resolvedPath);
        if (playbookCache.size >= MAX_PLAYBOOK_CACHE_SIZE) {
            const firstKey = playbookCache.keys().next().value;
            if (firstKey) playbookCache.delete(firstKey);
        }
        playbookCache.set(resolvedPath, {
            playbook,
            modifiedTime: fileStats.mtimeMs,
        });
    } catch {
        // Ignore cache update if file is not readable
    }
}

export function invalidatePlaybookCache(playbookPath?: string): void {
    if (!playbookPath) {
        playbookCache.clear();
        return;
    }

    const resolvedPath = path.resolve(playbookPath);
    playbookCache.delete(resolvedPath);
}

export function getPlaybookCacheInfo(): { size: number; maxSize: number; entries: string[] } {
    return {
        size: playbookCache.size,
        maxSize: MAX_PLAYBOOK_CACHE_SIZE,
        entries: [...playbookCache.keys()],
    };
}

/**
 * Async: Find playbook file by searching up directory tree
 * Returns path to first playbook found (nearest/most specific)
 *
 * @param dirPath Starting directory to search from
 * @param maxDepth Maximum directory levels to traverse (default 10)
 * @param logger Optional logger instance
 * @returns Full path to playbook file or null if not found
 */
export async function findPlaybookAsync(
    dirPath: string,
    maxDepth: number = 10,
    logger: Logger = getLogger('playbook-loader'),
): Promise<string | null> {
    async function search(dir: string, depth: number): Promise<string | null> {
        if (depth >= maxDepth) return null;

        try {
            const files = await fsPromises.readdir(dir);

            // Look for any playbook files
            const playbookFile = files.find(
                (f) =>
                    f.endsWith('.yaml') ||
                    f.endsWith('.yml')
            );

            if (playbookFile) {
                const result = path.join(dir, playbookFile);
                logger.debug(`Found playbook`, { path: result });
                return result;
            }
        } catch (error) {
            logger.debug(`Directory read failed`, { dir, error: String(error) });
        }

        // Move to parent directory
        const parentDir = path.dirname(dir);

        // Stop if we've reached filesystem root
        if (parentDir === dir) return null;

        return search(parentDir, depth + 1);
    }

    return search(dirPath, 0);
}

/**
 * Synchronous version: Find playbook file by searching up directory tree
 * Returns path to first playbook found (nearest/most specific)
 * Use findPlaybookAsync for better scalability
 *
 * @param dirPath Starting directory to search from
 * @param maxDepth Maximum directory levels to traverse (default 10)
 * @param currentDepth Current traversal depth (for recursion)
 * @returns Full path to playbook file or null if not found
 */
export function findPlaybook(
    dirPath: string,
    maxDepth: number = 10,
    currentDepth: number = 0,
): string | null {
    if (currentDepth >= maxDepth) return null;

    try {
        const files = fs.readdirSync(dirPath);

        // Look for any playbook files
        const playbookFile = files.find(
            (f) =>
                f.endsWith('_playbook.yaml') ||
                f.endsWith('_playbook.yml') ||
                f === 'playbook.yaml' ||
                f === 'playbook.yml',
        );

        if (playbookFile) {
            return path.join(dirPath, playbookFile);
        }
    } catch {
        // Directory read failed, continue up
    }

    // Move to parent directory
    const parentDir = path.dirname(dirPath);

    // Stop if we've reached filesystem root
    if (parentDir === dirPath) return null;

    return findPlaybook(parentDir, maxDepth, currentDepth + 1);
}

/**
 * Async: Find playbook file associated with a description file
 * Searches from the description file's directory upward
 *
 * @param descriptionPath Path to OML description file
 * @param logger Optional logger instance
 * @returns Full path to playbook or null if not found
 */
export async function findPlaybookFromDescriptionAsync(
    descriptionPath: string,
    logger: Logger = getLogger('playbook-loader'),
): Promise<string | null> {
    const descDir = path.dirname(descriptionPath);
    return findPlaybookAsync(descDir, 10, logger);
}

/**
 * Async: Resolve a playbook path with fallback strategies
 * Tries explicit path first, then auto-detection from description or methodology name
 *
 * @param params Object with optional playbookPath, descriptionPath, methodologyName
 * @param logger Optional logger instance
 * @returns Resolved full path to playbook or null if cannot resolve
 */
export async function resolvePlaybookPathAsync(
    params: {
        playbookPath?: string;
        descriptionPath?: string;
        methodologyName?: string;
        workspacePath?: string;
    },
    logger: Logger = getLogger('playbook-loader'),
): Promise<string | null> {
    // Try explicit path first
    if (params.playbookPath) {
        logger.debug(`Using explicit playbook path`, { path: params.playbookPath });
        return params.playbookPath;
    }

    // Try auto-detection from description
    if (params.descriptionPath) {
        const found = await findPlaybookFromDescriptionAsync(params.descriptionPath, logger);
        if (found) {
            logger.debug(`Found playbook from description`, { description: params.descriptionPath, playbook: found });
            return found;
        }
    }

    // Try to find from methodology name
    if (params.methodologyName) {
        const startDir = params.workspacePath || process.cwd();
        const found = await findPlaybookAsync(startDir, 10, logger);
        if (found) {
            logger.debug(`Found playbook by methodology name`, { methodology: params.methodologyName, playbook: found });
            return found;
        }
    }

    logger.warn(`Could not resolve playbook path`, params);
    return null;
}

/**
 * Find playbook file associated with a description file (sync version)
 * Searches from the description file's directory upward
 *
 * @param descriptionPath Path to OML description file
 * @returns Full path to playbook or null if not found
 */
export function findPlaybookFromDescription(descriptionPath: string): string | null {
    const descDir = path.dirname(descriptionPath);
    return findPlaybook(descDir);
}

/**
 * Resolve a playbook path with fallback strategies (sync version)
 * Tries explicit path first, then auto-detection from description or methodology name
 *
 * @param params Object with optional playbookPath, descriptionPath, methodologyName
 * @returns Resolved full path to playbook or null if cannot resolve
 */
export function resolvePlaybookPath(params: {
    playbookPath?: string;
    descriptionPath?: string;
    methodologyName?: string;
    workspacePath?: string;
}): string | null {
    // Try explicit path first
    if (params.playbookPath) {
        return params.playbookPath;
    }

    // Try auto-detection from description
    if (params.descriptionPath) {
        const found = findPlaybookFromDescription(params.descriptionPath);
        if (found) return found;
    }

    // Try to find from methodology name
    if (params.methodologyName) {
        const startDir = params.workspacePath || process.cwd();
        const found = findPlaybook(startDir);
        if (found) return found;
    }

    return null;
}

/**
 * Async: Load and parse playbook file (YAML or JSON)
 *
 * @param playbookPath Full path to playbook file
 * @param logger Optional logger instance
 * @returns Parsed playbook object
 * @throws If file not found or parsing fails
 */
export async function loadPlaybookAsync(
    playbookPath: string,
    logger: Logger = getLogger('playbook-loader'),
): Promise<MethodologyPlaybook> {
    const resolvedPath = path.resolve(playbookPath);
    try {
        const cached = await getCachedPlaybookAsync(resolvedPath);
        if (cached?.cachedPlaybook) {
            logger.debug(`Playbook cache hit`, { path: resolvedPath });
            return cached.cachedPlaybook;
        }

        logger.debug(`Loading playbook`, { path: resolvedPath });
        const content = await fsPromises.readFile(resolvedPath, 'utf-8');

        const ext = path.extname(resolvedPath).toLowerCase();
        try {
            const playbook = ext === '.json'
                ? (JSON.parse(content) as MethodologyPlaybook)
                : (yaml.load(content) as MethodologyPlaybook);
            logger.info(`Playbook loaded successfully`, { path: resolvedPath, format: ext || 'yaml' });
            if (cached?.stats) {
                setPlaybookCache(resolvedPath, playbook, cached.stats);
            } else {
                setPlaybookCache(resolvedPath, playbook);
            }
            return playbook;
        } catch (parseError) {
            logger.error(`Failed to parse playbook`, parseError as Error, { path: resolvedPath, format: ext || 'yaml' });
            throw new Error(`Could not parse playbook as ${ext === '.json' ? 'JSON' : 'YAML'}: ${resolvedPath}`);
        }
    } catch (error) {
        logger.error(`Failed to load playbook`, error as Error, { path: resolvedPath });
        throw new Error(`Failed to load playbook from ${resolvedPath}: ${error}`);
    }
}

/**
 * Async: Save playbook back to disk as YAML (or JSON if .json extension)
 *
 * @param playbookPath Full path where playbook should be saved
 * @param playbook Playbook object to save
 * @param logger Optional logger instance
 */
export async function savePlaybookAsync(
    playbookPath: string,
    playbook: MethodologyPlaybook,
    logger: Logger = getLogger('playbook-loader'),
): Promise<void> {
    try {
        const resolvedPath = path.resolve(playbookPath);
        logger.debug(`Saving playbook`, { path: resolvedPath });
        const ext = path.extname(resolvedPath).toLowerCase();
        const output = ext === '.json'
            ? JSON.stringify(playbook, null, 2)
            : yaml.dump(playbook, { noRefs: true, lineWidth: 120 });
        await fsPromises.writeFile(resolvedPath, output, 'utf-8');
        const stats = await fsPromises.stat(resolvedPath);
        setPlaybookCache(resolvedPath, playbook, stats);
        logger.info(`Playbook saved successfully`, { path: resolvedPath, format: ext || 'yaml' });
    } catch (error) {
        logger.error(`Failed to save playbook`, error as Error, { path: playbookPath });
        throw new Error(`Failed to save playbook to ${playbookPath}: ${error}`);
    }
}

/**
 * Load and parse playbook file (YAML or JSON) - synchronous version
 * Use loadPlaybookAsync for better scalability
 *
 * @param playbookPath Full path to playbook file
 * @returns Parsed playbook object
 * @throws If file not found or parsing fails
 */
export function loadPlaybook(playbookPath: string): MethodologyPlaybook {
    try {
        const resolvedPath = path.resolve(playbookPath);
        const cached = getCachedPlaybook(resolvedPath);
        if (cached) {
            return cached;
        }

        const content = fs.readFileSync(resolvedPath, 'utf-8');

        const ext = path.extname(resolvedPath).toLowerCase();
        try {
            const playbook = ext === '.json'
                ? (JSON.parse(content) as MethodologyPlaybook)
                : (yaml.load(content) as MethodologyPlaybook);
            setPlaybookCache(resolvedPath, playbook);
            return playbook;
        } catch {
            throw new Error(`Could not parse playbook as ${ext === '.json' ? 'JSON' : 'YAML'}: ${resolvedPath}`);
        }
    } catch (error) {
        throw new Error(`Failed to load playbook from ${playbookPath}: ${error}`);
    }
}

/**
 * Save playbook back to disk as YAML (or JSON if .json extension) - synchronous version
 * Use savePlaybookAsync for better scalability
 *
 * @param playbookPath Full path where playbook should be saved
 * @param playbook Playbook object to save
 */
export function savePlaybook(playbookPath: string, playbook: MethodologyPlaybook): void {
    try {
        const resolvedPath = path.resolve(playbookPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const output = ext === '.json'
            ? JSON.stringify(playbook, null, 2)
            : yaml.dump(playbook, { noRefs: true, lineWidth: 120 });
        fs.writeFileSync(resolvedPath, output, 'utf-8');
        setPlaybookCache(resolvedPath, playbook);
    } catch (error) {
        throw new Error(`Failed to save playbook to ${playbookPath}: ${error}`);
    }
}

/**
 * Check if a file is likely a description file (contains 'instance' or 'description')
 */
export function isDescriptionFile(filePath: string): boolean {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return /\binstance\b|\bdescription\b|\bconceptInstance\b|\brelationInstance\b/.test(content);
    } catch {
        return false;
    }
}

/**
 * Find all description files in a directory tree
 * Searches recursively up to specified depth
 *
 * @param dirPath Root directory to search
 * @param maxDepth Maximum directory levels to search (default 5)
 * @param currentDepth Current traversal depth
 * @returns Array of full paths to description files found
 */
export function findDescriptionFiles(
    dirPath: string,
    maxDepth: number = 5,
    currentDepth: number = 0,
): string[] {
    const results: string[] = [];

    if (currentDepth >= maxDepth) return results;

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                // Recurse into directories
                results.push(...findDescriptionFiles(fullPath, maxDepth, currentDepth + 1));
            } else if (entry.isFile() && entry.name.endsWith('.oml')) {
                // Check if it's a description file
                if (isDescriptionFile(fullPath)) {
                    results.push(fullPath);
                }
            }
        }
    } catch {
        // Directory read failed, skip
    }

    return results;
}

/**
 * Auto-detect playbook path from methodology name
 * Walks up directory tree looking for *_playbook.yaml files
 *
 * @param methodologyName Name of methodology to search for
 * @param startFromPath Optional starting directory
 * @returns Path to first matching playbook or null
 */
export function detectPlaybookPath(methodologyName: string, startFromPath?: string): string | null {
    const methodologyLower = methodologyName.toLowerCase();

    // Start from the description file's directory or workspace root
    let currentDir = startFromPath ? path.dirname(startFromPath) : process.cwd();

    // Walk up the directory tree (max 10 levels to avoid infinite loops)
    const maxLevels = 10;
    let level = 0;

    while (level < maxLevels) {
        // Check for any playbook files in current directory
        try {
            const files = fs.readdirSync(currentDir);

            // Look for exact methodology match first
            const exactMatch = files.find(
                (f) =>
                    f.toLowerCase() === `${methodologyLower}_playbook.yaml` ||
                    f.toLowerCase() === `${methodologyLower}_playbook.yml` ||
                    f.toLowerCase() === `${methodologyLower}_methodology.yaml`,
            );

            if (exactMatch) {
                return path.join(currentDir, exactMatch);
            }

            // Then look for generic playbook files
            const genericMatch = files.find(
                (f) =>
                    f.toLowerCase() === 'methodology_playbook.yaml' ||
                    f.toLowerCase() === 'methodology_playbook.yml' ||
                    f.toLowerCase() === 'playbook.yaml',
            );

            if (genericMatch) {
                return path.join(currentDir, genericMatch);
            }
        } catch {
            // Directory read failed, move up
        }

        // Move to parent directory
        const parentDir = path.dirname(currentDir);

        // Stop if we've reached filesystem root
        if (parentDir === currentDir) {
            break;
        }

        currentDir = parentDir;
        level++;
    }

    return null;
}
