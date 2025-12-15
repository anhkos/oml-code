import { z } from 'zod';
import * as fs from 'fs';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PrepareRenameRequest, RenameRequest, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { loadVocabularyDocument, writeFileAndNotify, findTerm, fileUriToPath, LSP_BRIDGE_PORT } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('File path to the target vocabulary'),
    currentName: z.string().describe('Current name of the term to update'),
    newName: z.string().optional().describe('New name for the term (if renaming)'),
};

export const updateTermTool = {
    name: 'update_term' as const,
    description: 'Updates a term by renaming it semantically across all referencing files in the workspace using the language server.',
    paramsSchema,
};

export const updateTermHandler = async (
    { ontology, currentName, newName }: { ontology: string; currentName: string; newName?: string }
) => {
    let lspConnection: ReturnType<typeof createMessageConnection> | undefined;
    let lspSocket: net.Socket | undefined;

    try {
        const { services, vocabulary, fileUri } = await loadVocabularyDocument(ontology);
        const term = findTerm(vocabulary, currentName);

        if (!term || !term.$cstNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${currentName}" not found in vocabulary.` }],
            };
        }

        if (!newName || newName.trim().length === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: 'newName is required to rename the term.' }],
            };
        }

        if (currentName === newName) {
            return {
                content: [{ type: 'text' as const, text: `No change: the term is already named "${currentName}".` }],
            };
        }

        if (findTerm(vocabulary, newName)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Term "${newName}" already exists in vocabulary.` }],
            };
        }

        const nameNode = services.Oml.references.NameProvider.getNameNode(term);
        if (!nameNode) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Could not locate the name node for "${currentName}".` }],
            };
        }

        const position = nameNode.range.start;
        console.error(`[update_term] Requesting rename for "${currentName}" at ${fileUri}:${position.line + 1}:${position.character + 1}`);

        ({ connection: lspConnection, socket: lspSocket } = await connectToLspBridge());

        await ensureRenameIsAllowed(lspConnection, fileUri, position);

        const workspaceEdit = await lspConnection.sendRequest<WorkspaceEdit>(
            RenameRequest.type.method,
            {
                textDocument: { uri: fileUri },
                position,
                newName,
            }
        );

        const editsByFile = collectEditsByFile(workspaceEdit);

        if (editsByFile.size === 0) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Language server returned no edits for "${currentName}".` }],
            };
        }

        let filesUpdated = 0;
        let totalEdits = 0;

        for (const [uri, edits] of editsByFile) {
            const applied = await applyTextEdits(uri, edits, newName);
            if (applied > 0) {
                filesUpdated += 1;
                totalEdits += applied;
            }
        }

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Renamed "${currentName}" to "${newName}". Updated ${filesUpdated} file(s) with ${totalEdits} edit(s).`,
                },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Error renaming term: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    } finally {
        if (lspConnection) {
            lspConnection.dispose();
        }
        if (lspSocket) {
            lspSocket.end();
        }
    }
};

async function connectToLspBridge() {
    const socket = net.connect({ port: LSP_BRIDGE_PORT });

    await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('error', (err) => reject(err));
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const reader = new StreamMessageReader(socket);
    const writer = new StreamMessageWriter(socket);
    const connection = createMessageConnection(reader, writer);
    connection.listen();

    return { connection, socket };
}

async function ensureRenameIsAllowed(connection: ReturnType<typeof createMessageConnection>, fileUri: string, position: { line: number; character: number }) {
    try {
        const prepareResult = await connection.sendRequest(
            PrepareRenameRequest.type.method,
            {
                textDocument: { uri: fileUri },
                position,
            }
        );

        if (prepareResult === null) {
            throw new Error('The language server reported that this location cannot be renamed.');
        }
    } catch (error: any) {
        if (error?.code === -32601 || (typeof error?.message === 'string' && error.message.includes('prepareRename'))) {
            console.warn('[update_term] prepareRename not available; continuing with rename request.');
            return;
        }
        throw error;
    }
}

function collectEditsByFile(edit: WorkspaceEdit | null | undefined): Map<string, TextEdit[]> {
    const byFile = new Map<string, TextEdit[]>();
    if (!edit) return byFile;

    if (edit.changes) {
        for (const [uri, edits] of Object.entries(edit.changes)) {
            if (!byFile.has(uri)) byFile.set(uri, []);
            byFile.get(uri)!.push(...edits);
        }
    }

    if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
            if (isTextDocumentEdit(change)) {
                const uri = change.textDocument.uri;
                if (!byFile.has(uri)) byFile.set(uri, []);
                byFile.get(uri)!.push(...change.edits);
            } else {
                console.warn('[update_term] Skipping unsupported document change returned by rename request.');
            }
        }
    }

    return byFile;
}

async function applyTextEdits(uri: string, edits: TextEdit[], targetName: string): Promise<number> {
    const filePath = fileUriToPath(uri);

    if (!fs.existsSync(filePath)) {
        console.error(`[update_term] File for URI ${uri} not found on disk.`);
        return 0;
    }

    const original = fs.readFileSync(filePath, 'utf-8');
    const textDocument = TextDocument.create(uri, 'oml', 0, original);

    const sorted = [...edits].sort((a, b) => {
        const aOffset = textDocument.offsetAt(a.range.start);
        const bOffset = textDocument.offsetAt(b.range.start);
        if (aOffset === bOffset) {
            return textDocument.offsetAt(b.range.end) - textDocument.offsetAt(a.range.end);
        }
        return bOffset - aOffset;
    });

    let updated = original;
    for (const edit of sorted) {
        const start = textDocument.offsetAt(edit.range.start);
        const end = textDocument.offsetAt(edit.range.end);
        const oldText = original.slice(start, end);
        let newText = edit.newText ?? '';

        // Preserve import prefix when the language server replaced the whole qualified name.
        const prefixMatch = oldText.match(/^([A-Za-z_][A-Za-z0-9_-]*):([A-Za-z_][A-Za-z0-9_-]*)$/);
        if (prefixMatch && newText === targetName) {
            newText = `${prefixMatch[1]}:${targetName}`;
        }

        updated = updated.slice(0, start) + newText + updated.slice(end);
    }

    if (updated !== original) {
        await writeFileAndNotify(filePath, uri, updated);
    }

    return edits.length;
}

function isTextDocumentEdit(change: any): change is TextDocumentEdit {
    return !!change && typeof change === 'object' && 'textDocument' in change && 'edits' in change;
}
