# OML MCP Server

A Model Context Protocol (MCP) server that provides tools for creating, modifying, and managing OML (Ontological Modeling Language) ontologies programmatically.

## What is the OML MCP Server?

The OML MCP Server is an AI-native tool that bridges OML ontologies and AI assistants through the Model Context Protocol standard. It enables:

- **Programmatic Ontology Manipulation**: Create, read, update, and delete OML ontology components (concepts, relations, instances, etc.)
- **Intelligent Symbol Resolution**: Automatically resolve cross-references and manage imports across your workspace
- **Methodology Enforcement**: Define and enforce modeling conventions across your entire ontology
- **Semantic Validation**: Validate OML syntax, semantics, and consistency rules
- **AI-Driven Development**: Work with AI assistants to design and evolve your ontologies interactively

### Key Capabilities

- **Specialized tools** for ontology engineering workflows
- **Bidirectional relation handling** with direction preferences
- **Methodology playbooks** for consistent modeling patterns (e.g., Sierra methodology)
- **Automatic import management** and symbol resolution across workspaces
- **Comprehensive error handling** with remediation suggestions

## Setup Instructions

### Prerequisites

- Node.js 18+ (or compatible runtime)
- OML language package built (`npm run build` in the root workspace)
- An OML workspace with vocabulary and/or description files

### Installation

1. **Build the entire OML workspace** (if not already built):
```bash
cd c:\Users\sokhn\OneDrive\Documents\GitHub\oml-code
npm run build
```

2. **Start the MCP server** in one of two ways:

**Option A: Direct execution** (for development/testing)
```bash
node packages/language/src/mcp/server.js
```

**Option B: Via compiled output** (after building)
```bash
npm run build
node out/language/src/mcp/server.js
```

3. **Configure your MCP client** to connect to the server over stdio

### Environment Setup

The server respects the following environment variables:

- `OML_WORKSPACE_ROOT` - Set the root directory for your OML workspace
  ```bash
  set OML_WORKSPACE_ROOT=c:\Users\sokhn\OneDrive\Documents\GitHub\sierra-method
  node packages/language/src/mcp/server.js
  ```

If not set, the server uses the current working directory.

### Testing the Server

Once running, you can test the server by calling a simple tool through your MCP client. For instance, with an OML file open, you can ask GitHub Copilot: "Can you validate my OML code with MCP tools?"

```json
{
  "tool": "validate_oml",
  "params": {
    "uri": "path/to/your/file.oml"
  }
}
```

Expected response: Validation results with any syntax/semantic errors found.

## Getting MCP Clients to Use the Tools

### The Challenge

MCP clients (like GitHub Copilot) have powerful tools available, but nudging them to use the tools can be a bit tricky. AI assistants are designed to be helpful and can solve many problems through reasoning alone, so without proper guidance, they may not reach for MCP tools even when they would be most effective.

### Best Practices

**Use explicit instructions in your prompts:**
- "Use the OML MCP tools" (usually works best, can state this at the beginning of a chat)
- "Call the enforce_methodology_rules tool to check this against the playbook"
- "Use create_concept_instance to add this to the ontology"

**Set context in your system prompt / Copilot instructions:**
- List which tools are available and their purposes
- Give examples of when each tool should be used
- Explain that tools should be used for code generation and validation

**Provide tool hints in user messages:**
- "I need to validate this OML file. Can you use the validate oml tool?"
- "Create a new concept using the create_concept tool"

### Coming Soon: Complete Guide

I will write a comprehensive guide on prompting strategies and Copilot instructions soon. In the meantime, experiment with explicit tool requests and observe which prompts get the best results.

## Overview

## Configuration

### Workflow Modes (Dynamic Tool Exposure)

The server supports two workflow modes to reduce tool overload and keep prompts focused:

- **`basic` (default):** core OML modeling tools (terms, axioms, instances, ontology, rules, validation/query)
- **`methodology`:** enables methodology-editing tools for playbook creation/enforcement workflows

Set mode with `set_preferences`:

