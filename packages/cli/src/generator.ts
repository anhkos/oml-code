import type { Ontology } from 'oml-language';
import { expandToNode, joinToNode, toString } from 'langium/generate';
import { isVocabulary } from 'oml-language';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

export function generateJavaScript(model: Ontology, filePath: string, destination: string | undefined): string {
    const data = extractDestinationAndName(filePath, destination);
    const generatedFilePath = `${path.join(data.destination, data.name)}.js`;

    const concepts = isVocabulary(model) ? model.ownedStatements.filter(s => (s as any).$type === 'Concept') : [];

    const fileNode = expandToNode`
        "use strict";

        ${joinToNode(concepts, (c: any) => `console.log('Concept: ${c.name}');`, { appendNewLineIfNotEmpty: true })}
    `.appendNewLineIfNotEmpty();

    if (!fs.existsSync(data.destination)) {
        fs.mkdirSync(data.destination, { recursive: true });
    }
    fs.writeFileSync(generatedFilePath, toString(fileNode));
    return generatedFilePath;
}
