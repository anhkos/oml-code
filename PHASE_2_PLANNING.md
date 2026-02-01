# Phase 2: Methodology Subsystem Extraction - Planning Guide

## Overview

Phase 2 focuses on extracting shared methodology logic from tools into reusable business logic modules. This is the longest phase (6 hours) but provides the most coupling reduction.

## Current Methodology Tool Structure

```
methodology/
├── ensure-imports.ts
├── add-to-bundle.ts
├── smart-create-vocabulary.ts
├── generate-vocabulary-bundle.ts
├── clarify-methodology-preferences.ts
├── extract-methodology-rules.ts          ← Complex, ~350 lines
├── enforce-methodology-rules.ts          ← Complex, ~1200 lines
├── extract-description-schemas.ts        ← Complex, ~400 lines
├── route-instance.ts
├── update-playbook.ts
├── list-playbook-constraints.ts
├── prepare-instance.ts                   ← Moderate, ~150 lines
├── analyze-request.ts
├── playbook-helpers.ts                   ← Utilities, ~500 lines
├── playbook-types.ts                     ← Type definitions
└── rule-engine.ts                        ← Constraint logic, ~200 lines
```

## Duplication Analysis

### 1. **Playbook Loading** (~60 lines duplicated in 4 files)
**Files Affected**:
- `enforce-methodology-rules.ts` - loads playbook
- `extract-description-schemas.ts` - loads playbook
- `prepare-instance.ts` - loads playbook
- `route-instance.ts` - loads playbook

**Current State**: Uses `playbook-helpers.ts` functions
**Target**: Extract to `methodology/core/playbook-loader.ts`

### 2. **Schema Analysis** (~120 lines duplicated in 3 files)
**Files Affected**:
- `extract-methodology-rules.ts` - parses vocabulary concepts/relations
- `extract-description-schemas.ts` - analyzes description instances
- `clarify-methodology-preferences.ts` - examines vocabulary structure

**Current State**: Scattered throughout files
**Target**: Extract to `methodology/core/schema-analyzer.ts`

### 3. **Constraint Validation** (~80 lines duplicated in 2 files)
**Files Affected**:
- `enforce-methodology-rules.ts` - validates constraints
- `rule-engine.ts` - evaluates constraints

**Current State**: Partial extraction in `rule-engine.ts`
**Target**: Consolidate to `methodology/core/constraint-engine.ts`

### 4. **Preference Management** (~40 lines duplicated in 3 files)
**Files Affected**:
- `clarify-methodology-preferences.ts` - manages decisions
- `extract-methodology-rules.ts` - uses preferences
- `prepare-instance.ts` - applies preferences

**Current State**: Scattered logic
**Target**: Extract to `methodology/core/preference-engine.ts`

## Phase 2 Implementation Plan

### Step 1: Create Core Modules (2 hours)

```
methodology/core/
├── playbook-loader.ts
│   - loadPlaybook(path, autoDetect?)
│   - findPlaybook(dir, maxDepth?)
│   - resolvePlaybookPath(params)
│
├── schema-analyzer.ts
│   - analyzeVocabulary(filePath)
│   - analyzeDescription(filePath)
│   - extractConcepts(vocabulary)
│   - extractRelations(vocabulary)
│   - inferSchema(analysis)
│
├── constraint-engine.ts
│   - validateConstraint(value, constraint)
│   - evaluatePredicate(predicate, context)
│   - checkPropertyConstraints(instance, schema)
│
├── preference-engine.ts
│   - getPreference(key)
│   - setPreference(key, value)
│   - applyPreferences(rule)
│
├── types.ts (re-export from playbook-types.ts)
└── index.ts (unified exports)
```

### Step 2: Refactor Tools to Use Core (2 hours)

**Tool**: `enforce-methodology-rules.ts`
```diff
- import { loadPlaybook, findPlaybook } from './playbook-helpers.js';
+ import { loadPlaybook, findPlaybook } from './core/playbook-loader.js';

- const violations = validateConstraints(instance, schema);
+ import { enforceConstraints } from './core/constraint-engine.js';
+ const violations = enforceConstraints(instance, schema);
```

