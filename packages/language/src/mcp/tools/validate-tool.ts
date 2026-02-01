import { z } from 'zod';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import {
    DocumentDiagnosticRequest,
    DocumentDiagnosticReport,
    DocumentDiagnosticReportKind,
    Diagnostic,
    CodeActionRequest,
    CodeAction,
    CodeActionKind,
    TextEdit,
} from 'vscode-languageserver-protocol';
import { LSP_BRIDGE_PORT, pathToFileUri } from './common.js';

/**
 * Quick fix suggestion derived from LSP CodeAction
 */
interface QuickFix {
    title: string;
    kind?: string;
    isPreferred?: boolean;
    edits: Array<{
        lineNumber: number;
        startColumn: number;
        endColumn: number;
        newText: string;
    }>;
}

export const validateOmlTool = {
    name: 'validate_oml',
    description: `Validates OML code for syntax and semantic errors with full workspace context.

Returns diagnostics (errors, warnings) and optionally quick fixes from the language server.
Quick fixes are actionable edits that can be applied using the apply_text_edit tool.

Example response with quick fixes:
- [Error] Line 21:5 - Expected '<' but found 'extends'
  Quick Fix: Replace 'extends' with '<' (line 21, col 5-12)`,
    paramsSchema: {
        uri: z.string().describe('File path to the OML document (absolute or relative path)'),
        includeQuickFixes: z.boolean().default(true).describe('Include suggested quick fixes from the language server'),
    },
};

export const validateOmlMetadata = {
    id: 'validate_oml',
    displayName: 'Validate OML',
    layer: 'core' as const,
    severity: 'critical' as const,
    version: '1.0.0',
    shortDescription: 'Check OML files for syntax and semantic errors',
    description: 'Validates OML syntax and semantic correctness across the full workspace context using the language server.',
    tags: ['validation', 'syntax', 'semantics', 'diagnostics'],
    dependencies: [],
    addedDate: '2024-01-01',
};

export async function validateOmlHandler(params: { uri: string; includeQuickFixes?: boolean }) {
    let socket: net.Socket | undefined;
    let connection: ReturnType<typeof createMessageConnection> | undefined;
    const includeQuickFixes = params.includeQuickFixes ?? true;
    
    try {
        // Convert file path to proper file URI
        const fileUri = pathToFileUri(params.uri);
        console.log(`[validate_oml] Converting path to URI: ${params.uri} → ${fileUri}`);

        // Connect to the LSP bridge
        socket = net.connect({ port: LSP_BRIDGE_PORT });

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
            socket!.on('connect', () => resolve());
            socket!.on('error', (err) => reject(err));
            setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });

        // Create proper JSON-RPC message connection
        const reader = new StreamMessageReader(socket);
        const writer = new StreamMessageWriter(socket);
        connection = createMessageConnection(reader, writer);
        connection.listen();

        // Request diagnostics using proper LSP protocol
        const diagnosticsResponse = await connection.sendRequest<DocumentDiagnosticReport>(
            DocumentDiagnosticRequest.type.method,
            {
                textDocument: { uri: fileUri },
                previousResultId: undefined,
            }
        );

        // Extract diagnostics from the response
        let diagnostics: Diagnostic[] = [];

        if (diagnosticsResponse.kind === DocumentDiagnosticReportKind.Full) {
            diagnostics = diagnosticsResponse.items || [];
        }

        if (diagnostics.length === 0) {
            // Close connection
            connection.dispose();
            socket.end();
            
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: '✓ OML code is valid - no errors found',
                    },
                ],
            };
        }

        // Collect quick fixes for each diagnostic if requested
        const quickFixesByDiagnostic: Map<Diagnostic, QuickFix[]> = new Map();
        
        if (includeQuickFixes) {
            for (const diagnostic of diagnostics) {
                try {
                    const codeActions = await connection.sendRequest<(CodeAction | null)[]>(
                        CodeActionRequest.type.method,
                        {
                            textDocument: { uri: fileUri },
                            range: diagnostic.range,
                            context: {
                                diagnostics: [diagnostic],
                                only: [CodeActionKind.QuickFix],
                            },
                        }
                    );

                    const fixes: QuickFix[] = [];
                    for (const action of codeActions || []) {
                        if (action && action.edit?.changes) {
                            const edits = action.edit.changes[fileUri] || [];
                            const convertedEdits = edits.map((edit: TextEdit) => ({
                                lineNumber: edit.range.start.line + 1,
                                startColumn: edit.range.start.character,
                                endColumn: edit.range.end.character,
                                newText: edit.newText,
                            }));

                            if (convertedEdits.length > 0) {
                                fixes.push({
                                    title: action.title,
                                    kind: action.kind,
                                    isPreferred: action.isPreferred,
                                    edits: convertedEdits,
                                });
                            }
                        }
                    }

                    if (fixes.length > 0) {
                        quickFixesByDiagnostic.set(diagnostic, fixes);
                    }
                } catch (err) {
                    // Code actions might not be available - continue
                    console.log(`[validate_oml] Could not get code actions: ${err}`);
                }
            }
        }

        // Close connection
        connection.dispose();
        socket.end();

        // Format diagnostics with severity labels and quick fixes
        const formattedLines: string[] = [];
        
        for (const d of diagnostics) {
            const severity = ['Error', 'Warning', 'Info', 'Hint'][d.severity! - 1] || 'Unknown';
            const line = (d.range?.start?.line ?? 0) + 1;
            const column = (d.range?.start?.character ?? 0) + 1;
            
            formattedLines.push(`[${severity}] Line ${line}:${column} - ${d.message}`);
            
            // Add quick fixes if available
            const fixes = quickFixesByDiagnostic.get(d);
            if (fixes && fixes.length > 0) {
                for (const fix of fixes) {
                    const preferred = fix.isPreferred ? ' (preferred)' : '';
                    formattedLines.push(`  → Quick Fix${preferred}: ${fix.title}`);
                    
                    // Show the edit details for apply_text_edit compatibility
                    for (const edit of fix.edits) {
                        if (edit.newText.includes('\n')) {
                            formattedLines.push(`    Apply: Insert ${edit.newText.split('\n').length} lines at line ${edit.lineNumber}`);
                        } else {
                            formattedLines.push(`    Apply: Line ${edit.lineNumber}, col ${edit.startColumn}-${edit.endColumn} → "${edit.newText}"`);
                        }
                    }
                }
            }
        }

        // Add summary with actionable hint
        const errorCount = diagnostics.filter(d => d.severity === 1).length;
        const warningCount = diagnostics.filter(d => d.severity === 2).length;
        const fixableCount = quickFixesByDiagnostic.size;
        
        let summary = `\n---\nSummary: ${errorCount} error(s), ${warningCount} warning(s)`;
        if (fixableCount > 0) {
            summary += `\n${fixableCount} issue(s) have quick fixes available. Use apply_text_edit to apply them.`;
        }

        return {
            content: [
                {
                    type: 'text' as const,
                    text: formattedLines.join('\n') + summary,
                },
            ],
        };
    } catch (error) {
        // Clean up on error
        if (connection) {
            connection.dispose();
        }
        if (socket) {
            socket.end();
        }
        
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Validation error: ${error instanceof Error ? error.message : String(error)}. Make sure the OML extension is running in VS Code.`,
                },
            ],
        };
    }
}
