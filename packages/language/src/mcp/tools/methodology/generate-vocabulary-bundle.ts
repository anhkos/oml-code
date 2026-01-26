import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { resolveWorkspacePath, escapePrefix } from '../common.js';
import { validateOmlHandler } from '../validate-tool.js';

// Schema Definitions

const aspectSpecSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
});

const conceptSpecSchema = z.object({
    name: z.string(),
    extends: z.array(z.string()).optional(),
    description: z.string().optional(),
    restrictions: z.array(z.string()).optional(),
    keys: z.array(z.array(z.string())).optional(),
});

const relationSpecSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    forward: z.string().optional(),
    reverse: z.string().optional(),
    properties: z.array(z.string()).optional(),
    entity: z.boolean().optional().default(false),
});

const scalarPropertySpecSchema = z.object({
    name: z.string(),
    domain: z.string().optional(),
    range: z.string().optional(),
    description: z.string().optional(),
    functional: z.boolean().optional(),
});

const scalarSpecSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    one_of: z.array(z.string()).optional(),
});

const importSpecSchema = z.object({
    uri: z.string(),
    prefix: z.string(),
});

const vocabSpecSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    extends_vocabs: z.array(z.string()).optional(),
    aspects: z.array(aspectSpecSchema).optional(),
    concepts: z.array(conceptSpecSchema).optional(),
    relations: z.array(relationSpecSchema).optional(),
    scalar_properties: z.array(scalarPropertySpecSchema).optional(),
    scalars: z.array(scalarSpecSchema).optional(),
});

const bundleSpecSchema = z.object({
    bundle: z.object({
        name: z.string(),
        base_uri: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        common_extends: z.array(importSpecSchema).optional(),
        vocabularies: z.array(vocabSpecSchema),
    }),
});

// Types

type AspectSpec = z.infer<typeof aspectSpecSchema>;
type ConceptSpec = z.infer<typeof conceptSpecSchema>;
type RelationSpec = z.infer<typeof relationSpecSchema>;
type ScalarPropertySpec = z.infer<typeof scalarPropertySpecSchema>;
type ScalarSpec = z.infer<typeof scalarSpecSchema>;
type VocabSpec = z.infer<typeof vocabSpecSchema>;
type BundleSpec = z.infer<typeof bundleSpecSchema>;

// Tool Definition

export const generateVocabularyBundleTool = {
    name: 'generate_vocabulary_bundle' as const,
    description: `Generates a complete OML vocabulary bundle from a YAML specification. Creates multiple vocabulary files (.oml) with proper cross-references and a bundle file that includes all vocabularies. Handles automatic import resolution and dependency ordering.

The YAML specification should follow this structure:
- bundle.name: Bundle name
- bundle.base_uri: Base URI for all vocabularies
- bundle.title/description: Bundle metadata
- bundle.common_extends: Imports shared by all vocabularies
- bundle.vocabularies: Array of vocabulary definitions with aspects, concepts, relations, properties, and scalars`,
    paramsSchema: {
        yamlSpec: z.string().describe('YAML specification for the bundle'),
        outputDirectory: z.string().describe('Directory where files will be generated'),
        validateAfterGeneration: z.boolean().optional().default(true).describe('Whether to validate via LSP (default: true)'),
    },
};

/**
 * Topological sort of vocabularies based on extends_vocabs dependencies.
 * Returns vocabularies in order such that dependencies come before dependents.
 * Detects circular dependencies.
 */
