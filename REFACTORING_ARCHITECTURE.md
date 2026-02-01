# OML MCP Server: Complete Refactoring Architecture

## Overview

This document outlines the complete refactoring strategy for the OML MCP Server, addressing three core concerns:

1. **Decoupling from Langium Extension** - Enable independent deployment
2. **Separating Modeling Layers** - Distinguish vocabulary (schema) tools from description (instance) tools
3. **Reducing Tool Coupling** - Clear service boundaries and shared utilities

---

## Part 1: OML Modeling Layers

### Vocabulary Layer (Schema Definition)

**Purpose**: Define reusable types, properties, and relations that describe the problem domain.

**Tools**:
- `create_concept` - Define concept types (e.g., Requirement, Stakeholder)
- `create_aspect` - Define aspect types (abstract types)
- `create_relation` - Define unreified relations between concepts
- `create_relation_entity` - Define reified relations (can be instantiated)
- `create_scalar` - Define data types (e.g., string, integer)
- `create_scalar_property` - Define properties with domains/ranges
- `create_annotation_property` - Define annotation metadata
- `add_specialization` - Build inheritance hierarchies
- `add_restriction` - Define constraints (cardinality, type restrictions)
- `create_rule` - Define logical rules over types

**Files Modified**: `packages/language/src/mcp/tools/vocabulary/`

**Location**: Always write to **vocabulary** files (`.oml` files with `vocabulary` keyword)

---

### Description Layer (Instance Modeling)

**Purpose**: Create specific instances (data) that conform to vocabulary types.

**Tools**:
- `create_concept_instance` - Create an instance of a concept type
- `create_relation_instance` - Create an instance of a relation type
- `update_instance` - Modify instance properties and types
- `delete_instance` - Remove an instance
- `update_property_value` - Update instance property values
- `delete_property_value` - Remove property values
- `delete_type_assertion` - Remove type assertions

**Files Modified**: `packages/language/src/mcp/tools/description/`

**Location**: Always write to **description** files (`.oml` files with `description` keyword)

---

### Methodology Layer (Modeling Patterns)

**Purpose**: Enforce consistent modeling practices across descriptions and vocabularies.

**Tools**:
- `extract_methodology_rules` - Extract patterns from vocabularies
- `enforce_methodology_rules` - Validate descriptions against patterns
- `prepare_instance` - Generate instances using templates
- `clarify_methodology_preferences` - Establish methodology decisions
- `extract_description_schemas` - Analyze existing descriptions

**Files Modified**: Any vocabulary or description (uses playbooks to guide decisions)

---

## Part 2: Architecture Components

### Directory Structure After Refactoring

