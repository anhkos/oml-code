import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { createMessageConnection } from 'vscode-jsonrpc';
import { pathToFileUri, fileUriToPath, LSP_BRIDGE_PORT } from '../common.js';

async function notifyFileDeleted(fileUri: string) {
    let socket: net.Socket | undefined;
    let connection: ReturnType<typeof createMessageConnection> | undefined;

    try {
        socket = net.connect({ port: LSP_BRIDGE_PORT });
        await new Promise<void>((resolve, reject) => {
            socket!.once('connect', () => resolve());
            socket!.once('error', (err) => reject(err));
            setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });

        const reader = new StreamMessageReader(socket);
        const writer = new StreamMessageWriter(socket);
        connection = createMessageConnection(reader, writer);
        connection.listen();

        // Send didClose to notify LSP that file is removed
        await connection.sendNotification('textDocument/didClose', {
            textDocument: { uri: fileUri },
        });
        
        console.error(`[mcp] LSP notified of file deletion: ${fileUri}`);
    } catch (error) {
        console.error('[mcp] Failed to notify LSP bridge of deletion:', error);
    } finally {
        if (connection) connection.dispose();
        if (socket) socket.destroy();
    }
}

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the ontology to delete'),
    force: z.boolean().optional().describe('Force deletion even if other files depend on this ontology. Default: false'),
};

export const deleteOntologyTool = {
    name: 'delete_ontology' as const,
    description: `Deletes an ontology file with impact analysis.

⚠️ DANGER: This operation is destructive and cannot be undone.

Before deletion, this tool scans the workspace for files that import this ontology.
If dependencies are found:
- Without force=true: Returns list of dependent files and prevents deletion
- With force=true: Deletes the ontology (WARNING: will break dependent files)

Always use validate_oml on dependent files after deletion to identify broken references.`,
    paramsSchema,
};

export const deleteOntologyMetadata = {
    id: 'delete_ontology',
    displayName: 'Delete Ontology',
    layer: 'core' as const,
    severity: 'critical' as const,
    version: '1.0.0',
    shortDescription: 'Delete an ontology file with impact analysis',
    description: 'Deletes an ontology file with dependency analysis to prevent breaking changes.',
    tags: ['ontology-deletion', 'safety', 'destructive'],
    dependencies: ['analyze_impact', 'validate_oml'],
    addedDate: '2024-01-01',
};

async function findDependentFiles(ontologyPath: string, workspaceRoot: string): Promise<string[]> {
    const dependents: string[] = [];
    const ontologyName = path.basename(ontologyPath, '.oml');
    
    // Extract the namespace from the ontology file
    let namespace: string | null = null;
    try {
        const content = fs.readFileSync(ontologyPath, 'utf-8');
        const nsMatch = content.match(/(vocabulary|description|vocabulary bundle|description bundle)\s+<([^>]+)>/);
        if (nsMatch) {
            namespace = nsMatch[2];
        }
    } catch {
        // File might already be deleted or unreadable
    }

    // Recursively search for .oml files
    function searchDir(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    searchDir(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.oml') && fullPath !== ontologyPath) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf-8');
                        // Check if this file imports the target ontology
                        if (namespace && content.includes(`<${namespace}>`)) {
                            dependents.push(fullPath);
                        } else if (content.includes(`as ${ontologyName}`) || content.includes(`as ^${ontologyName}`)) {
                            // Also check by prefix if namespace not found
                            dependents.push(fullPath);
                        }
                    } catch {
                        // Skip unreadable files
                    }
                }
            }
        } catch {
            // Skip unreadable directories
        }
    }

    searchDir(workspaceRoot);
    return dependents;
}

export const deleteOntologyHandler = async (
    { ontology, force = false }: { ontology: string; force?: boolean }
) => {
    try {
        const fileUri = pathToFileUri(ontology);
        const filePath = fileUriToPath(fileUri);

        if (!fs.existsSync(filePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Ontology not found at ${filePath}` }],
            };
        }

        // Determine workspace root (go up until we find package.json or .git or reach a reasonable limit)
        let workspaceRoot = path.dirname(filePath);
        for (let i = 0; i < 10; i++) {
            const parent = path.dirname(workspaceRoot);
            if (parent === workspaceRoot) break;
            if (fs.existsSync(path.join(workspaceRoot, 'package.json')) ||
                fs.existsSync(path.join(workspaceRoot, '.git')) ||
                fs.existsSync(path.join(workspaceRoot, 'build.gradle')) ||
                fs.existsSync(path.join(workspaceRoot, 'catalog.xml'))) {
                break;
            }
            workspaceRoot = parent;
        }

        // Find dependent files
        const dependents = await findDependentFiles(filePath, workspaceRoot);

        if (dependents.length > 0 && !force) {
            const relativePaths = dependents.map(d => path.relative(workspaceRoot, d).replace(/\\/g, '/'));
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `⚠️ Cannot delete: ${dependents.length} file(s) depend on this ontology:\n\n${relativePaths.map(p => `  • ${p}`).join('\n')}\n\nTo force deletion, set force=true.\nAfter deletion, run validate_oml on dependent files to fix broken references.`
                }],
            };
        }

        // Notify LSP that file is being removed
        await notifyFileDeleted(fileUri);

        // Delete the file
        fs.unlinkSync(filePath);

        const message = dependents.length > 0
            ? `✓ Deleted ontology ${path.basename(filePath)}\n\n⚠️ Warning: ${dependents.length} file(s) may have broken references:\n${dependents.map(d => `  • ${path.relative(workspaceRoot, d).replace(/\\/g, '/')}`).join('\n')}\n\nRun validate_oml on these files to identify issues.`
            : `✓ Deleted ontology ${path.basename(filePath)} (no dependencies found)`;

        return {
            content: [{ type: 'text' as const, text: message }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error deleting ontology: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