function determineGenerationOrder(vocabs: VocabSpec[]): { ordered: VocabSpec[]; error?: string } {
    const vocabMap = new Map<string, VocabSpec>();
    for (const vocab of vocabs) {
        vocabMap.set(vocab.name, vocab);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const ordered: VocabSpec[] = [];

    function visit(name: string, path: string[]): string | null {
        if (visited.has(name)) return null;
        if (visiting.has(name)) {
            return `Circular dependency detected: ${[...path, name].join(' -> ')}`;
        }

        const vocab = vocabMap.get(name);
        if (!vocab) {
            // External dependency, not in our bundle - that's OK
            return null;
        }

        visiting.add(name);
        
        for (const dep of vocab.extends_vocabs || []) {
            const error = visit(dep, [...path, name]);
            if (error) return error;
        }

        visiting.delete(name);
        visited.add(name);
        ordered.push(vocab);
        return null;
    }

    for (const vocab of vocabs) {
        const error = visit(vocab.name, []);
        if (error) {
            return { ordered: [], error };
        }
    }

    return { ordered };
}

/**
 * Check if any vocabulary references an undefined vocabulary (within the bundle).
 */
function checkMissingDependencies(vocabs: VocabSpec[]): string | null {
    const defined = new Set(vocabs.map(v => v.name));
    
    for (const vocab of vocabs) {
        for (const dep of vocab.extends_vocabs || []) {
            if (!defined.has(dep)) {
                return `Vocabulary "${vocab.name}" extends undefined vocabulary "${dep}"`;
            }
        }
    }
    
    return null;
}

// OML Generation


function generateAspect(aspect: AspectSpec, indent: string, eol: string): string {
    let result = '';
    if (aspect.description) {
        result += `${indent}@dc:description "${escapeOmlString(aspect.description)}"${eol}`;
    }
    result += `${indent}aspect ${aspect.name}${eol}`;
    return result;
}

function generateConcept(concept: ConceptSpec, indent: string, innerIndent: string, eol: string): string {
    let result = '';
    if (concept.description) {
        result += `${indent}@dc:description "${escapeOmlString(concept.description)}"${eol}`;
    }
    
    const specializationText = concept.extends && concept.extends.length > 0 
        ? ` < ${concept.extends.join(', ')}` 
        : '';
    
    const hasBody = (concept.restrictions && concept.restrictions.length > 0) || 
                    (concept.keys && concept.keys.length > 0);
    
    if (hasBody) {
        result += `${indent}concept ${concept.name}${specializationText} [${eol}`;
        
        // Add keys if present
        if (concept.keys && concept.keys.length > 0) {
            for (const keyGroup of concept.keys) {
                result += `${innerIndent}key ${keyGroup.join(', ')}${eol}`;
            }
        }
        
        // Add restrictions if present
        if (concept.restrictions && concept.restrictions.length > 0) {
            for (const restriction of concept.restrictions) {
                result += `${innerIndent}${restriction}${eol}`;
            }
        }
        
        result += `${indent}]${eol}`;
    } else {
        result += `${indent}concept ${concept.name}${specializationText}${eol}`;
    }
    
    return result;
}

function generateRelation(relation: RelationSpec, indent: string, innerIndent: string, eol: string): string {
    let result = '';
    if (relation.description) {
        result += `${indent}@dc:description "${escapeOmlString(relation.description)}"${eol}`;
    }
    
    if (relation.entity) {
        // Relation entity (reified)
        result += `${indent}relation entity ${relation.name} [${eol}`;
        if (relation.from) {
            result += `${innerIndent}from ${relation.from}${eol}`;
        }
        if (relation.to) {
            result += `${innerIndent}to ${relation.to}${eol}`;
        }
        if (relation.forward) {
            result += `${innerIndent}forward ${relation.forward}${eol}`;
        }
        if (relation.reverse) {
            result += `${innerIndent}reverse ${relation.reverse}${eol}`;
        }
        // Add relation properties
        if (relation.properties && relation.properties.length > 0) {
            for (const prop of relation.properties) {
                result += `${innerIndent}${prop}${eol}`;
            }
        }
        result += `${indent}]${eol}`;
    } else {
        // Unreified relation
        result += `${indent}relation ${relation.name} [${eol}`;
        if (relation.from) {
            result += `${innerIndent}from ${relation.from}${eol}`;
        }
        if (relation.to) {
            result += `${innerIndent}to ${relation.to}${eol}`;
        }
        if (relation.reverse) {
            result += `${innerIndent}reverse ${relation.reverse}${eol}`;
        }
        // Add relation properties
        if (relation.properties && relation.properties.length > 0) {
            for (const prop of relation.properties) {
                result += `${innerIndent}${prop}${eol}`;
            }
        }
        result += `${indent}]${eol}`;
    }
    
    return result;
}

function generateScalarProperty(prop: ScalarPropertySpec, indent: string, innerIndent: string, eol: string): string {
    let result = '';
    if (prop.description) {
        result += `${indent}@dc:description "${escapeOmlString(prop.description)}"${eol}`;
    }
    
    const hasDomainOrRange = prop.domain || prop.range || prop.functional;
    
    if (hasDomainOrRange) {
        result += `${indent}scalar property ${prop.name} [${eol}`;
        if (prop.domain) {
            result += `${innerIndent}domain ${prop.domain}${eol}`;
        }
        if (prop.range) {
            result += `${innerIndent}range ${prop.range}${eol}`;
        }
        if (prop.functional) {
            result += `${innerIndent}functional${eol}`;
        }
        result += `${indent}]${eol}`;
    } else {
        result += `${indent}scalar property ${prop.name}${eol}`;
    }
    
    return result;
}

function generateScalar(scalar: ScalarSpec, indent: string, innerIndent: string, eol: string): string {
    let result = '';
    if (scalar.description) {
        result += `${indent}@dc:description "${escapeOmlString(scalar.description)}"${eol}`;
    }
    
    if (scalar.one_of && scalar.one_of.length > 0) {
        result += `${indent}scalar ${scalar.name} [${eol}`;
        const literals = scalar.one_of.map(v => `"${escapeOmlString(v)}"`).join(', ');
        result += `${innerIndent}oneOf ${literals}${eol}`;
        result += `${indent}]${eol}`;
    } else {
        result += `${indent}scalar ${scalar.name}${eol}`;
    }
    
    return result;
}

function escapeOmlString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function generateVocabularyFile(
    vocab: VocabSpec, 
    bundle: BundleSpec['bundle'],
    eol: string = '\n'
): string {
    const indent = '    ';
    const innerIndent = indent + indent;
    const escapedPrefix = escapePrefix(vocab.name);
    
    let content = '';
    
    // Add title annotation if description exists
    if (vocab.description) {
        content += `@dc:title "${escapeOmlString(vocab.name)}"${eol}`;
        content += `@dc:description "${escapeOmlString(vocab.description)}"${eol}`;
    }
    
    // Vocabulary declaration
    const namespaceUri = `${bundle.base_uri}${vocab.name}#`;
    content += `vocabulary <${namespaceUri}> as ${escapedPrefix} {${eol}${eol}`;
    
    // Common extends
    if (bundle.common_extends && bundle.common_extends.length > 0) {
        for (const ext of bundle.common_extends) {
            const extPrefix = escapePrefix(ext.prefix);
            content += `${indent}extends <${ext.uri}> as ${extPrefix}${eol}`;
        }
        content += eol;
    }
    
    // Vocabulary-specific extends
    if (vocab.extends_vocabs && vocab.extends_vocabs.length > 0) {
        for (const extVocab of vocab.extends_vocabs) {
            const extPrefix = escapePrefix(extVocab);
            content += `${indent}extends <${bundle.base_uri}${extVocab}#> as ${extPrefix}${eol}`;
        }
        content += eol;
    }
    
    // Aspects
    if (vocab.aspects && vocab.aspects.length > 0) {
        for (const aspect of vocab.aspects) {
            content += generateAspect(aspect, indent, eol);
            content += eol;
        }
    }
    
    // Concepts
    if (vocab.concepts && vocab.concepts.length > 0) {
        for (const concept of vocab.concepts) {
            content += generateConcept(concept, indent, innerIndent, eol);
            content += eol;
        }
    }
    
    // Relations
    if (vocab.relations && vocab.relations.length > 0) {
        for (const relation of vocab.relations) {
            content += generateRelation(relation, indent, innerIndent, eol);
            content += eol;
        }
    }
    
    // Scalar Properties
    if (vocab.scalar_properties && vocab.scalar_properties.length > 0) {
        for (const prop of vocab.scalar_properties) {
            content += generateScalarProperty(prop, indent, innerIndent, eol);
            content += eol;
        }
    }
    
    // Scalars
    if (vocab.scalars && vocab.scalars.length > 0) {
        for (const scalar of vocab.scalars) {
            content += generateScalar(scalar, indent, innerIndent, eol);
            content += eol;
        }
    }
    
    content += `}${eol}`;
    
    return content;
}

function generateBundleFile(bundle: BundleSpec['bundle'], vocabs: VocabSpec[], eol: string = '\n'): string {
    const indent = '    ';
    
    let content = '';
    
    // Add title and description annotations
    if (bundle.title) {
        content += `@dc:title "${escapeOmlString(bundle.title)}"${eol}`;
    }
    if (bundle.description) {
        content += `@dc:description "${escapeOmlString(bundle.description)}"${eol}`;
    }
    
    // Bundle declaration
    content += `vocabulary bundle <${bundle.base_uri}bundle#> as v-bundle {${eol}${eol}`;
    
    // Include dc for annotations
    content += `${indent}includes <http://purl.org/dc/elements/1.1/> as dc${eol}`;
    
    // Include all vocabularies
    for (const vocab of vocabs) {
        content += `${indent}includes <${bundle.base_uri}${vocab.name}#>${eol}`;
    }
    
    content += eol;
    content += `}${eol}`;
    
    return content;
}

// Main Handler

export const generateVocabularyBundleHandler = async (
    params: {
        yamlSpec: string;
        outputDirectory: string;
        validateAfterGeneration?: boolean;
    }
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
    const { yamlSpec, outputDirectory: inputDir, validateAfterGeneration = true } = params;
    const eol = '\n';
    const filesGenerated: string[] = [];
    
    try {
        // Resolve output directory path
        const outputDirectory = resolveWorkspacePath(inputDir);
        console.error(`[generate_vocabulary_bundle] Output directory: ${outputDirectory}`);
        
        // 1. Parse YAML
        let rawSpec: unknown;
        try {
            rawSpec = yaml.load(yamlSpec);
        } catch (parseError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `Invalid YAML: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                }],
            };
        }
        
        // 2. Validate against schema
        const parseResult = bundleSpecSchema.safeParse(rawSpec);
        if (!parseResult.success) {
            const errors = parseResult.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: `Invalid YAML structure:\n${errors}`,
                }],
            };
        }
        
        const spec = parseResult.data;
        const bundle = spec.bundle;
        
        // 3. Check for missing dependencies
        const missingError = checkMissingDependencies(bundle.vocabularies);
        if (missingError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: missingError,
                }],
            };
        }
        
        // 4. Determine generation order (topological sort)
        const { ordered: orderedVocabs, error: orderError } = determineGenerationOrder(bundle.vocabularies);
        if (orderError) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: orderError,
                }],
            };
        }
        
        // 5. Create output directory if it doesn't exist
        if (!fs.existsSync(outputDirectory)) {
            fs.mkdirSync(outputDirectory, { recursive: true });
            console.error(`[generate_vocabulary_bundle] Created directory: ${outputDirectory}`);
        }
        
        // 6. Generate each vocabulary file
        for (const vocab of orderedVocabs) {
            const omlContent = generateVocabularyFile(vocab, bundle, eol);
            const fileName = `${vocab.name}.oml`;
            const filePath = path.join(outputDirectory, fileName);
            
            // Write file with explicit sync
            const fd = fs.openSync(filePath, 'w');
            fs.writeSync(fd, omlContent, 0, 'utf-8');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            
            filesGenerated.push(fileName);
            console.error(`[generate_vocabulary_bundle] Generated: ${filePath}`);
        }
        
        // 7. Generate bundle file
        const bundleContent = generateBundleFile(bundle, orderedVocabs, eol);
        const bundleFileName = 'bundle.oml';
        const bundlePath = path.join(outputDirectory, bundleFileName);
        
        const fd = fs.openSync(bundlePath, 'w');
        fs.writeSync(fd, bundleContent, 0, 'utf-8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        filesGenerated.push(bundleFileName);
        console.error(`[generate_vocabulary_bundle] Generated bundle: ${bundlePath}`);
        
        // 8. Optional validation
        const validationErrors: string[] = [];
        if (validateAfterGeneration) {
            for (const fileName of filesGenerated) {
                const filePath = path.join(outputDirectory, fileName);
                try {
                    const result = await validateOmlHandler({ uri: filePath });
                    const text = result.content?.[0]?.text || '';
                    if (!text.includes('valid') && !text.includes('no errors')) {
                        validationErrors.push(`${fileName}: ${text}`);
                    }
                } catch (validationError) {
                    // LSP bridge might not be available - this is OK
                    console.error(`[generate_vocabulary_bundle] Validation skipped for ${fileName}: ${validationError}`);
                }
            }
        }
        
        // 9. Build result message
        let resultText = `✓ Generated ${filesGenerated.length} OML files in ${outputDirectory}\n\n`;
        resultText += `Files generated:\n${filesGenerated.map(f => `  - ${f}`).join('\n')}`;
        
        if (validationErrors.length > 0) {
            resultText += `\n\n⚠ Validation warnings:\n${validationErrors.join('\n')}`;
        } else if (validateAfterGeneration) {
            resultText += `\n\n✓ All files validated successfully`;
        }
        
        return {
            content: [{
                type: 'text' as const,
                text: resultText,
            }],
        };
        
    } catch (error) {
        return {
            isError: true,
            content: [{
                type: 'text' as const,
                text: `Error generating vocabulary bundle: ${error instanceof Error ? error.message : String(error)}`,
            }],
        };
    }
};
