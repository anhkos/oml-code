import * as net from 'net';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node.js';
import { 
    createMessageConnection, 
    StreamMessageReader, 
    StreamMessageWriter 
} from 'vscode-jsonrpc/node.js';

/**
 * Creates an LSP bridge server that forwards requests between
 * external clients and the OML language server running in VS Code
 */
export class OmlLspBridge {
    private server: net.Server | undefined;
    private port: number;
    
    constructor(private client: LanguageClient, port: number = 5007) {
        this.port = port;
    }

    async start(): Promise<void> {
        this.server = net.createServer((socket) => {
            console.log('[OML LSP Bridge] Client connected');
            
            const reader = new StreamMessageReader(socket);
            const writer = new StreamMessageWriter(socket);
            const connection = createMessageConnection(reader, writer);
            
            // Forward all requests to the language server
            connection.onRequest(async (method, params) => {
                try {
                    // Handle textDocument/diagnostic specially using VS Code API
                    if (method === 'textDocument/diagnostic') {
                        return await this.handleDiagnosticRequest(params);
                    }
                    
                    const result = await this.client.sendRequest(method, params);
                    return result;
                } catch (error) {
                    console.error(`[OML LSP Bridge] Error forwarding request ${method}:`, error);
                    throw error;
                }
            });
            
            // Forward all notifications to the language server
            connection.onNotification((method, params) => {
                try {
                    this.client.sendNotification(method, params);
                } catch (error) {
                    console.error(`[OML LSP Bridge] Error forwarding notification ${method}:`, error);
                }
            });
            
            // Listen for messages from the client
            connection.listen();
            
            socket.on('close', () => {
                console.log('[OML LSP Bridge] Client disconnected');
                connection.dispose();
            });
            
            socket.on('error', (err) => {
                console.error('[OML LSP Bridge] Socket error:', err);
                connection.dispose();
            });
        });

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, () => {
                console.log(`[OML LSP Bridge] Listening on port ${this.port}`);
                resolve();
            });
            
            this.server!.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`[OML LSP Bridge] Port ${this.port} is already in use`);
                } else {
                    console.error('[OML LSP Bridge] Server error:', err);
                }
                reject(err);
            });
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            console.log('[OML LSP Bridge] Server stopped');
        }
    }

    /**
     * Handle textDocument/diagnostic request using VS Code's diagnostics API
     */
    private async handleDiagnosticRequest(params: any): Promise<any> {
        try {
            console.log(`[OML LSP Bridge] Diagnostic request for ${params.textDocument.uri}`);
            const uri = vscode.Uri.parse(params.textDocument.uri);

            // Get diagnostics from VS Code
            const diagnostics = vscode.languages.getDiagnostics(uri);
            console.log(`[OML LSP Bridge] Found ${diagnostics.length} diagnostics`);

            // Convert VS Code diagnostics to LSP format
            const items = diagnostics.map((diag) => ({
                range: {
                    start: {
                        line: diag.range.start.line,
                        character: diag.range.start.character,
                    },
                    end: {
                        line: diag.range.end.line,
                        character: diag.range.end.character,
                    },
                },
                severity: this.convertSeverity(diag.severity),
                code: diag.code,
                source: diag.source || 'oml',
                message: diag.message,
            }));

            return { kind: 'full', items };
        } catch (error) {
            console.error(`[OML LSP Bridge] Error handling diagnostic request:`, error);
            return { kind: 'full', items: [] };
        }
    }

    /**
     * Convert VS Code diagnostic severity to LSP severity
     */
    private convertSeverity(severity: vscode.DiagnosticSeverity): number {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error:
                return 1;
            case vscode.DiagnosticSeverity.Warning:
                return 2;
            case vscode.DiagnosticSeverity.Information:
                return 3;
            case vscode.DiagnosticSeverity.Hint:
                return 4;
            default:
                return 1;
        }
    }
}