```
packages/language/src/mcp/
├── server.ts                           # Main entry point
├── config.ts                           # Configuration (LSP endpoint, workspace)
│
├── services/                           # PHASE 1: Core infrastructure
│   ├── oml-services.ts                # Langium singleton (cached)
│   ├── lsp-client.ts                  # PHASE 4a: LSP-first interface
│   ├── document-store.ts              # Document caching layer
│   ├── workspace-resolver.ts          # Path resolution
│   └── offline-fallback.ts            # PHASE 4b: Graceful degradation
│
├── tools/
│   ├── index.ts                       # Tool registration & exports
│   ├── types.ts                       # Shared type definitions
│   ├── schemas.ts                     # Zod parameter schemas
│   ├── common.ts                      # Shared utilities (temporary, will migrate)
│   ├── validate-tool.ts               # Validation (cross-layer)
│   │
│   ├── vocabulary/                    # PHASE 5: Vocabulary (schema) layer
│   │   ├── index.ts                   # Export all vocabulary tools
│   │   ├── terms/                     # Term creation (concepts, aspects, etc.)
│   │   │   ├── create-concept.ts
│   │   │   ├── create-aspect.ts
│   │   │   ├── create-relation.ts
│   │   │   ├── create-relation-entity.ts
│   │   │   ├── create-scalar.ts
│   │   │   ├── create-scalar-property.ts
│   │   │   ├── create-annotation-property.ts
│   │   │   ├── delete-term.ts
│   │   │   ├── update-term.ts
│   │   │   └── text-builders.ts       # Helper for term generation
│   │   │
│   │   └── axioms/                    # Axiom management (specializations, restrictions, etc.)
│   │       ├── add-specialization.ts
│   │       ├── delete-specialization.ts
│   │       ├── add-restriction.ts
│   │       ├── update-restriction.ts
│   │       ├── delete-restriction.ts
│   │       ├── add-equivalence.ts
│   │       ├── update-equivalence.ts
│   │       ├── delete-equivalence.ts
│   │       ├── add-key.ts
│   │       ├── update-key.ts
│   │       ├── delete-key.ts
│   │       ├── update-annotation.ts
│   │       └── delete-annotation.ts
│   │
│   ├── description/                   # PHASE 5: Description (instance) layer
│   │   ├── index.ts                   # Export all description tools
│   │   ├── instances/                 # Instance creation & manipulation
│   │   │   ├── create-concept-instance.ts
│   │   │   ├── create-relation-instance.ts
│   │   │   ├── update-instance.ts
│   │   │   ├── delete-instance.ts
│   │   │   ├── update-property-value.ts
│   │   │   ├── delete-property-value.ts
│   │   │   ├── delete-type-assertion.ts
│   │   │   └── description-common.ts  # Description-specific utilities
│   │   │
│   │   └── query/                     # Moved from top-level
│   │       ├── suggest-oml-symbols.ts
│   │       └── analyze-impact.ts
│   │
│   ├── ontology/                      # Ontology file management
│   │   ├── create-ontology.ts
│   │   ├── add-import.ts
│   │   ├── delete-import.ts
│   │   └── delete-ontology.ts
│   │
│   ├── rules/                         # Rule management (cross-layer)
│   │   ├── create-rule.ts
│   │   ├── update-rule.ts
│   │   └── delete-rule.ts
│   │
│   ├── methodology/                   # PHASE 2: Extracted methodology core
│   │   ├── index.ts
│   │   ├── core/                      # Business logic (no direct file I/O)
│   │   │   ├── playbook-loader.ts
│   │   │   ├── schema-analyzer.ts
│   │   │   ├── constraint-engine.ts
│   │   │   ├── preference-engine.ts
│   │   │   └── playbook-types.ts
│   │   │
│   │   └── tools/                     # Thin tool wrappers
│   │       ├── extract-methodology-rules.ts
│   │       ├── enforce-methodology-rules.ts
│   │       ├── extract-description-schemas.ts
│   │       ├── prepare-instance.ts
│   │       ├── clarify-methodology-preferences.ts
│   │       ├── route-instance.ts
│   │       ├── update-playbook.ts
│   │       ├── list-playbook-constraints.ts
│   │       └── analyze-request.ts
│   │
│   ├── preferences/                   # User preferences & state
│   │   ├── index.ts
│   │   ├── set-preferences-tool.ts
│   │   ├── get-preferences-tool.ts
│   │   ├── log-feedback-tool.ts
│   │   └── preferences-state.ts
│   │
│   └── stubs/                         # Placeholder tools
│       └── pending-tools.ts
│
└── mcp/                               # MCP protocol utilities
    ├── tool-registration.ts           # PHASE 3: Auto-discovery mechanism
    └── plugin-metadata.ts
```

---

## Part 3: Phased Implementation

### Phase 1: Core Infrastructure & Services

**Goal**: Centralize Langium service initialization and document loading.

**Creates**:
- `services/oml-services.ts` - Singleton Langium service
- `services/document-store.ts` - Cache parsed documents
- `services/workspace-resolver.ts` - Path resolution utilities
- `services/index.ts` - Unified exports

**Benefits**:
- Single point of Langium initialization
- Caching layer for performance
- Foundation for LSP migration

**Effort**: ~4 hours

---

### Phase 2: Methodology Subsystem Extraction

**Goal**: Extract shared methodology logic into reusable modules.

**Creates**:
- `methodology/core/playbook-loader.ts` - Unified playbook loading
- `methodology/core/schema-analyzer.ts` - Shared schema analysis
- `methodology/core/constraint-engine.ts` - Constraint validation
- `methodology/core/preference-engine.ts` - Preference management

**Refactors**:
- `methodology/tools/*.ts` - Use core modules instead of duplicating logic
- Removes ~40% code duplication in methodology tools

**Benefits**:
- DRY principle applied
- Easier testing (test core modules independently)
- Clearer business logic separation

**Effort**: ~6 hours

---

### Phase 3: Tool Auto-Registration & Plugin Pattern

**Goal**: Replace manual tool registration with plugin discovery.

**Creates**:
- `mcp/tool-registration.ts` - Dynamic tool discovery
- `mcp/plugin-metadata.ts` - Plugin metadata structure

