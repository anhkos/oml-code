import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { expandToString as s } from "langium/generate";
import { parseHelper } from "langium/test";
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

describe('Parsing tests', () => {

    test('parse simple Vocabulary', async () => {
        document = await parse(`
            vocabulary <http://example.com/test#> as v {
                concept Langium
            }
        `);

        // check for absence of parser errors the classic way:
        //  deactivated, find a much more human readable way below!
        // expect(document.parseResult.parserErrors).toHaveLength(0);

        expect(
            // here we use a (tagged) template expression to create a human readable representation
            //  of the AST part we are interested in and that is to be compared to our expectation;
            // prior to the tagged template expression we check for validity of the parsed document object
            //  by means of the reusable function 'checkDocumentValid()' to sort out (critical) typos first;
                        checkDocumentValid(document) || s`
                                Namespace: ${isVocabulary(document.parseResult.value) ? document.parseResult.value.namespace : ''}
                                Prefix: ${isVocabulary(document.parseResult.value) ? document.parseResult.value.prefix : ''}
                                Concepts:
                                    ${isVocabulary(document.parseResult.value) ? document.parseResult.value.ownedStatements
                                        .filter(s => (s as any).$type === 'Concept')
                                        .map((c: any) => c.name).join('\n  ') : ''}
                        `
                ).toBe(s`
                        Namespace: <http://example.com/test#>
                        Prefix: v
                        Concepts:
                            Langium
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
