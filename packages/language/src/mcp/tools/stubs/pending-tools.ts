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
                    text: `${name} is not implemented yet. Use the edit tools to modify the file directly.`,
                },
            ],
        }),
    };
}

// Only keep truly complex stubs that need significant design work
export const pendingTools: StubRegistration[] = [
    makeStub('update_ontology', 'Updates ontology metadata (namespace, prefix). Requires careful handling of references.'),
];