**Pattern**:
```typescript
// Each tool file exports metadata
export const pluginMetadata = {
  name: 'create_concept',
  category: 'vocabulary/terms',      // Auto-discoverable
  phase: 'phase1',
  dependencies: ['validate_oml'],
  handler: createConceptHandler,
  tool: createConceptTool,
};

// Auto-discover from directory
const tools = discoverTools('./tools');
```

**Benefits**:
- No manual import/export in `index.ts`
- Tools can be conditionally registered
- Clearer dependencies

**Effort**: ~3 hours

---

### Phase 4: LSP-First Architecture (Decoupling from Langium Extension)

#### Phase 4a: Create LSP Client Wrapper

**Goal**: Replace direct Langium imports with LSP communication.

**Creates**:
- `services/lsp-client.ts` - LSP protocol wrapper
- `config.ts` - LSP endpoint configuration

**Key Design**:
```typescript
export interface LspClient {
  // Document operations
  parseDocument(uri: string): Promise<DocumentInfo>;
  validateFile(uri: string): Promise<Diagnostic[]>;
  
  // Symbol operations
  findReferences(symbol: string): Promise<Reference[]>;
  resolveSymbol(name: string, context: string): Promise<SymbolResolution>;
  
  // Document modifications (sent back to LSP)
  writeFile(uri: string, content: string): Promise<void>;
}

export class OmlLspClient implements LspClient {
  constructor(private endpoint: string) {}
  
  async parseDocument(uri: string): Promise<DocumentInfo> {
    // Send request to LSP server
    // LSP server returns: AST, diagnostics, symbols
    return await this.send('oml/parseDocument', { uri });
  }
}
```

**Migration Path**:
1. Tools currently import `createOmlServices()` directly
2. Change to: `const doc = await lspClient.parseDocument(uri)`
3. LSP server provides: AST, validation, symbol resolution
4. No tools need to create Langium services directly

**Benefits**:
- MCP server can run independently of Langium extension
- LSP server can be in different process/machine
- Supports cloud deployment without extension

**Effort**: ~8 hours

#### Phase 4b: Fallback/Offline Mode

**Goal**: Graceful degradation when LSP unavailable.

**Creates**:
- `services/offline-fallback.ts` - Limited operations offline
- Documentation of which tools require LSP

**Operations by Availability**:
- ✅ Read-only (always works): file operations, text manipulation
- ❌ Parse-dependent (needs LSP): symbol resolution, validation, impact analysis
- ⚠️ Mixed: create operations (can generate text, but validation requires LSP)

**Benefits**:
- Better error messages for missing LSP
- Clear user expectations
- Debug mode for testing

**Effort**: ~2 hours

#### Phase 4c: Update Deployment & Documentation

**Goal**: Document separate deployment architecture.

**Creates**:
- `DEPLOYMENT.md` - Architecture and deployment guide
- `docker-compose.yml` - Local dev environment
- `.env.example` - Configuration template
- Start scripts for both components

**Deployment Scenarios**:

```bash
# Scenario 1: Cloud (separate processes)
# Terminal 1: Run Langium LSP server
docker run -p 5007:5007 oml-langium-lsp

# Terminal 2: Run MCP server (connects to LSP)
docker run -e LSP_ENDPOINT=langium-lsp:5007 oml-mcp-server

# Scenario 2: Local development (both together)
npm run dev:extension    # Starts LSP on :5007
npm run dev:mcp          # Starts MCP, auto-connects to :5007

# Scenario 3: Just extension (no MCP)
npm run dev:extension
```

**Benefits**:
- Clear operational model
- Easy onboarding
- Supports multiple deployment topologies

**Effort**: ~3 hours

---

### Phase 5: Tool Organization by Modeling Layer

**Goal**: Organize tools into vocabulary and description subdirectories.

**Reorganization**:

```
vocabulary/
├── index.ts                # Exports all vocabulary tools
├── terms/                  # Term creation
│   ├── create-concept.ts
│   ├── create-aspect.ts
│   ├── create-relation.ts
│   └── ...
└── axioms/                 # Axiom management
    ├── add-specialization.ts
    ├── add-restriction.ts
    └── ...

description/
├── index.ts                # Exports all description tools
├── instances/              # Instance management
│   ├── create-concept-instance.ts
│   ├── create-relation-instance.ts
│   └── ...
└── query/                  # Moved from top-level (instance-focused)
    ├── suggest-oml-symbols.ts
    └── analyze-impact.ts
```

**Benefits**:
- Clear separation of concerns
- Easier for new developers to find tools
- Can have layer-specific shared utilities

