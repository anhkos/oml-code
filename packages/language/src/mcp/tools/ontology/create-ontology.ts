import { z } from 'zod';
import * as fs from 'fs';
import { AnnotationParam } from '../common.js';
import { annotationParamSchema } from '../schemas.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    filePath: z.string().describe('File path where the ontology will be created'),
    kind: z.enum(['vocabulary', 'vocabulary_bundle', 'description', 'description_bundle']).describe('Type of ontology'),
    namespace: z.string().describe('Namespace URI (e.g., <https://example.com/my#>)'),
    prefix: z.string().describe('Prefix alias (e.g., my or ^process)'),
    annotations: z.array(annotationParamSchema).optional().describe('Optional top-level annotations (e.g., @dc:title, @dc:description)'),
};

export const createOntologyTool = {
    name: 'create_ontology' as const,
    description: 'Creates a new vocabulary, vocabulary bundle, description, or description bundle file with annotations.',
    paramsSchema,
};

function formatAnnotation(annotation: AnnotationParam, eol: string): string {
    const values: string[] = [];
    if (annotation.literalValues && annotation.literalValues.length > 0) {
        values.push(...annotation.literalValues.map((lit) => `"${String(lit.value)}"`));
    }
    if (annotation.referencedValues && annotation.referencedValues.length > 0) {
        values.push(...annotation.referencedValues);
    }
    const suffix = values.length > 0 ? ' ' + values.join(', ') : '';
    return `@${annotation.property}${suffix}${eol}`;
}

export const createOntologyHandler = async (params: {
    filePath: string;
    kind: 'vocabulary' | 'vocabulary_bundle' | 'description' | 'description_bundle';
    namespace: string;
    prefix: string;
    annotations?: AnnotationParam[];
}) => {
    const { filePath, kind, namespace, prefix, annotations } = params;

    try {
        const eol = '\n';

        const kindKeyword =
            kind === 'vocabulary_bundle' ? 'vocabulary bundle' :
            kind === 'description_bundle' ? 'description bundle' :
            kind === 'vocabulary' ? 'vocabulary' : 'description';

        // Ensure namespace is wrapped in angle brackets
        const formattedNamespace = namespace.startsWith('<') && namespace.endsWith('>') 
            ? namespace 
            : `<${namespace}>`;

        // Build annotations at top level (before vocabulary keyword)
        let annotationsText = '';
        if (annotations && annotations.length > 0) {
            for (const annotation of annotations) {
                annotationsText += formatAnnotation(annotation, eol);
            }
        }

        let content = '';

        // Check if file already exists
        if (fs.existsSync(filePath)) {
            const existingContent = fs.readFileSync(filePath, 'utf-8');
            
            // Strip old annotations (lines starting with @) and find vocabulary declaration
            const lines = existingContent.split(/\r?\n/);
            let vocabularyLineIndex = -1;
            
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed.startsWith('vocabulary') || trimmed.startsWith('description')) {
                    vocabularyLineIndex = i;
                    break;
                }
            }

            if (vocabularyLineIndex !== -1) {
                // Keep everything from vocabulary line onward
                const bodyLines = lines.slice(vocabularyLineIndex);
                content = annotationsText + bodyLines.join(eol);
            } else {
                // No vocabulary found, replace entire file
                content = annotationsText + `${kindKeyword} ${formattedNamespace} as ${prefix} {${eol}${eol}${eol}${eol}}`;
            }
        } else {
            // Create new file
            content = annotationsText + `${kindKeyword} ${formattedNamespace} as ${prefix} {${eol}${eol}${eol}${eol}}`;

            // Create directory if needed
            const dir = filePath.substring(0, filePath.lastIndexOf('\\'));
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // Write file
        fs.writeFileSync(filePath, content, 'utf-8');

        // Auto-ensure imports if annotations include dc:* or other known prefixes
        const hasAnnotations = annotations && annotations.length > 0;
        const hasDcAnnotation = hasAnnotations && annotations.some(a => a.property.startsWith('dc:'));
        
        if (hasDcAnnotation) {
            // Silently call ensure_imports to add required imports
            try {
                await ensureImportsHandler({ ontology: filePath });
            } catch {
                // Ignore errors from import ensurance to avoid breaking creation
            }
        }

        return {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Created ${kind} at ${filePath}\n\nNamespace: ${namespace}\nPrefix: ${prefix}${hasDcAnnotation ? '\n✓ Auto-added dc imports' : ''}`,
                },
            ],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: 'text' as const,
                    text: `Error creating ontology: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
};
