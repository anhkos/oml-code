import * as fs from 'fs';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../oml-module.js';
import { Description, isDescription } from '../../generated/ast.js';
import { LSP_BRIDGE_PORT, pathToFileUri, fileUriToPath, detectIndentation, getFreshDocument } from './common.js';

/**
 * Custom error class for when an ontology file doesn't exist.
 * This allows callers to provide helpful guidance to the model.
 */
export class OntologyNotFoundError extends Error {
    constructor(public readonly filePath: string) {
        super(`ONTOLOGY_NOT_FOUND: ${filePath}`);
        this.name = 'OntologyNotFoundError';
    }
}

/**
 * Custom error class for when a file exists but is not the expected type.
 */
export class WrongOntologyTypeError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly expectedType: string,
        public readonly actualType: string
    ) {
        super(`Expected ${expectedType} but found ${actualType}`);
        this.name = 'WrongOntologyTypeError';
    }
}

export async function loadDescriptionDocument(ontology: string) {
    const fileUri = pathToFileUri(ontology);
    const filePath = fileUriToPath(fileUri);

    if (!fs.existsSync(filePath)) {
        throw new OntologyNotFoundError(filePath);
    }

    const services = createOmlServices(NodeFileSystem);
    // Use getFreshDocument to ensure we always read fresh content from disk
    const document = await getFreshDocument(services, fileUri);

    const root = document.parseResult.value;
    if (!isDescription(root)) {
        throw new WrongOntologyTypeError(filePath, 'description', root.$type || 'unknown');
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

        // Use didClose/didOpen to force a complete re-read, consistent with vocab tools
        // This prevents stale views in the language server
        await connection.sendNotification('textDocument/didClose', {
            textDocument: { uri: fileUri },
        });

        await connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri: fileUri,
                languageId: 'oml',
                version: Date.now(),
                text: newContent,
            },
        });
    } catch (error) {
        console.error('[mcp] Failed to notify LSP bridge:', error);
    } finally {
        if (connection) connection.dispose();
        if (socket) socket.end();
    }
}
