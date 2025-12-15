import { z } from 'zod';
import { createOntologyHandler } from '../ontology/create-ontology.js';
import { ensureImportsHandler } from './ensure-imports.js';
import { addToBundleHandler } from './add-to-bundle.js';
import { annotationParamSchema } from '../schemas.js';
import { AnnotationParam } from '../common.js';

export const smartCreateVocabularyTool = {
    name: 'smart_create_vocabulary' as const,
    description: 'Creates a vocabulary and automatically adds required imports and optionally registers it in a bundle.',
    paramsSchema: z.object({
        filePath: z.string().describe('Path to the new vocabulary file'),
        namespace: z.string().describe('Namespace IRI for the vocabulary'),
        prefix: z.string().describe('Prefix for the vocabulary (e.g., ^process)'),
        annotations: z.array(annotationParamSchema).optional().describe('Optional annotations to add (dc:title, dc:description, etc.)'),
        bundlePath: z.string().optional().describe('Optional path to a vocabulary bundle to update with includes'),
    })
};

export const smartCreateVocabularyHandler = async (
    { filePath, namespace, prefix, annotations = [], bundlePath }: { filePath: string; namespace: string; prefix: string; annotations?: AnnotationParam[]; bundlePath?: string }
) => {
    // 1) Create the vocabulary
    const createRes = await createOntologyHandler({ filePath, kind: 'vocabulary', namespace, prefix, annotations });
    if ((createRes as any).isError) return createRes;

    // 2) Ensure imports only for prefixes actually used (dc implied by annotations if provided)
    const ensureRes = await ensureImportsHandler({ ontology: filePath });
    if ((ensureRes as any).isError) return ensureRes;

    // 3) Add to bundle if provided
    if (bundlePath) {
        const bundleRes = await addToBundleHandler({ bundlePath, namespace });
        if ((bundleRes as any).isError) return bundleRes;
        return {
            content: [
                { type: 'text' as const, text: '✓ Vocabulary created' },
                ...((ensureRes as any).content || []),
                ...((bundleRes as any).content || []),
            ]
        };
    }

    return {
        content: [
            { type: 'text' as const, text: '✓ Vocabulary created' },
            ...((ensureRes as any).content || [])
        ]
    };
};
