export type ToolRegistration = {
    tool: { name: string; description: string; paramsSchema: unknown };
    handler: (...args: any[]) => any;
};
