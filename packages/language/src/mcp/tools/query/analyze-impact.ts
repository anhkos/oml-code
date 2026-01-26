import { z } from 'zod';
import * as fs from 'fs';
import { pathToFileUri, fileUriToPath, findSymbolReferences } from '../common.js';

const paramsSchema = {
    ontology: z.string().describe('ABSOLUTE file path to the ontology containing the symbol'),
    symbol: z.string().describe('Name of the symbol to analyze (term, instance, property, etc.)'),
};

export const analyzeImpactTool = {
    name: 'analyze_impact' as const,
    description: `Analyzes the impact of modifying or deleting a symbol across the workspace.

This tool scans all .oml files in the workspace to find references to the specified symbol.
Use this BEFORE deleting or renaming symbols to understand the impact.

Returns:
- Count of references by type (specializations, instances, restrictions, etc.)
- File locations with line numbers and context
- Summary of potential impact

Example: analyze_impact("Vehicle") might show:
- 3 concepts that specialize Vehicle
- 5 instances typed as Vehicle  
- 2 restrictions referencing Vehicle`,
    paramsSchema,
};

export const analyzeImpactHandler = async (
    { ontology, symbol }: { ontology: string; symbol: string }
) => {
    try {
        const fileUri = pathToFileUri(ontology);
        const filePath = fileUriToPath(fileUri);

        if (!fs.existsSync(filePath)) {
            return {
                isError: true,
                content: [{ type: 'text' as const, text: `Ontology not found at ${filePath}` }],
            };
        }

        // Perform comprehensive impact analysis
        const impact = await findSymbolReferences(symbol, filePath, {
            searchSpecializations: true,
            searchInstances: true,
            searchPropertyUsage: true,
            searchImports: true,
        });

        if (impact.references.length === 0) {
            return {
                content: [{
                    type: 'text' as const,
                    text: `✓ No external references found for "${symbol}"\n\nThis symbol appears to be safe to modify or delete without affecting other files.`
                }],
            };
        }

        // Build detailed report
        const lines: string[] = [
            `📊 IMPACT ANALYSIS for "${symbol}"`,
            '',
            impact.summary,
            '',
        ];

        // Group by file
        const byFile = new Map<string, typeof impact.references>();
        for (const ref of impact.references) {
            const existing = byFile.get(ref.file) || [];
            existing.push(ref);
            byFile.set(ref.file, existing);
        }

        lines.push(`Affected files (${byFile.size}):`);
        lines.push('');

        for (const [file, refs] of byFile) {
            lines.push(`📄 ${file} (${refs.length} reference${refs.length > 1 ? 's' : ''}):`);
            
            // Group by type within file
            const byType = new Map<string, typeof refs>();
            for (const ref of refs) {
                const existing = byType.get(ref.type) || [];
                existing.push(ref);
                byType.set(ref.type, existing);
            }

            for (const [type, typeRefs] of byType) {
                const typeLabel = {
                    specialization: '↳ Specializations',
                    instance: '📦 Instances',
                    restriction: '🔒 Restrictions',
                    property: '🏷️ Property usages',
                    import: '📥 Imports',
                    reference: '🔗 References',
                }[type] || type;

                lines.push(`  ${typeLabel}:`);
                for (const ref of typeRefs.slice(0, 5)) {
                    lines.push(`    L${ref.line}: ${ref.context}`);
                }
                if (typeRefs.length > 5) {
                    lines.push(`    ... and ${typeRefs.length - 5} more`);
                }
            }
            lines.push('');
        }

        lines.push('---');
        lines.push('⚠️ Modifying or deleting this symbol will affect the above references.');
        lines.push('Consider updating these files first, or use force=true with delete tools.');

        return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
    } catch (error) {
        return {
            isError: true,
            content: [
                { type: 'text' as const, text: `Error analyzing impact: ${error instanceof Error ? error.message : String(error)}` },
            ],
        };
    }
};
