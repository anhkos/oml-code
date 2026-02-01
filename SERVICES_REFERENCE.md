# Services Layer - Quick Reference Guide

## Overview

The services layer (`packages/language/src/mcp/services/`) provides centralized access to:
- OML Langium services
- Document caching and management  
- Workspace path resolution

## For Tool Developers

### Getting Started

```typescript
// Import what you need from services
import { getOmlServices, getFreshDocument } from '../services/index.js';

// Or use via common (backwards compatible)
import { getOmlServices } from '../common.js';

export const myToolHandler = async (params: { ontology: string }) => {
  // Get the singleton Langium services
  const services = getOmlServices();
  
  // Load a document (automatically cached/invalidated)
  const fileUri = pathToFileUri(params.ontology);
  const document = await getFreshDocument(fileUri);
  
  // Parse result is available
  const root = document.parseResult.value;
  
  // ... rest of your logic
};
```

### Common Tasks

#### Load a Vocabulary
```typescript
import { loadVocabularyDocument } from '../common.js';

const { vocabulary, services, text, eol, indent } = await loadVocabularyDocument(ontologyPath);
```

#### Load Any Ontology (Vocabulary or Description)
```typescript
import { loadAnyOntologyDocument } from '../common.js';

const { root, isVocabulary, isDescription, importKeyword } = await loadAnyOntologyDocument(ontologyPath);
```

#### Resolve Paths
```typescript
import { resolveWorkspacePath, getWorkspaceRoot, pathToFileUri } from '../common.js';

const root = getWorkspaceRoot();
const absolute = resolveWorkspacePath('my-file.oml');
const uri = pathToFileUri(absolute);
```

#### Detect File Properties
```typescript
import { detectIndentation, detectEol } from '../services/index.js';

const content = fs.readFileSync(filePath, 'utf-8');
const indent = detectIndentation(content);   // '    ' or '\t'
const eol = detectEol(content);              // '\r\n' or '\n'
```

#### Find Files
```typescript
import { findFileInAncestors, findOmlFiles } from '../services/index.js';

// Search up directory tree for a file
const playbookPath = findFileInAncestors('/path/to/file.oml', '*_playbook.yaml');

// Find all OML files in a directory
const omlFiles = findOmlFiles('/path/to/workspace');
```

## Services API Reference

### `oml-services.ts`

```typescript
// Get the singleton OML services instance
export function getOmlServices(): OmlServices

// Reset the instance (useful for testing)
export function resetOmlServices(): void

// Get fresh instance (usually just call getOmlServices())
export function getFreshOmlServices(): OmlServices
```

### `document-store.ts`

```typescript
// Get a cached document if not modified on disk
export function getCachedDocument(filePath: string): CachedDocument | null

// Manually cache a document
export function cacheDocument(filePath: string, parseResult: any): void

// Invalidate a document from cache
export function invalidateDocument(filePath: string): void

// Clear all cached documents
export function clearDocumentCache(): void

// Check cache stats (for debugging)
export function getCacheSizeInfo(): { size: number; maxSize: number }

// Get fresh document (handles caching automatically)
export async function getFreshDocument(fileUri: string): CachedDocument
```

### `workspace-resolver.ts`

```typescript
// Workspace management
export function getWorkspaceRoot(): string
export function setWorkspaceRoot(root: string): void

// Path resolution
export function resolveWorkspacePath(inputPath: string): string
export function getRelativeWorkspacePath(absolutePath: string): string

// URI conversions
export function pathToFileUri(filePath: string): string
export function fileUriToPath(fileUri: string): string

// File verification
export function ensureFileExists(filePath: string): void
export function ensureInWorkspace(filePath: string): void

// File properties
export function getFileSize(filePath: string): { bytes: number; readable: string }
export function getFileModTime(filePath: string): number

// File analysis
export function detectEol(content: string): '\r\n' | '\n'
export function detectIndentation(content: string): string

// File search
export function findFileInAncestors(startPath: string, fileName: string, maxDepth?: number): string | null
export function findOmlFiles(dirPath: string, ignoreNodeModules?: boolean): string[]
```

## Testing with Services

### Mock the Services

```typescript
import { setWorkspaceRoot, getFreshDocument, clearDocumentCache } from '../services/index.js';

describe('My Tool', () => {
  beforeEach(() => {
    // Set test workspace
    setWorkspaceRoot('/test/workspace');
  });
  
  afterEach(() => {
    // Clean up
    clearDocumentCache();
  });
  
  it('should load documents', async () => {
    // Document loading will now use /test/workspace
    const doc = await getFreshDocument('file:///test/workspace/test.oml');
    expect(doc).toBeDefined();
  });
});
```

