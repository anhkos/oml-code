import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { AnnotationParam, escapePrefix, resolveWorkspacePath } from '../common.js';
import { annotationParamSchema } from '../schemas.js';
import { ensureImportsHandler } from '../methodology/ensure-imports.js';

const paramsSchema = {
    filePath: z.string().describe('ABSOLUTE file path where the ontology will be created. Use the full path from the currently open file.'),
    kind: z.enum(['vocabulary', 'vocabulary_bundle', 'description', 'description_bundle']).describe('Type of ontology: "vocabulary" for defining concepts/types, "description" for creating instances of those types'),
    namespace: z.string().describe('Namespace URI (e.g., https://example.com/my#)'),
    prefix: z.string().describe('Prefix alias (e.g., my or ^process)'),
    annotations: z.array(annotationParamSchema).optional().describe('Optional top-level annotations. Prefer dc:title and dc:description for standard metadata. Imports auto-added.'),
};

export const createOntologyTool = {
    name: 'create_ontology' as const,
    description: `Creates a new OML ontology file.

IMPORTANT: Use the ABSOLUTE file path for filePath. Check the currently open file to get the correct path.

Choose the right kind:
- "vocabulary": For defining TYPES (concepts, relations, properties). Use when creating reusable domain models.
- "description": For creating INSTANCES of types defined in vocabularies. Use when modeling specific individuals/data.
- "vocabulary_bundle": For aggregating multiple vocabularies.
- "description_bundle": For aggregating multiple descriptions.

For DESCRIPTION MODELING (creating instances like specific stakeholders or requirements):
1. Create a "description" ontology
2. It will "uses" vocabularies that define the types
3. Then use create_concept_instance to add instances WITH types from those vocabularies

Annotations like dc:title and dc:description are auto-imported.`,
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
    const { filePath: inputPath, kind, namespace, prefix: inputPrefix, annotations } = params;

    try {
        // Resolve to absolute path relative to workspace root (not cwd)
        const filePath = resolveWorkspacePath(inputPath);
        console.error(`[create_ontology] Input path: ${inputPath}`);
        console.error(`[create_ontology] Workspace root: ${process.env.OML_WORKSPACE_ROOT || '(using cwd)'}`);
        console.error(`[create_ontology] Resolved path: ${filePath}`);
        
        // Escape prefix if it's a reserved keyword
        const prefix = escapePrefix(inputPrefix);
        if (prefix !== inputPrefix) {
            console.error(`[create_ontology] Escaped reserved keyword prefix: ${inputPrefix} -> ${prefix}`);
        }
        
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
        const fileExists = fs.existsSync(filePath);
        console.error(`[create_ontology] File exists: ${fileExists}`);
        
        if (fileExists) {
            const existingContent = fs.readFileSync(filePath, 'utf-8');
            console.error(`[create_ontology] Existing content (${existingContent.length} chars): "${existingContent.substring(0, 100)}"`);
            
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
                console.error(`[create_ontology] Updating existing file, found vocabulary at line ${vocabularyLineIndex}`);
            } else {
                // No vocabulary found, replace entire file
                content = annotationsText + `${kindKeyword} ${formattedNamespace} as ${prefix} {${eol}${eol}${eol}${eol}}`;
                console.error(`[create_ontology] Existing file has no vocabulary declaration, replacing content`);
            }
        } else {
            // Create new file
            content = annotationsText + `${kindKeyword} ${formattedNamespace} as ${prefix} {${eol}${eol}${eol}${eol}}`;
            console.error(`[create_ontology] Creating new file`);

            // Create directory if needed
            const dir = path.dirname(filePath);
            console.error(`[create_ontology] Directory: ${dir}`);
            if (dir && dir !== '.' && !fs.existsSync(dir)) {
                console.error(`[create_ontology] Creating directory: ${dir}`);
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        console.error(`[create_ontology] Content to write (${content.length} chars):\n${content}`);
        
        // Write file with explicit sync to ensure content is flushed to disk
        const fd = fs.openSync(filePath, 'w');
        fs.writeSync(fd, content, 0, 'utf-8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        console.error(`[create_ontology] File written and synced successfully`);
        
        // Verify the write
        const verifyContent = fs.readFileSync(filePath, 'utf-8');
        console.error(`[create_ontology] Verified file content (${verifyContent.length} chars): ${verifyContent.substring(0, 100)}...`);

        // Auto-ensure imports for any annotation prefixes used (dc:, xsd:)
        const hasAnnotations = annotations && annotations.length > 0;
        
        if (hasAnnotations) {
            // Silently call ensure_imports to add required imports based on detected prefixes
            try {
                console.error(`[create_ontology] Calling ensureImportsHandler...`);
                await ensureImportsHandler({ ontology: filePath });
                console.error(`[create_ontology] ensureImportsHandler completed`);
            } catch (importError) {
                console.error(`[create_ontology] ensureImportsHandler error:`, importError);
                // Ignore errors from import ensurance to avoid breaking creation
            }
        }

        // Final verification - read back the file to confirm content
        const finalContent = fs.readFileSync(filePath, 'utf-8');
        const contentPreview = finalContent.length > 200 ? finalContent.substring(0, 200) + '...' : finalContent;
        
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `✓ Created ${kind} at:\n${filePath}\n\nNamespace: ${namespace}\nPrefix: ${prefix}${hasAnnotations ? '\n✓ Auto-added imports for annotation prefixes' : ''}\n\n--- File content (${finalContent.length} chars) ---\n${contentPreview}`,
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
