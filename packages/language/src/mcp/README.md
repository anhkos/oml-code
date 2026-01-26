# OML MCP Server

A Model Context Protocol (MCP) server that provides tools for creating, modifying, and managing OML (Ontological Modeling Language) ontologies programmatically.

## Overview

The OML MCP Server exposes a comprehensive set of tools that allow AI assistants and other MCP clients to manipulate OML files. It handles workspace discovery, symbol resolution, import management, and validation automatically.

## Configuration

### Environment Variables

- `OML_WORKSPACE_ROOT` - Sets the workspace root directory. If not set, the server uses the current working directory.

### Running the Server

The server communicates over stdio using the MCP protocol:

```bash
node packages/language/src/mcp/server.js
```

Or via the compiled output after building:

```bash
npm run build
node out/language/src/mcp/server.js
```

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

| Tool | Description |
|------|-------------|
| `ensure_imports` | Ensures all required imports are present |
| `add_to_bundle` | Adds ontologies to a bundle |
| `smart_create_vocabulary` | Creates a vocabulary with automatic imports |
| `generate_vocabulary_bundle` | Generates a bundle for vocabularies |

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