```json
{
  "tool": "set_preferences",
  "params": {
    "workflowMode": "basic"
  }
}
```

Enable methodology mode when you are explicitly editing methodology/playbook assets:

```json
{
  "tool": "set_preferences",
  "params": {
    "workflowMode": "methodology"
  }
}
```

If a methodology tool is called while in `basic` mode, the server returns a clear message asking you to switch modes first.

## Tool Categories

### Validation and Query Tools

| Tool | Description |
|------|-------------|
| `validate_oml` | Validates OML code for syntax and semantic errors |
| `suggest_oml_symbols` | Searches for available OML symbols in the workspace |
| `analyze_impact` | Previews the impact of deleting a symbol across the workspace |

### Term Creation Tools

Tools for creating vocabulary terms (concepts, aspects, relations, properties).

| Tool | Description |
|------|-------------|
| `create_aspect` | Creates an aspect in a vocabulary |
| `create_concept` | Creates a concept with optional keys and instance enumeration |
| `create_relation_entity` | Creates a relation entity with source/target types |
| `create_relation` | Creates an unreified relation |
| `create_scalar` | Creates a scalar type with optional literal enumeration |
| `create_scalar_property` | Creates a scalar property with domain and range |
| `create_annotation_property` | Creates an annotation property |
| `delete_term` | Deletes a term from a vocabulary |
| `update_term` | Updates/renames a term |

### Axiom Tools

Tools for managing specializations, restrictions, equivalences, and annotations.

| Tool | Description |
|------|-------------|
| `add_specialization` | Adds super terms to a term's specialization clause |
| `delete_specialization` | Removes a super term from specialization |
| `add_restriction` | Adds a property restriction to an entity |
| `update_restriction` | Updates an existing restriction |
| `delete_restriction` | Removes a restriction |
| `add_equivalence` | Adds an equivalence axiom to a term |
| `update_equivalence` | Updates an equivalence axiom |
| `delete_equivalence` | Removes an equivalence axiom |
| `update_annotation` | Updates annotations on a term |
| `delete_annotation` | Removes an annotation |
| `update_key` | Updates key axioms on an entity |
| `delete_key` | Removes a key axiom |

### Instance Tools

Tools for managing instances in description ontologies.

| Tool | Description |
|------|-------------|
| `create_concept_instance` | Creates a concept instance with types and properties |
| `create_relation_instance` | Creates a relation instance with sources/targets |
| `update_instance` | Updates an instance (name, types, properties) |
| `delete_instance` | Deletes an instance |
| `update_property_value` | Updates property values on an instance |
| `delete_property_value` | Removes a property value |
| `delete_type_assertion` | Removes a type assertion from an instance |

### Ontology Management Tools

Tools for creating and managing ontology files.

| Tool | Description |
|------|-------------|
| `create_ontology` | Creates a new vocabulary, bundle, or description |
| `add_import` | Adds an import statement to an ontology |
| `delete_import` | Removes an import statement |
| `delete_ontology` | Deletes an ontology file |

### Rule Tools

Tools for managing SWRL-style rules.

| Tool | Description |
|------|-------------|
| `create_rule` | Creates a rule with antecedents and consequents |
| `update_rule` | Updates an existing rule |
| `delete_rule` | Deletes a rule |

### Methodology Tools

Higher-level tools for common workflows.

> These are gated by workflow mode and require `workflowMode: "methodology"`.

**Hybrid recommendation:** keep parser/deterministic tools in MCP, and prefer agent skill orchestration for playbook-driven routing/preparation/preflight logic.

| Tool | Description |
|------|-------------|
| `ensure_imports` | Ensures all required imports are present |
| `add_to_bundle` | Adds ontologies to a bundle |
| `smart_create_vocabulary` | Creates a vocabulary with automatic imports |
| `generate_vocabulary_bundle` | Generates a bundle for vocabularies |
| `clarify_methodology_preferences` | Interactively extract relations and collect voice/direction preferences |
| `extract_methodology_rules` | Generates a "Playbook" from vocabulary files for consistent modeling |
| `enforce_methodology_rules` | Validates descriptions against a methodology playbook |


