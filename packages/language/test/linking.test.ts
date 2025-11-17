import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { expandToString as s } from "langium/generate";
import { clearDocuments, parseHelper } from "langium/test";
import type { Ontology } from "oml-language";
import { createOmlServices, isOntology, isVocabulary } from "oml-language";

let services: ReturnType<typeof createOmlServices>;
let parse:    ReturnType<typeof parseHelper<Ontology>>;
let document: LangiumDocument<Ontology> | undefined;

beforeAll(async () => {
    services = createOmlServices(EmptyFileSystem);
    parse = parseHelper<Ontology>(services.Oml);

    // activate the following if your linking test requires elements from a built-in library, for example
    // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
});

afterEach(async () => {
    document && clearDocuments(services.shared, [ document ]);
});

describe('Linking tests', () => {

    test('linking of relation sources', async () => {
        document = await parse(`
            vocabulary <http://example.com/test#> as v {
                concept A
                relation entity R [ from A to A forward r ]
            }
        `);

        expect(
            checkDocumentValid(document)
                || (isVocabulary(document.parseResult.value) ?
                    // find the relation entity and print resolved source name
                    (document.parseResult.value.ownedStatements.find(s => (s as any).$type === 'RelationEntity') as any).sources[0].ref?.name
                    : '')
        ).toBe(s`
            A
        `);
    });
});

function checkDocumentValid(document: LangiumDocument): string | undefined {
    return document.parseResult.parserErrors.length && s`
        Parser errors:
          ${document.parseResult.parserErrors.map(e => e.message).join('\n  ')}
    `
        || document.parseResult.value === undefined && `ParseResult is 'undefined'.`
        || !isOntology(document.parseResult.value) && `Root AST object is a ${document.parseResult.value.$type}, expected a 'Ontology'.`
        || undefined;
}
