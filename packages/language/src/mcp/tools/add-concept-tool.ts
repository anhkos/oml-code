import { z } from 'zod';
import * as fs from 'fs';
import { URI } from 'langium';
import * as path from 'path';
import { createOmlServices } from '../../oml-module.js';
import { NodeFileSystem } from 'langium/node';
import { Vocabulary, isVocabulary } from '../../generated/ast.js';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { LSP_BRIDGE_PORT, pathToFileUri, fileUriToPath } from './common.js';

const addConceptParamsSchema = {
    uri: z.string().describe('File path to the OML vocabulary document'),
    conceptName: z.string().describe('Name of the new concept to add (e.g., "Vehicle", "Person")'),
    superConcepts: z.array(z.string()).optional().describe('Optional array of parent concept names that this concept specializes. Use simple names for concepts in the same vocabulary, or qualified names (prefix:Name) for imported concepts. Example: ["Vehicle"] or ["mission:Equipment"]'),
};

export const addConceptTool = {
    name: 'add_concept' as const,
    description: 'Adds a new concept definition to an OML vocabulary file. Only adds the concept declaration - does not add properties, relations, or other axioms. If superConcepts are provided, they must already exist in the vocabulary or be qualified references to imported vocabularies.',
    paramsSchema: addConceptParamsSchema,
};

export const addConceptHandler = async (
    { uri, conceptName, superConcepts }: { uri: string; conceptName: string; superConcepts?: string[] }
) => {
    console.error(`[add_concept] Starting with uri=${uri}, conceptName=${conceptName}`);
    
    const fileUri = pathToFileUri(uri);
    const filePath = fileUriToPath(fileUri);

    console.error(`[add_concept] Resolved to filePath=${filePath}`);

    try {
        // 1. Check if file exists
        if (!fs.existsSync(filePath)) {
            console.error(`[add_concept] File not found: ${filePath}`);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: File not found at ${filePath}`,
                    },
                ],
                isError: true,
            };
        }

        // 2. Load and parse the OML file using the language services
        console.error(`[add_concept] Loading document...`);
        const services = createOmlServices(NodeFileSystem);
        const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(fileUri));
        await services.shared.workspace.DocumentBuilder.build([document], { validation: false });

        console.error(`[add_concept] Document loaded, checking if vocabulary...`);
        const root = document.parseResult.value;

        if (!isVocabulary(root)) {
            console.error(`[add_concept] Not a vocabulary, root type: ${(root as any)?.$type}`);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: File is not a vocabulary. Only vocabularies can contain concepts.`,
                    },
                ],
                isError: true,
            };
        }

        const vocabulary = root as Vocabulary;

        // 3. Check if concept already exists
        const existingConcept = vocabulary.ownedStatements.find(
            (stmt: any) => stmt.$type === 'Concept' && stmt.name === conceptName
        );

        if (existingConcept) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: Concept '${conceptName}' already exists in the vocabulary.`,
                    },
                ],
                isError: true,
            };
        }

        // 4. Validate super concepts exist (if any provided)
        if (superConcepts && superConcepts.length > 0) {
            const missingConcepts: string[] = [];
            for (const superConcept of superConcepts) {
                // Check if it's a simple name (no prefix or IRI markers)
                const isSimpleName = !superConcept.includes(':') && !superConcept.startsWith('<');
                
                if (isSimpleName) {
                    // For simple names, verify the concept exists in this vocabulary
                    const exists = vocabulary.ownedStatements.some(
                        (stmt: any) => 
                            (stmt.$type === 'Concept' || stmt.$type === 'Aspect') && 
                            stmt.name === superConcept
                    );
                    if (!exists) {
                        missingConcepts.push(superConcept);
                    }
                }

            }

            if (missingConcepts.length > 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Error: The following parent concepts are not defined in this vocabulary: ${missingConcepts.join(', ')}\n\nTo fix this, either:\n- Add these concepts first using add_concept\n- Use qualified names if they're from imported vocabularies (e.g., "prefix:${missingConcepts[0]}")`,
                        },
                    ],
                    isError: true,
                };
            }
        }

        // 5. Build the new concept as text (template-based for simplicity)
        // For a more robust approach, you'd construct the AST node directly
        let conceptText = `\n\tconcept ${conceptName}`;
        
        if (superConcepts && superConcepts.length > 0) {
            conceptText += ` < ${superConcepts.join(', ')}`;
        }

        // 6. Read the current file content
        const originalContent = fs.readFileSync(filePath, 'utf-8');

        // 7. Find insertion point (before closing brace)
        const closingBraceIndex = originalContent.lastIndexOf('}');
        if (closingBraceIndex === -1) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Error: Could not find closing brace in vocabulary file.`,
                    },
                ],
                isError: true,
            };
        }

        // 8. Insert the new concept before the closing brace
        const newContent = 
            originalContent.slice(0, closingBraceIndex) +
            conceptText +
            '\n' +
            originalContent.slice(closingBraceIndex);

        // 9. Write the modified content to disk
        console.error(`[add_concept] Writing to disk: ${filePath}`);
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.error(`[add_concept] File written successfully`);

        // 10. Notify the LSP bridge of the change via textDocument/didChange
        let socket: net.Socket | undefined;
        let connection: ReturnType<typeof createMessageConnection> | undefined;

        try {
            socket = net.connect({ port: LSP_BRIDGE_PORT });

            await new Promise<void>((resolve, reject) => {
                socket!.on('connect', () => resolve());
                socket!.on('error', (err) => reject(err));
                setTimeout(() => reject(new Error('Connection timeout')), 5000);
            });

            const reader = new StreamMessageReader(socket);
            const writer = new StreamMessageWriter(socket);
            connection = createMessageConnection(reader, writer);
            connection.listen();

            // Send didChange notification to update LSP's view
            await connection.sendNotification('textDocument/didChange', {
                textDocument: {
                    uri: fileUri,
                    version: Date.now(), // Simple versioning
                },
                contentChanges: [
                    {
                        text: newContent, // Full document sync
                    },
                ],
            });

            connection.dispose();
            socket.end();

        } catch (lspError) {
            console.error('[add_concept] Failed to notify LSP:', lspError);
            // Continue anyway - file was written successfully
        }

        // 10. Return success
        const result = {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Successfully added concept '${conceptName}' to ${path.basename(filePath)}${
                        superConcepts && superConcepts.length > 0
                            ? `\n  Specializes: ${superConcepts.join(', ')}`
                            : ''
                    }\n\nGenerated code:\n${conceptText.trim()}`,
                },
            ],
        };
        console.error(`[add_concept] Returning success:`, JSON.stringify(result));
        return result;

    } catch (error) {
        console.error(`[add_concept] Exception caught:`, error);
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Error adding concept: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
};