**Effort**: ~1 hour (mostly file moves)

---

## Part 4: Tool Classification Reference

### Vocabulary Tools (Schema Layer)

These tools modify **vocabulary files** and define types.

| Category | Tools | Purpose |
|----------|-------|---------|
| **Terms** | create_concept, create_aspect, create_relation, create_relation_entity, create_scalar, create_scalar_property, create_annotation_property, delete_term, update_term | Define reusable types |
| **Axioms** | add_specialization, add_restriction, add_equivalence, update_*, delete_* | Define type constraints & relationships |

### Description Tools (Instance Layer)

These tools modify **description files** and create specific instances.

| Category | Tools | Purpose |
|----------|-------|---------|
| **Instances** | create_concept_instance, create_relation_instance, update_instance, delete_instance, update_property_value, delete_property_value, delete_type_assertion | Create/manage specific data |
| **Query** | suggest_oml_symbols, analyze_impact | Query instance contexts |

### Cross-Layer Tools

| Category | Tools | Purpose |
|----------|-------|---------|
| **Ontology** | create_ontology, add_import, delete_import, delete_ontology | Manage ontology files |
| **Rules** | create_rule, update_rule, delete_rule | Define logical rules |
| **Validation** | validate_oml | Check syntax/semantics |
| **Methodology** | extract_*, enforce_*, prepare_*, etc. | Guide consistent modeling |
| **Preferences** | set_preferences, get_preferences, log_feedback | User preferences |

---

## Part 5: Dependency Graph After Refactoring

```
tools/
├── validate_oml           (no dependencies on other tools)
├── suggest_oml_symbols    (→ services/lsp-client)
├── analyze_impact         (→ services/lsp-client)
│
├── vocabulary/terms/*     (→ common utilities, no tool-to-tool deps)
├── vocabulary/axioms/*    (→ common utilities, no tool-to-tool deps)
├── description/instances/* (→ common utilities, no tool-to-tool deps)
│
├── ontology/*             (→ common utilities)
├── rules/*                (→ common utilities)
│
├── methodology/tools/*    (→ methodology/core/*, services/*)
│   └── core/              (pure business logic, no I/O)
│
└── preferences/*          (→ preferences-state)
```

**Key Principle**: Tools don't call other tools. They use shared services and utilities.

---

## Part 6: Migration Checklist

- [ ] Phase 1: Create services layer
- [ ] Update all tools to import from `services/` instead of directly from `oml-module`
- [ ] Phase 2: Extract methodology core
- [ ] Phase 3: Implement tool auto-discovery
- [ ] Phase 4a: Create LSP client
- [ ] Migrate tools to use LSP client for document operations
- [ ] Phase 4b: Add offline fallback
- [ ] Update documentation with fallback limitations
- [ ] Phase 4c: Create deployment guide
- [ ] Test independent deployment scenarios
- [ ] Phase 5: Reorganize tools into vocabulary/description directories
- [ ] Update exports in `tools/index.ts`
- [ ] Update tool registration for new structure
- [ ] Run full test suite

---

## Part 7: Success Metrics

### After Phase 1-2:
- Zero direct imports of `oml-module` outside `services/`
- Methodology tests run without file I/O
- Code duplication in methodology tools < 10%

### After Phase 4:
- MCP server starts without Langium extension running (with graceful degradation)
- LSP client can connect to server in different process
- Clear documentation on what works offline vs. with LSP

### After Phase 5:
- New developers can find tools by layer (vocabulary vs. description)
- Tool documentation clearly states which layer each operates on
- Zero cross-layer tool dependencies

---

## Timeline Estimate

| Phase | Hours | Complexity |
|-------|-------|-----------|
| 1: Infrastructure | 4 | Low |
| 2: Methodology | 6 | Medium |
| 3: Auto-Registration | 3 | Medium |
| 4a: LSP Client | 8 | High |
| 4b: Offline Mode | 2 | Low |
| 4c: Deployment | 3 | Low |
| 5: Reorganization | 1 | Low |
| Testing & Fixes | 5 | Medium |
| **Total** | **32 hours** | **~4 days** |

---

## Next Steps

1. Start with Phase 1 (services layer) - foundation for everything else
2. Phase 1 unlocks parallel work on Phases 2-3
3. Complete Phase 4a before attempting Phase 4b-4c
4. Phase 5 is optional polish, can be done last

**Ready to begin? I recommend starting with Phase 1.**
