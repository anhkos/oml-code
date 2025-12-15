import { z } from 'zod';
import * as fs from 'fs';
import { writeFileAndNotify } from '../common.js';

export const addToBundleTool = {
    name: 'add_to_bundle' as const,
    description: 'Adds a vocabulary namespace to a vocabulary bundle via an includes entry (with dc prefix when applicable).',
    paramsSchema: {
        bundlePath: z.string().describe('Path to the vocabulary bundle file'),
        namespace: z.string().describe('Namespace IRI to include (e.g., https://fireforce6.github.io/sierra/process#)'),
    }
};

export const addToBundleHandler = async ({ bundlePath, namespace }: { bundlePath: string; namespace: string }) => {
    try {
        if (!fs.existsSync(bundlePath)) {
            return { isError: true, content: [{ type: 'text' as const, text: `Bundle not found: ${bundlePath}` }] };
        }
        const text = fs.readFileSync(bundlePath, 'utf-8');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';

        // If already included, no-op
        const already = new RegExp(`includes\s*<${escapeRegex(namespace)}>`, 'i').test(text);
        if (already) {
            return { content: [{ type: 'text' as const, text: '✓ Bundle already includes namespace' }] };
        }

        const isDc = namespace === 'http://purl.org/dc/elements/1.1/';
        const includeLine = `    includes <${namespace}>${isDc ? ' as dc' : ''}`;

        // Insert before closing brace of the bundle
        const closingIndex = text.lastIndexOf('}');
        if (closingIndex < 0) {
            return { isError: true, content: [{ type: 'text' as const, text: 'Bundle file appears malformed (no closing brace).' }] };
        }

        const before = text.slice(0, closingIndex).replace(/\s*$/,'');
        const after = text.slice(closingIndex);
        const newContent = before + eol + includeLine + eol + after;

        // Reconstruct a file URI (simple Windows support)
        const fileUri = 'file:///' + bundlePath.replace(/\\/g, '/');
        await writeFileAndNotify(bundlePath, fileUri, newContent);

        return { content: [{ type: 'text' as const, text: `✓ Added includes for ${namespace}` }] };
    } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: `Error updating bundle: ${error instanceof Error ? error.message : String(error)}` }] };
    }
};

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