#### Understanding the Methodology Playbook System

The playbook tools enable **methodology-driven modeling** - the ability to define and enforce consistent modeling patterns across your entire ontology. This is essential for large teams working on complex systems.

**The Three-Step Workflow:**

**Step 1: Clarify Preferences** (`clarify_methodology_preferences`)
- Extracts all bidirectional relations from your vocabulary files
- Presents them to you with clear active/passive voice alternatives
- Collects your preference for each relation pair
- Returns a structured preference object

Example: For the relation `requirement:expresses` ↔ `requirement:isExpressedBy`:
- **Active voice** (forward): `Stakeholder expresses Requirement`
- **Passive voice** (reverse): `Requirement isExpressedBy Stakeholder`

You choose which direction your team prefers, based on domain semantics.

**Step 2: Extract Methodology Rules** (`extract_methodology_rules`)
- Reads your vocabulary files (concepts, relations, constraints)
- Applies your voice/direction preferences
- Generates a machine-readable YAML playbook that codifies your methodology
- The playbook captures:
  - Bidirectional relation rules (forward name, reverse name, preferred direction)
  - Relation entity rules (reified relations with complex structure)
  - Concept rules (key axioms, required properties)

**Step 3: Enforce Rules During Modeling** (`enforce_methodology_rules`)
- Validates description files against your playbook
- Detects violations (e.g., using wrong relation direction)
- Generates detailed violation reports with:
  - Exact line number and instance name
  - Explanation of the violation
  - Suggested corrections
- Can optionally auto-transform code to canonical form

**Complete Example Workflow:**

```bash
# 1. Extract relations and collect preferences
clarify_methodology_preferences(
  vocabularyFiles: [
    "sierra/base.oml",
    "sierra/requirement.oml", 
    "sierra/stakeholder.oml"
  ]
)
# Output: List of relations with voice options

# User response: Prefer passive voice

# 2. Generate playbook
extract_methodology_rules(
  vocabularyFiles: [
    "sierra/base.oml",
    "sierra/requirement.oml", 
    "sierra/stakeholder.oml"
  ],
  methodologyName: "Sierra",
  preferences: {
    voicePreference: "passive",
    specificChoices: {
      "expresses": "reverse",
      "refines": "reverse",
      "allocates": "forward"
    }
  },
  outputPath: "sierra/methodology_playbook.yaml"
)
# Output: sierra/methodology_playbook.yaml (YAML file with all rules)

# 3. Enforce during description authoring
enforce_methodology_rules(
  playbookPath: "sierra/methodology_playbook.yaml",
  descriptionPath: "my-system-requirements.oml",
  mode: "validate"
)
# Output: Validation results, violations, and suggested corrections
```

**Example Playbook Structure:**

```yaml
metadata:
  methodology: "Sierra"
  version: "1.0"
  voicePreference: "passive"
  generatedFrom:
    - "sierra/base.oml"
    - "sierra/requirement.oml"

relationRules:
  - forwardRelation: "expresses"
    reverseRelation: "isExpressedBy"
    owningConcept: "Requirement"
    preferredDirection: "reverse"
    explanation: "Requirements are expressed by stakeholders (passive voice)"
    
  - forwardRelation: "refines"
    reverseRelation: "isRefinedBy"
    owningConcept: "Requirement"
    preferredDirection: "reverse"
    explanation: "Requirements are refined by other requirements (passive voice)"
    
  - forwardRelation: "allocates"
    reverseRelation: "isAllocatedBy"
    owningConcept: "Actor"
    preferredDirection: "forward"
    explanation: "Actors actively allocate requirements (active voice)"
```

**Example Violation Report:**

```
⚠️ Found 1 violation of the Sierra methodology

WRONG_RELATION_DIRECTION
❌ expresses ↔ isExpressedBy
On line 12, instance SafetyOfficer uses: requirement:expresses R2
Should use: requirement:isExpressedBy instead

Suggested Correction:
Remove from SafetyOfficer:
    requirement:expresses R2
    
Add to R2:
    requirement:isExpressedBy SafetyOfficer
```

