import * as fs from 'fs';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../oml-module.js';
import { Description, isDescription } from '../../generated/ast.js';
import { LSP_BRIDGE_PORT, pathToFileUri, fileUriToPath, detectIndentation } from './common.js';

export async function loadDescriptionDocument(ontology: string) {
    const fileUri = pathToFileUri(ontology);
    const filePath = fileUriToPath(fileUri);

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at ${filePath}`);
    }

    const services = createOmlServices(NodeFileSystem);
    const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(fileUri));
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });

    const root = document.parseResult.value;
    if (!isDescription(root)) {
        throw new Error('The target ontology is not a description. Only descriptions can contain instances.');
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = detectIndentation(text);

    return { services, document, description: root, fileUri, filePath, text, eol, indent };
}

export function findInstance(description: Description, name: string) {
    return description.ownedStatements.find((stmt: any) => {
        return (stmt.$type === 'ConceptInstance' || stmt.$type === 'RelationInstance') && stmt.name === name;
    });
}

export async function writeDescriptionAndNotify(filePath: string, fileUri: string, newContent: string) {
    fs.writeFileSync(filePath, newContent, 'utf-8');

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

        await connection.sendNotification('textDocument/didChange', {
            textDocument: {
                uri: fileUri,
                version: Date.now(),
            },
            contentChanges: [
                {
                    text: newContent,
                },
            ],
        });
    } catch (error) {
        console.error('[mcp] Failed to notify LSP bridge:', error);
    } finally {
        if (connection) connection.dispose();
        if (socket) socket.end();
    }
}
