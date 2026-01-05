import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../oml-module.js';
import {
    AnnotationProperty,
    Aspect,
    Concept,
    RelationEntity,
    Scalar,
    ScalarProperty,
    UnreifiedRelation,
    Vocabulary,
    isVocabulary,
    isAnnotationProperty,
    isAspect,
    isConcept,
    isRelationEntity,
    isScalar,
    isScalarProperty,
    isUnreifiedRelation
} from '../../generated/ast.js';

export const LSP_BRIDGE_PORT = 5007;

export type LiteralParam = {
    type: 'integer' | 'decimal' | 'double' | 'boolean' | 'quoted';
    value: string | number | boolean;
    scalarType?: string;
    langTag?: string;
};

export type AnnotationParam = {
    property: string;
    literalValues?: LiteralParam[];
    referencedValues?: string[];
};

export type PropertyValueParam = {
    property: string;
    literalValues?: LiteralParam[];
    referencedValues?: string[];
};

export type AnyTerm =
    | Scalar
    | Aspect
    | Concept
    | RelationEntity
    | ScalarProperty
    | AnnotationProperty
    | UnreifiedRelation;

export function pathToFileUri(filePath: string): string {
    if (filePath.startsWith('file://')) {
        return filePath;
    }
    const absolutePath = path.resolve(filePath);
    return URI.file(absolutePath).toString();
}

export function fileUriToPath(fileUri: string): string {
    return URI.parse(fileUri).fsPath;
}

export async function loadVocabularyDocument(ontology: string) {
    const fileUri = pathToFileUri(ontology);
    const filePath = fileUriToPath(fileUri);

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at ${filePath}`);
    }

    const services = createOmlServices(NodeFileSystem);
    const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.parse(fileUri));
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });

    const root = document.parseResult.value;
    if (!isVocabulary(root)) {
        throw new Error('The target ontology is not a vocabulary. Only vocabularies are supported in Phase 1.');
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const indent = detectIndentation(text);

    return { services, document, vocabulary: root, fileUri, filePath, text, eol, indent };
}

export function detectIndentation(content: string): string {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^( +|\t+)/);
        if (match) return match[1];
    }
    return '    ';
}

export function formatLiteral(lit: LiteralParam): string {
    switch (lit.type) {
        case 'integer':
        case 'decimal':
        case 'double':
            return String(lit.value);
        case 'boolean':
            return lit.value ? 'true' : 'false';
        case 'quoted': {
            const value = String(lit.value).replace(/"/g, '\\"');
            if (lit.scalarType) return `"${value}"^^${lit.scalarType}`;
            if (lit.langTag) return `"${value}"$${lit.langTag}`;
            return `"${value}"`;
        }
        default:
            return String(lit.value);
    }
}

export function formatAnnotation(annotation: AnnotationParam, indent: string): string {
    const values: string[] = [];
    if (annotation.literalValues && annotation.literalValues.length > 0) {
        values.push(...annotation.literalValues.map(formatLiteral));
    }
    if (annotation.referencedValues && annotation.referencedValues.length > 0) {
        values.push(...annotation.referencedValues);
    }
    const suffix = values.length > 0 ? ' ' + values.join(', ') : '';
    return `${indent}@${annotation.property}${suffix}`;
}

export function formatAnnotations(annotations: AnnotationParam[] | undefined, indent: string, eol: string): string {
    if (!annotations || annotations.length === 0) return '';
    return annotations.map((a) => formatAnnotation(a, indent)).join(eol) + eol;
}

export function insertBeforeClosingBrace(content: string, insertion: string): string {
    const closingIndex = content.lastIndexOf('}');
    if (closingIndex === -1) {
        throw new Error('Could not find closing brace in ontology file.');
    }
    return content.slice(0, closingIndex) + insertion + content.slice(closingIndex);
}

export function isTerm(node: unknown): node is AnyTerm {
    return (
        isScalar(node) ||
        isAspect(node) ||
        isConcept(node) ||
        isRelationEntity(node) ||
        isScalarProperty(node) ||
        isAnnotationProperty(node) ||
        isUnreifiedRelation(node)
    );
}

export function findTerm(vocabulary: Vocabulary, name: string): AnyTerm | undefined {
    return vocabulary.ownedStatements.find((stmt) => isTerm(stmt) && (stmt as AnyTerm).name === name) as AnyTerm | undefined;
}

export function collectImportPrefixes(text: string, localPrefix?: string): Set<string> {
    const prefixes = new Set<string>();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^(extends|uses|includes)\b/.test(trimmed)) {
            const match = trimmed.match(/\bas\s+([^\s{]+)/);
            if (match) {
                prefixes.add(match[1]);
            }
        }
    }
    if (localPrefix) {
        prefixes.add(localPrefix);
    }
    return prefixes;
}

export async function writeFileAndNotify(filePath: string, fileUri: string, newContent: string) {
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
