import { z } from 'zod';
import * as net from 'net';
import * as path from 'path';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import {
    DocumentDiagnosticRequest,
    DocumentDiagnosticReport,
    DocumentDiagnosticReportKind,
    Diagnostic
} from 'vscode-languageserver-protocol';

const LSP_BRIDGE_PORT = 5007;

/**
 * Convert a file path to a file URI
 * Handles both Windows and Unix paths, and is idempotent (safe to call on URIs)
 */
function pathToFileUri(filePath: string): string {
    // If it's already a file URI, return as-is
    if (filePath.startsWith('file://')) {
        return filePath;
    }
    
    // Normalize the path
    const normalized = path.resolve(filePath);
    
    // Convert backslashes to forward slashes (Windows compatibility)
    const withForwardSlashes = normalized.replace(/\\/g, '/');
    
    // Ensure it starts with / for absolute paths
    const absolute = withForwardSlashes.startsWith('/') ? withForwardSlashes : '/' + withForwardSlashes;
    
    // Return as file:// URI
    return 'file://' + absolute;
}

const validateParamsSchema = {
    uri: z.string().describe('File path to the OML document (absolute or relative path)'),
};

export const validateOmlTool = {
    name: 'validate_oml' as const,
    description: 'Validates OML code for syntax and semantic errors with full workspace context',
    paramsSchema: validateParamsSchema,
};

export async function validateOmlHandler({ uri }: { uri: string }) {
    let socket: net.Socket | undefined;
    let connection: ReturnType<typeof createMessageConnection> | undefined;
    
    try {
        // Convert file path to proper file URI
        const fileUri = pathToFileUri(uri);
        console.log(`[validate_oml] Converting path to URI: ${uri} ƒ+' ${fileUri}`);

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

        // Close connection
        connection.dispose();
        socket.end();

        if (diagnostics.length === 0) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: 'ƒo" OML code is valid - no errors found',
                    },
                ],
            };
        }

        // Format diagnostics with severity labels
        const formatted = diagnostics
            .map((d) => {
                const severity = ['Error', 'Warning', 'Info', 'Hint'][d.severity! - 1] || 'Unknown';
                const line = (d.range?.start?.line ?? 0) + 1;
                const column = (d.range?.start?.character ?? 0) + 1;
                return `[${severity}] Line ${line}:${column} - ${d.message}`;
            })
            .join('\n');

        return {
            content: [
                {
                    type: 'text' as const,
                    text: formatted,
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