**Tool**: `extract-description-schemas.ts`
```diff
- async function analyzeDescription(filePath)
+ import { analyzeDescription } from './core/schema-analyzer.js';
```

**Tool**: `extract-methodology-rules.ts`
```diff
- async function analyzeVocabulary(filePath)
+ import { analyzeVocabulary } from './core/schema-analyzer.js';
```

### Step 3: Unit Test Core Modules (1 hour)

Create `tests/methodology-core.test.ts`:
```typescript
describe('Playbook Loader', () => {
  it('loads and parses playbook YAML', () => {
    const pb = loadPlaybook('./test-playbook.yaml');
    expect(pb.schemas).toBeDefined();
  });
});

describe('Schema Analyzer', () => {
  it('extracts concepts from vocabulary', async () => {
    const concepts = await extractConcepts('./test-vocab.oml');
    expect(concepts.length).toBeGreaterThan(0);
  });
});

describe('Constraint Engine', () => {
  it('validates scalar constraints', () => {
    const result = validateConstraint('hello', { type: 'string', minLength: 3 });
    expect(result.valid).toBe(true);
  });
});
```

### Step 4: Verification & Optimization (1 hour)

- Verify all tests pass
- Check test coverage
- Profile for performance
- Document APIs

## Expected Outcomes

### Code Metrics
- **Before**: 4000+ lines of methodology tools
- **After**: ~2500 lines of tools + 1500 lines of core
- **Duplication**: Reduced from 280 lines to <50 lines
- **Testability**: 90% of logic unit testable

### Architecture Benefits
- ✅ Core logic decoupled from file I/O
- ✅ Easier to test (mock constraints, not files)
- ✅ Cleaner tool implementations (smaller, focused)
- ✅ Foundation for Phase 4 (LSP migration)

### Example: Before vs. After

**Before** (enforce-methodology-rules.ts line ~200):
```typescript
// Complex logic mixed with file I/O
const violations: PlaybookViolation[] = [];
for (const constraint of schema.constraints) {
  if (constraint.type === 'propertyRequired') {
    if (!instance.ownedPropertyValues?.find(pv => pv.property?.ref?.name === constraint.property)) {
      violations.push({
        message: `Missing required property: ${constraint.property}`,
        constraint,
      });
    }
  } else if (constraint.type === 'relationDirection') {
    // More complex logic...
  }
}
```

**After** (enforce-methodology-rules.ts line ~30):
```typescript
// Clean separation of concerns
import { enforceConstraints } from './core/constraint-engine.js';
const violations = enforceConstraints(instance, schema);
```

**New** (methodology/core/constraint-engine.ts):
```typescript
export function enforceConstraints(instance: NamedInstance, schema: DescriptionSchema): PlaybookViolation[] {
  const violations: PlaybookViolation[] = [];
  
  for (const constraint of schema.constraints) {
    const result = validateConstraint(instance, constraint);
    if (!result.valid) {
      violations.push(result.violation);
    }
  }
  
  return violations;
}

function validateConstraint(instance: NamedInstance, constraint: DescriptionConstraint) {
  switch (constraint.type) {
    case 'propertyRequired': return validatePropertyRequired(instance, constraint);
    case 'relationDirection': return validateRelationDirection(instance, constraint);
    // ...
  }
}
```

## Dependencies Between Core Modules

```
playbook-loader.ts
    ↓ (needs type definitions)
types.ts (re-exports from playbook-types.ts)
    ↑
    ├─ schema-analyzer.ts (uses types)
    ├─ constraint-engine.ts (uses types)
    └─ preference-engine.ts (uses types)

All tools import from:
    methodology/core/index.ts
```

## Ready for Phase 2?

✅ **Yes** - Phase 1 complete, services layer stable
- Phase 1 took 2 hours (under estimate)
- Phase 2 can start immediately
- Recommended timeline: ~6 hours

**Next Step**: Start extracting playbook-loader.ts (Phase 2, Step 1)
