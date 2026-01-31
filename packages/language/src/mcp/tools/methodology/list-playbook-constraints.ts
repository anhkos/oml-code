/**
 * Tool for listing constraints in a methodology playbook.
 * Helps AI models discover constraint IDs for updates.
 */

import { z } from 'zod';
import { 
    resolvePlaybookPath, 
    loadPlaybook, 
    listConstraints, 
    listDescriptionFiles,
    ConstraintInfo 
} from './playbook-helpers.js';

export const listPlaybookConstraintsTool = {
    name: 'list_playbook_constraints' as const,
    description: `List all constraints in a methodology playbook.

USE THIS TOOL FIRST when the user asks to:
- Update a constraint
- Change constraint severity
- Add targetMustBe to a constraint
- Find constraints for a property or concept

This tool helps you discover constraint IDs before calling update_playbook.

MINIMAL CALL (auto-detects playbook):
{
  "workspacePath": "/path/to/project"
}

FILTER BY DESCRIPTION FILE:
{
  "descriptionFile": "stakeholders_requirements.oml"
}

FILTER BY PROPERTY:
{
  "propertyFilter": "isExpressedBy"
}

RETURNS:
- List of constraints with their IDs, messages, and properties
- Description file each constraint belongs to
- Severity levels`,
    paramsSchema: {
        playbookPath: z.string().optional()
            .describe('Path to playbook YAML (auto-detects if not provided)'),
        workspacePath: z.string().optional()
            .describe('Workspace root for auto-detection'),
        descriptionFile: z.string().optional()
            .describe('Filter constraints by description file name (partial match)'),
        propertyFilter: z.string().optional()
            .describe('Filter constraints by property name (partial match)'),
    },
};

export async function listPlaybookConstraintsHandler(params: {
    playbookPath?: string;
    workspacePath?: string;
    descriptionFile?: string;
    propertyFilter?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
        const playbookPath = resolvePlaybookPath(params);
        const playbook = loadPlaybook(playbookPath);
        
        const constraints = listConstraints(playbook, {
            descriptionFile: params.descriptionFile,
            propertyFilter: params.propertyFilter,
        });
        
        if (constraints.length === 0) {
            const descFiles = listDescriptionFiles(playbook);
            return {
                content: [{
                    type: 'text',
                    text: `# No Constraints Found\n\n` +
                        (params.descriptionFile || params.propertyFilter 
                            ? `No constraints match your filter.\n\n` 
                            : `The playbook has no description constraints defined.\n\n`) +
                        `**Available description files:**\n${descFiles.map(f => `- ${f}`).join('\n') || '(none)'}\n\n` +
                        `Use \`extract_description_schemas\` to generate constraints from existing instances.`
                }]
            };
        }
        
        // Group by description file
        const byFile = new Map<string, ConstraintInfo[]>();
        for (const c of constraints) {
            const list = byFile.get(c.descriptionFile) || [];
            list.push(c);
            byFile.set(c.descriptionFile, list);
        }
        
        let output = `# Playbook Constraints\n\n`;
        output += `**Playbook:** ${playbookPath}\n`;
        output += `**Total constraints:** ${constraints.length}\n\n`;
        
        for (const [descFile, fileConstraints] of byFile) {
            output += `## ${descFile}\n\n`;
            
            for (const c of fileConstraints) {
                output += `### \`${c.id}\`\n`;
                output += `- **Message:** ${c.message}\n`;
                output += `- **Applies to:** ${c.appliesTo}\n`;
                output += `- **Severity:** ${c.severity}\n`;
                output += `- **Properties:** ${c.properties.join(', ') || '(none)'}\n\n`;
            }
        }
        
        output += `---\n\n`;
        output += `💡 **Tip:** Use \`update_playbook\` with the constraint ID to modify constraints:\n`;
        output += `\`\`\`json\n`;
        output += `{\n`;
        output += `  "descriptionUpdates": {\n`;
        output += `    "${constraints[0]?.descriptionFile || 'file.oml'}": {\n`;
        output += `      "constraintUpdates": {\n`;
        output += `        "${constraints[0]?.id || 'constraint-id'}": {\n`;
        output += `          "severity": "error",\n`;
        output += `          "propertyUpdates": {\n`;
        output += `            "property:name": { "required": true }\n`;
        output += `          }\n`;
        output += `        }\n`;
        output += `      }\n`;
        output += `    }\n`;
        output += `  }\n`;
        output += `}\n`;
        output += `\`\`\``;
        
        return { content: [{ type: 'text', text: output }] };
        
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                type: 'text',
                text: `# Error\n\n❌ ${message}`
            }]
        };
    }
}
