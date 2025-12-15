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
                    text: `${name} is not implemented yet. This server currently ships Phase 1, 2, and core Phase 3 tools only.`,
                },
            ],
        }),
    };
}

export const pendingTools: StubRegistration[] = [
    makeStub('delete_ontology', 'Deletes an ontology (stub).'),
    makeStub('delete_import', 'Deletes an import (stub).'),
    makeStub('delete_equivalence', 'Deletes an equivalence axiom by index (stub).'),
    makeStub('delete_restriction', 'Deletes a restriction by index (stub).'),
    makeStub('delete_rule', 'Deletes a rule (stub).'),
    makeStub('delete_annotation', 'Deletes an annotation by index (stub).'),
    makeStub('delete_key', 'Deletes a key axiom by index (stub).'),
    makeStub('delete_property_value', 'Deletes a property value from an instance (stub).'),
    makeStub('delete_type_assertion', 'Deletes a type assertion from an instance (stub).'),
    makeStub('update_ontology', 'Updates ontology metadata (stub).'),
    makeStub('update_rule', 'Updates a rule (stub).'),
];
