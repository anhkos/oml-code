# OML Code

A language server and tooling for OML (Ontological Modeling Language), providing editor support, validation, and AI-assisted ontology authoring via the Model Context Protocol (MCP).

## Packages

- [packages/language](./packages/language/README.md) - Core language definition, parsing, validation, and MCP server
- [packages/cli](./packages/cli/README.md) - Command-line interface
- [packages/extension](./packages/extension/langium-quickstart.md) - VS Code extension

## MCP Server

The MCP server enables AI assistants to create and modify OML ontologies programmatically. It provides tools for creating vocabularies, descriptions, instances, and managing imports automatically.

See the **[MCP Server Documentation](./packages/language/src/mcp/README.md)** for:
- Available tools and their usage
- Configuration and environment variables
- Key OML concepts (vocabularies vs descriptions)
- Development guide for adding new tools

## Project Structure

- [package.json](./package.json) - Workspace manifest
- [tsconfig.json](./tsconfig.json) - Base TypeScript configuration
- [tsconfig.build.json](./tsconfig.build.json) - Build configuration
- [.gitignore](.gitignore) - Git ignore rules
