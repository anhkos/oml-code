import * as fs from 'fs';
import { NodeFileSystem } from 'langium/node';
import { createOmlServices } from '../../oml-module.js';
import { Description, isDescription } from '../../generated/ast.js';
import { pathToFileUri, fileUriToPath, detectIndentation, getFreshDocument, writeFileAndNotify } from './common.js';

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

    console.error(`[DEBUG] Description parseResult exists: ${!!document.parseResult}, parseResult.value exists: ${!!document.parseResult?.value}`);
    
    const root = document.parseResult?.value;
    
    // Debug: log what we actually got
    if (!document.parseResult) {
        console.error(`[DEBUG] Description: document.parseResult is null/undefined!`);
    }
    if (document.parseResult?.lexerErrors && document.parseResult.lexerErrors.length > 0) {
        console.error(`[DEBUG] Lexer errors: ${document.parseResult.lexerErrors.map((e: any) => e.message).join(', ')}`);
    }
    if (document.parseResult?.parserErrors && document.parseResult.parserErrors.length > 0) {
        console.error(`[DEBUG] Parser errors: ${document.parseResult.parserErrors.map((e: any) => e.message).join(', ')}`);
    }
    if (root) {
        console.error(`[DEBUG] Parsed root $type: ${root.$type}`);
        console.error(`[DEBUG] isDescription check: ${isDescription(root)}`);
    }
    
    if (!root || !isDescription(root)) {
        const actualType = root?.$type || 'unknown (parse failed)';
        throw new WrongOntologyTypeError(filePath, 'description', actualType);
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
    await writeFileAndNotify(filePath, fileUri, newContent);
}
