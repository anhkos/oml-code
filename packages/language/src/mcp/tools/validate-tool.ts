import { z } from 'zod';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import {
    DocumentDiagnosticRequest,
    DocumentDiagnosticReport,
    DocumentDiagnosticReportKind,
    Diagnostic
} from 'vscode-languageserver-protocol';
import { LSP_BRIDGE_PORT, pathToFileUri } from './common.js';

export const validateOmlTool = {
    name: 'validate_oml',
    description: 'Validates OML code for syntax and semantic errors with full workspace context',
    paramsSchema: {
        uri: z.string().describe('File path to the OML document (absolute or relative path)'),
    },
};

export async function validateOmlHandler(params: { uri: string }) {
    let socket: net.Socket | undefined;
    let connection: ReturnType<typeof createMessageConnection> | undefined;
    
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

        // Close connection
        connection.dispose();
        socket.end();

        if (diagnostics.length === 0) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: '✓ OML code is valid - no errors found',
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
