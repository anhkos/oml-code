/**
 * OML MCP Services - Unified Service Layer
 * 
 * Provides all core services needed by MCP tools:
 * - OML language services (Langium)
 * - Document caching and management
 * - Workspace path resolution
 * 
 * This layer is the foundation for:
 * 1. Reducing tool coupling (centralized initialization)
 * 2. Phase 4 LSP migration (can replace with LSP calls)
 * 3. Testing (easy to mock services)
 */

export {
    getOmlServices,
    resetOmlServices,
    getFreshOmlServices,
    type OmlServices,
} from './oml-services.js';

export {
    getCachedDocument,
    cacheDocument,
    invalidateDocument,
    clearDocumentCache,
    getCacheSizeInfo,
    getFreshDocument,
    type CachedDocument,
} from './document-store.js';

export {
    getWorkspaceRoot,
    setWorkspaceRoot,
    resolveWorkspacePath,
    getRelativeWorkspacePath,
    pathToFileUri,
    fileUriToPath,
    ensureFileExists,
    ensureInWorkspace,
    getFileSize,
    getFileModTime,
    detectEol,
    detectIndentation,
    findFileInAncestors,
    findOmlFiles,
} from './workspace-resolver.js';
