import { z } from 'zod';
import * as fs from 'fs';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import {
    pathToFileUri,
    fileUriToPath,
    writeFileAndNotify,
    detectIndentation,
    escapePrefix,
    getFreshDocument,
} from '../common.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the ontology where the import will be added. Use the full path from the open file.'),
    importKind: z.enum(['extends', 'uses']).optional().describe('Type of import statement. If omitted, the tool will choose "extends" for vocabularies/bundles and "uses" for descriptions/description bundles.'),
    targetOntologyPath: z.string().describe('ABSOLUTE file path to the ontology being imported. Use the full path, not relative paths.'),
};

export const addImportTool = {
    name: 'add_import' as const,
    description: `Adds an extends/uses import statement to an ontology. Validates that the target ontology exists.

IMPORTANT: Use ABSOLUTE file paths for both ontology and targetOntologyPath parameters.
If you don't know the exact path to the target ontology, use ensure_imports instead - it auto-discovers workspace vocabularies by prefix.

For most cases, prefer ensure_imports over add_import as it handles path resolution automatically.`,
    paramsSchema,
};

export const addImportHandler = async (
    { ontology, importKind, targetOntologyPath }: { ontology: string; importKind?: 'extends' | 'uses'; targetOntologyPath: string }
) => {
    try {
        // Load source ontology
        const sourceFileUri = pathToFileUri(ontology);
        const sourceFilePath = fileUriToPath(sourceFileUri);

        if (!fs.existsSync(sourceFilePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Source ontology not found.\n\nProvided: ${ontology}\nResolved to: ${sourceFilePath}\n\nTIP: Use the absolute file path from the open file, not a relative path.` }],
            };
        }

        const services = createOmlServices(NodeFileSystem);
        // Use getFreshDocument to ensure we read the current content from disk
        const sourceDocument = await getFreshDocument(services, sourceFileUri);

        const sourceRoot = sourceDocument.parseResult.value;
        if (!isVocabulary(sourceRoot) && !isDescription(sourceRoot) && !isVocabularyBundle(sourceRoot) && !isDescriptionBundle(sourceRoot)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Source must be a vocabulary, description, vocabulary bundle, or description bundle' }],
            };
        }

        const resolvedImportKind: 'extends' | 'uses' =
            isVocabulary(sourceRoot) || isVocabularyBundle(sourceRoot) ? 'extends' : 'uses';

        // Load target ontology to get namespace and prefix
        const targetFileUri = pathToFileUri(targetOntologyPath);
        const targetFilePath = fileUriToPath(targetFileUri);

        if (!fs.existsSync(targetFilePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Target ontology not found.\n\nProvided: ${targetOntologyPath}\nResolved to: ${targetFilePath}\n\nTIP: Use ensure_imports instead - it auto-discovers workspace vocabularies by prefix and handles path resolution automatically.` }],
            };
        }

        // Use getFreshDocument to ensure we read the current content from disk
        const targetDocument = await getFreshDocument(services, targetFileUri);

        const targetRoot = targetDocument.parseResult.value;
        if (!isVocabulary(targetRoot) && !isDescription(targetRoot) && !isVocabularyBundle(targetRoot) && !isDescriptionBundle(targetRoot)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Target must be a vocabulary, description, vocabulary bundle, or description bundle' }],
            };
        }

        const targetNamespace = targetRoot.namespace;
        const sourceNamespace = sourceRoot.namespace;
        
        // Check for self-import (importing a file into itself)
        if (targetNamespace === sourceNamespace) {
            return {
                content: [{ type: 'text' as const, text: `⚠ Skipping self-import: The vocabulary already defines prefix "${sourceRoot.prefix}" - no import needed for references to its own terms.` }],
            };
        }
        
        // Read target text to capture the exact prefix token (including leading ^ if present)
        const targetText = fs.readFileSync(targetFilePath, 'utf-8');
        const prefixMatch = targetText.match(/\bas\s+([^\s{]+)/);
        let targetPrefix = prefixMatch ? prefixMatch[1] : targetRoot.prefix;
        
        // Escape the prefix if it's a reserved keyword and not already escaped
        targetPrefix = escapePrefix(targetPrefix);

        // Check if import already exists
        const existingImports = sourceRoot.ownedImports || [];
        const alreadyExists = existingImports.some(imp => {
            const importedNs = imp.imported.ref?.namespace;
            return importedNs === targetNamespace && imp.kind === resolvedImportKind;
        });

        if (alreadyExists) {
            return {
                content: [{ type: 'text' as const, text: `✓ Import already exists: ${importKind} <${targetNamespace}> as ${targetPrefix}` }],
            };
        }

        // Read source file content
        const sourceText = fs.readFileSync(sourceFilePath, 'utf-8');
        const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';
        const indent = detectIndentation(sourceText);

        // Construct import statement with proper formatting
        const formattedNamespace = targetNamespace.startsWith('<') && targetNamespace.endsWith('>') 
            ? targetNamespace 
            : `<${targetNamespace}>`;
        
        const importStatement = `${indent}${resolvedImportKind} ${formattedNamespace} as ${targetPrefix}${eol}`;

        // Find insertion point: after opening brace, before any existing statements
        const lines = sourceText.split(/\r?\n/);
        let insertLineIndex = -1;
        let inOntology = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            
            // Look for vocabulary/description declaration with opening brace
            if (trimmed.includes('vocabulary') || trimmed.includes('description')) {
                inOntology = true;
            }
            
            if (inOntology && trimmed.includes('{')) {
                // Found opening brace, next line is where we insert
                insertLineIndex = i + 1;
                
                // If next line already has imports, find the end of imports section
                let j = insertLineIndex;
                while (j < lines.length) {
                    const nextTrimmed = lines[j].trim();
                    if (nextTrimmed.startsWith('extends') || nextTrimmed.startsWith('uses') || nextTrimmed.startsWith('includes')) {
                        insertLineIndex = j + 1;
                        j++;
                    } else if (nextTrimmed === '') {
                        // Skip blank lines in import section
                        j++;
                    } else {
                        // Hit a non-import, non-blank line
                        break;
                    }
                }
                insertLineIndex = j;
                break;
            }
        }

        if (insertLineIndex === -1) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Could not find insertion point in ontology file' }],
            };
        }

        // Insert the import statement
        lines.splice(insertLineIndex, 0, importStatement.trimEnd());
        const newContent = lines.join(eol);

        await writeFileAndNotify(sourceFilePath, sourceFileUri, newContent);

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Added import to ontology\n\nGenerated statement:\n${importStatement.trim()}`,
                },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Error adding import: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
