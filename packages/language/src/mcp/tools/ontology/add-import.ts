import { z } from 'zod';
import * as fs from 'fs';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../../oml-module.js';
import {
    pathToFileUri,
    fileUriToPath,
    writeFileAndNotify,
    detectIndentation,
} from '../common.js';
import { isVocabulary, isDescription, isVocabularyBundle, isDescriptionBundle } from '../../../generated/ast.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the ontology where the import will be added'),
    importKind: z.enum(['extends', 'uses', 'includes']).describe('Type of import statement'),
    targetOntologyPath: z.string().describe('File path to the ontology being imported'),
};

export const addImportTool = {
    name: 'add_import' as const,
    description: 'Adds an import statement (extends/uses/includes) to a vocabulary or description. Validates that the target ontology exists and uses its actual prefix.',
    paramsSchema,
};

export const addImportHandler = async (
    { ontology, importKind, targetOntologyPath }: { ontology: string; importKind: 'extends' | 'uses' | 'includes'; targetOntologyPath: string }
) => {
    try {
        // Load source ontology
        const sourceFileUri = pathToFileUri(ontology);
        const sourceFilePath = fileUriToPath(sourceFileUri);

        if (!fs.existsSync(sourceFilePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Source ontology not found at ${sourceFilePath}` }],
            };
        }

        const services = createOmlServices(NodeFileSystem);
        const sourceDocument = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(sourceFileUri));
        await services.shared.workspace.DocumentBuilder.build([sourceDocument], { validation: false });

        const sourceRoot = sourceDocument.parseResult.value;
        if (!isVocabulary(sourceRoot) && !isDescription(sourceRoot) && !isVocabularyBundle(sourceRoot) && !isDescriptionBundle(sourceRoot)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Source must be a vocabulary, description, vocabulary bundle, or description bundle' }],
            };
        }

        // Validate import kind based on ontology type
        if (isVocabulary(sourceRoot) && importKind !== 'extends' && importKind !== 'uses') {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Vocabularies can only use "extends" or "uses" imports' }],
            };
        }
        if (isVocabularyBundle(sourceRoot) && importKind !== 'extends' && importKind !== 'includes') {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Vocabulary bundles can only use "extends" or "includes" imports' }],
            };
        }
        if (isDescription(sourceRoot) && importKind !== 'extends' && importKind !== 'uses') {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Descriptions can only use "extends" or "uses" imports' }],
            };
        }
        if (isDescriptionBundle(sourceRoot) && importKind !== 'extends' && importKind !== 'includes') {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Description bundles can only use "extends" or "includes" imports' }],
            };
        }

        // Load target ontology to get namespace and prefix
        const targetFileUri = pathToFileUri(targetOntologyPath);
        const targetFilePath = fileUriToPath(targetFileUri);

        if (!fs.existsSync(targetFilePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Target ontology not found at ${targetFilePath}` }],
            };
        }

        const targetDocument = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(targetFileUri));
        await services.shared.workspace.DocumentBuilder.build([targetDocument], { validation: false });

        const targetRoot = targetDocument.parseResult.value;
        if (!isVocabulary(targetRoot) && !isDescription(targetRoot) && !isVocabularyBundle(targetRoot) && !isDescriptionBundle(targetRoot)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'Target must be a vocabulary, description, vocabulary bundle, or description bundle' }],
            };
        }

        const targetNamespace = targetRoot.namespace;
        // Read target text to capture the exact prefix token (including leading ^ if present)
        const targetText = fs.readFileSync(targetFilePath, 'utf-8');
        const prefixMatch = targetText.match(/\bas\s+([^\s{]+)/);
        const targetPrefix = prefixMatch ? prefixMatch[1] : targetRoot.prefix;

        // Check if import already exists
        const existingImports = sourceRoot.ownedImports || [];
        const alreadyExists = existingImports.some(imp => {
            const importedNs = imp.imported.ref?.namespace;
            return importedNs === targetNamespace && imp.kind === importKind;
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
        
        const importStatement = `${indent}${importKind} ${formattedNamespace} as ${targetPrefix}${eol}`;

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
