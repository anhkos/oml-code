import { z } from 'zod';

type StubRegistration = {
    tool: { name: string; description: string; paramsSchema: unknown };
    handler: (params: unknown) => { isError: boolean; content: { type: 'text'; text: string }[] };
};

function makeStub(name: string, description: string): StubRegistration {
    const schema = z.object({}).describe('Not implemented yet');
    return {
        tool: { name, description, paramsSchema: schema },
        handler: () => ({
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `${name} is not implemented yet. This server currently ships Phase 1 tools only.`,
                },
            ],
        }),
    };
}

export const pendingTools: StubRegistration[] = [
    makeStub('create_ontology', 'Creates a new ontology document (stub).'),
    makeStub('add_import', 'Adds an import to an ontology (stub).'),
    makeStub('add_equivalence', 'Adds an equivalence axiom (stub).'),
    makeStub('add_restriction', 'Adds a property restriction (stub).'),
    makeStub('create_instance', 'Creates a concept or relation instance (stub).'),
    makeStub('create_rule', 'Creates a rule (stub).'),
    makeStub('add_annotation', 'Adds an annotation (stub).'),
    makeStub('add_key', 'Adds a key axiom (stub).'),
    makeStub('delete_ontology', 'Deletes an ontology (stub).'),
    makeStub('delete_import', 'Deletes an import (stub).'),
    makeStub('delete_equivalence', 'Deletes an equivalence axiom by index (stub).'),
    makeStub('delete_restriction', 'Deletes a restriction by index (stub).'),
    makeStub('delete_instance', 'Deletes an instance (stub).'),
    makeStub('delete_rule', 'Deletes a rule (stub).'),
    makeStub('delete_annotation', 'Deletes an annotation by index (stub).'),
    makeStub('delete_key', 'Deletes a key axiom by index (stub).'),
    makeStub('delete_property_value', 'Deletes a property value from an instance (stub).'),
    makeStub('delete_type_assertion', 'Deletes a type assertion from an instance (stub).'),
    makeStub('update_ontology', 'Updates ontology metadata (stub).'),
    makeStub('update_term', 'Updates a term (stub).'),
    makeStub('update_instance', 'Updates an instance (stub).'),
    makeStub('update_rule', 'Updates a rule (stub).'),
    makeStub('update_restriction', 'Updates a property restriction (stub).'),
    makeStub('update_equivalence', 'Updates an equivalence axiom (stub).'),
    makeStub('update_property_value', 'Updates a property value (stub).'),
    makeStub('update_annotation', 'Updates an annotation (stub).'),
    makeStub('update_key', 'Updates a key axiom (stub).'),
];
