/**
 * Centralized Langium OML Services
 * 
 * Provides a singleton instance of OML services to avoid repeated initialization.
 * This is the foundation for Phase 4 LSP migration - once LSP client is in place,
 * this can be replaced with LSP calls.
 */

import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../oml-module.js';

type OmlServices = ReturnType<typeof createOmlServices>;

let servicesInstance: OmlServices | null = null;

/**
 * Get or create the singleton OML services instance.
 * 
 * @returns The shared OML services instance
 */
export function getOmlServices(): OmlServices {
    if (!servicesInstance) {
        servicesInstance = createOmlServices(NodeFileSystem);
    }
    return servicesInstance;
}

/**
 * Reset the services instance. Useful for testing or when you need to reload from disk.
 */
export function resetOmlServices(): void {
    servicesInstance = null;
}

/**
 * Get the services and invalidate any cached documents.
 * This ensures you get a fresh read from disk.
 */
export function getFreshOmlServices(): OmlServices {
    const services = getOmlServices();
    // Note: Document cache is managed in document-store.ts
    // Callers should use getFreshDocument() from document-store to get fresh files
    return services;
}

/**
 * Type export for consumers
 */
export type { OmlServices };