### Cache Behavior

```typescript
// Document is cached after first read
const doc1 = await getFreshDocument('file:///path/to/file.oml');

// Second read comes from cache (no disk I/O)
const doc2 = await getFreshDocument('file:///path/to/file.oml');

// If file modified on disk, cache is automatically invalidated
// Next read will reload from disk

// Manual invalidation
import { invalidateDocument } from '../services/index.js';
invalidateDocument('/path/to/file.oml');
```

## Migration Guide: Moving from common.ts to services

### Before (direct imports)
```typescript
import { createOmlServices, NodeFileSystem } from '../../oml-module.js';
import { getWorkspaceRoot, resolveWorkspacePath } from '../common.js';

const services = createOmlServices(NodeFileSystem);
const root = getWorkspaceRoot();
```

### After (via services)
```typescript
import { getOmlServices, getWorkspaceRoot } from '../services/index.js';

const services = getOmlServices();
const root = getWorkspaceRoot();
```

### Backwards Compatible (still works)
```typescript
// common.ts now re-exports from services
import { getOmlServices, getWorkspaceRoot } from '../common.js';
```

## Performance Tips

### Leverage Caching
```typescript
// Good: Document is cached by default
const doc = await getFreshDocument(fileUri);

// Also good: Reuse the same document
for (const file of files) {
  const doc = await getFreshDocument(fileUri);  // Cached!
  // Process doc
}

// If you need to force a fresh read:
import { invalidateDocument } from '../services/index.js';
invalidateDocument(filePath);
const doc = await getFreshDocument(fileUri);  // Fresh from disk
```

### Check Cache Stats
```typescript
import { getCacheSizeInfo } from '../services/index.js';

const { size, maxSize } = getCacheSizeInfo();
console.log(`Cache: ${size}/${maxSize} documents`);
```

## Common Patterns

### Load → Modify → Write Pattern
```typescript
import { loadVocabularyDocument } from '../common.js';
import { writeFileAndNotify } from '../common.js';

const { vocabulary, text, eol, fileUri } = await loadVocabularyDocument(path);

// Modify text
let newText = text + '\n\nnew concept MyNewConcept';

// Write back
await writeFileAndNotify(filePath, fileUri, newText);
```

### Find Resource Pattern
```typescript
import { findFileInAncestors } from '../services/index.js';

function findPlaybook(startPath: string): string | null {
  return findFileInAncestors(startPath, '*_playbook.yaml');
}
```

### Batch File Operations
```typescript
import { findOmlFiles } from '../services/index.js';
import { getFreshDocument } from '../services/index.js';

const omlFiles = findOmlFiles(workspaceRoot);

for (const filePath of omlFiles) {
  const fileUri = pathToFileUri(filePath);
  const doc = await getFreshDocument(fileUri);  // Cached!
  // Process each doc
}
```

## Troubleshooting

### Issue: Document Not Updating
**Cause**: Cache not invalidated after external modification
**Solution**: Use `invalidateDocument()` before reading again

```typescript
import { invalidateDocument, getFreshDocument } from '../services/index.js';

invalidateDocument(filePath);
const doc = await getFreshDocument(fileUri);
```

### Issue: Path Not Found
**Cause**: Resolving against wrong workspace root
**Solution**: Check workspace root matches expectations

```typescript
import { getWorkspaceRoot, setWorkspaceRoot } from '../services/index.js';

console.log('Current workspace:', getWorkspaceRoot());
setWorkspaceRoot('/expected/path');
```

### Issue: Out of Memory
**Cause**: Cache growing too large
**Solution**: Clear cache periodically

```typescript
import { clearDocumentCache } from '../services/index.js';

// After large batch operation
clearDocumentCache();
```

## Next: Phase 4 LSP Integration

The services layer is designed for easy LSP migration:

```typescript
// Current (Phase 1-3): Direct Langium services
export function getOmlServices(): OmlServices {
  return createOmlServices(NodeFileSystem);
}

// Future (Phase 4): LSP client (drop-in replacement)
export function getOmlServices(): OmlServices {
  return new LspClient(LSP_ENDPOINT);
}
```

All tools continue to work without changes! ✨