**Why This Matters:**

- **Consistency**: Ensures all models follow the same patterns
- **Understandability**: Teams know exactly which direction to use for each relation
- **Automation**: AI assistants can automatically enforce rules and suggest corrections
- **Evolution**: As methodology evolves, update the playbook and re-validate all descriptions
- **Documentation**: The playbook serves as executable methodology documentation

**Technical Details:**

The playbook system works by:
1. Building a bidirectional lookup map for all relations (forward → rule, reverse → rule)
2. Parsing each description file to extract property assertions
3. For each assertion, checking if it uses the preferred direction
4. Reporting violations with exact locations and suggesting corrections

See the methodology tools section in [IDEAS.md](./IDEAS.md) for implementation notes.

### Preference Tools

Tools for managing user preferences and feedback.

| Tool | Description |
|------|-------------|
| `get_preferences` | Retrieves current user preferences |
| `set_preferences` | Sets user preferences |
| `log_feedback` | Logs feedback on tool executions |

## Key Concepts

### Vocabularies vs Descriptions

- **Vocabulary**: Defines terms (concepts, aspects, relations, properties). Use for schema/ontology definitions.
- **Description**: Contains instances of vocabulary terms. Use for data/assertions.
- **Bundle**: Aggregates multiple ontologies.

### Symbol Resolution

The server automatically resolves symbols across the workspace. When you reference a type like `requirement:Stakeholder`, the server:

1. Searches all loaded ontologies for the symbol
2. Verifies the symbol exists and is the correct type
3. Returns helpful errors if the symbol is not found

### Import Management

Many tools automatically handle imports. When you reference a symbol from another ontology, the server can add the required import statement.

### Type Assertions vs Properties

In OML, instance types are declared in the instance header, not as properties:

```oml
// Correct - types in declaration
instance MyInstance : Type1, Type2 [
    property value
]

// Wrong - rdf:type is not a property in OML
instance MyInstance [
    rdf:type Type1  // This does not work
]
```

To add types to an existing instance, use `update_instance` with `newTypes`.

## Error Handling

The server provides detailed error messages with guidance:

- **Instance already exists**: Redirects to `update_instance`
- **Wrong property (rdf:type)**: Explains OML type system and redirects to `update_instance`
- **Ontology not found**: Suggests creating the ontology first
- **Wrong ontology type**: Explains vocabulary vs description distinction
- **Symbol not found**: Lists similar symbols that exist in the workspace

## Architecture

```
mcp/
  server.ts           # Main MCP server entry point
  tools/
    index.ts          # Tool registration and exports
    common.ts         # Shared utilities (workspace, documents)
    description-common.ts  # Description-specific utilities
    schemas.ts        # Zod schemas for parameters
    types.ts          # TypeScript type definitions
    validate-tool.ts  # OML validation tool
    
    terms/            # Term creation tools
    axioms/           # Axiom management tools
    instances/        # Instance tools
    ontology/         # Ontology management tools
    rules/            # Rule tools
    query/            # Query and search tools
    methodology/      # High-level workflow tools
    preferences/      # User preference tools
    stubs/            # Placeholder tools (pending implementation)
```

## Development

### Building

```bash
npm run build
```

### Testing

The server integrates with the OML language server for parsing and validation. Ensure the language package is built before running the MCP server.

### Adding New Tools

1. Create a tool file in the appropriate category folder
2. Export `toolName` (tool definition) and `toolNameHandler` (implementation)
3. Add to the category's `index.ts`
4. The tool will automatically be registered with the MCP server

Tool definition structure:

```typescript
import { z } from 'zod';

const paramsSchema = {
    param1: z.string().describe('Description of param1'),
    param2: z.number().optional().describe('Optional param2'),
};

export const myTool = {
    name: 'my_tool' as const,
    description: 'What the tool does and when to use it',
    paramsSchema,
};

export const myToolHandler = async (params: { param1: string; param2?: number }) => {
    // Implementation
    return {
        content: [{ type: 'text' as const, text: 'Result message' }],
    };
};
```
