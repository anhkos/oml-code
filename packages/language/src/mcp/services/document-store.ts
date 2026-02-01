/**
 * Document Store with Caching
 * 
 * Provides caching for parsed OML documents to improve performance.
 * Handles invalidation when files are modified externally.
 */

import * as fs from 'fs';
import { URI } from 'langium';
import { getOmlServices } from './oml-services.js';

export interface CachedDocument {
    uri: string;
    parseResult: any;
    modifiedTime: number;
}

/**
 * In-memory cache of recently parsed documents.
 * Maps file path to cached parse result.
 */
const documentCache = new Map<string, CachedDocument>();

/**
 * Maximum number of documents to keep in cache
 */
const MAX_CACHE_SIZE = 50;

/**
 * Get a cached document if it exists and hasn't been modified.
 * 
 * @param filePath Absolute file path
 * @returns Cached document info, or null if not cached or stale
 */
export function getCachedDocument(filePath: string): CachedDocument | null {
    const cached = documentCache.get(filePath);
    if (!cached) return null;
    
    try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs !== cached.modifiedTime) {
            // File has been modified, invalidate cache
            documentCache.delete(filePath);
            return null;
        }
        return cached;
    } catch {
        // File may have been deleted
        documentCache.delete(filePath);
        return null;
    }
}

/**
 * Cache a parsed document.
 * 
 * @param filePath Absolute file path
 * @param parseResult The parsed document from Langium
 */
export function cacheDocument(filePath: string, parseResult: any): void {
    try {
        const stats = fs.statSync(filePath);
        
        // Enforce cache size limit
        if (documentCache.size >= MAX_CACHE_SIZE) {
            // Remove oldest entry (simple FIFO for now)
            const firstKey = documentCache.keys().next().value;
            if (firstKey) {
                documentCache.delete(firstKey);
            }
        }
        
        documentCache.set(filePath, {
            uri: URI.file(filePath).toString(),
            parseResult,
            modifiedTime: stats.mtimeMs,
        });
    } catch {
        // If we can't stat the file, don't cache it
    }
}

/**
 * Invalidate a cached document (force re-read from disk next time).
 * 
 * @param filePath Absolute file path
 */
export function invalidateDocument(filePath: string): void {
    documentCache.delete(filePath);
}

/**
 * Clear all cached documents.
 */
export function clearDocumentCache(): void {
    documentCache.clear();
}

/**
 * Get the number of cached documents (for debugging/monitoring).
 */
export function getCacheSizeInfo(): { size: number; maxSize: number } {
    return { size: documentCache.size, maxSize: MAX_CACHE_SIZE };
}

/**
 * Get a fresh document from disk, with caching support.
 * 
 * Automatically handles:
 * - Reading from Langium's document system
 * - Cache invalidation if file was modified
 * - Cleaning up old cached versions
 * 
 * @param fileUri The file URI (file:// format)
 * @returns The parsed document
 */
export async function getFreshDocument(fileUri: string) {
    const parsedUri = URI.parse(fileUri);
    const filePath = parsedUri.fsPath;
    
    // Check if we have a valid cached version
    const cached = getCachedDocument(filePath);
    if (cached) {
        return cached;
    }
    
    // No cache or cache is stale - fetch from Langium
    const services = getOmlServices();
    const langiumDocs = services.shared.workspace.LangiumDocuments;
    
    // Invalidate in Langium's cache to force re-read
    if (langiumDocs.hasDocument(parsedUri)) {
        langiumDocs.deleteDocument(parsedUri);
    }
    
    // Get fresh document from disk
    const document = await langiumDocs.getOrCreateDocument(parsedUri);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    
    // Cache it
    cacheDocument(filePath, document);
    
    return document;
}
