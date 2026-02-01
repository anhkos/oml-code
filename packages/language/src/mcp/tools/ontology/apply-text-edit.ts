/**
 * Apply Text Edit Tool
 * 
 * Performs text-level edits on OML files without requiring valid AST.
 * Works on files with syntax errors - useful for fixing broken files.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { resolveWorkspacePath } from '../common.js';
import { createLogger, handleError, FileNotFoundError, FileReadError } from '../common/index.js';

const logger = createLogger('apply-text-edit');

/**
 * Schema for a single text edit
 */
const textEditSchema = z.object({
    lineNumber: z.number().int().positive().describe('1-based line number to edit'),
    oldText: z.string().describe('Text to find on the line (substring match)'),
    newText: z.string().describe('Replacement text'),
});

/**
 * Schema for range-based edits (more precise)
 */
const rangeEditSchema = z.object({
    startLine: z.number().int().positive().describe('1-based start line'),
    startColumn: z.number().int().nonnegative().describe('0-based start column'),
    endLine: z.number().int().positive().describe('1-based end line'),
    endColumn: z.number().int().nonnegative().describe('0-based end column'),
    newText: z.string().describe('Replacement text'),
});

export const applyTextEditTool = {
    name: 'apply_text_edit',
    description: `Apply text-level edits to an OML file. Works even on files with syntax errors.

⚠️ ONLY use this tool when:
- The file has syntax errors that prevent AST-based tools from working
- Fixing typos, wrong keywords (e.g., "extends" → "<")
- The file won't parse correctly and you need to fix it before using semantic tools

✅ For semantic operations on VALID files, use the proper tools instead:
- Adding imports: use add_import or ensure_imports
- Creating concepts/relations: use create_concept, create_relation
- Modifying terms: use update_term, add_specialization
- Managing axioms: use add_restriction, add_equivalence

Supports two edit modes:
1. Line-based: Find and replace text on a specific line
2. Range-based: Replace text at specific line:column positions

Examples:
- Fix "extends" to "<": lineNumber: 21, oldText: "extends", newText: "<"
- Fix namespace typo: lineNumber: 3, oldText: "htpp://", newText: "http://"
- Add missing semicolon: lineNumber: 10, oldText: "", newText: ";"`,
    paramsSchema: {
        filePath: z.string().describe('Absolute path to the OML file'),
        lineEdits: z.array(textEditSchema).optional().describe('Line-based edits (find/replace on specific lines)'),
        rangeEdits: z.array(rangeEditSchema).optional().describe('Range-based edits (precise position editing)'),
        insertLines: z.array(z.object({
            afterLine: z.number().int().nonnegative().describe('Insert after this line (0 = beginning of file)'),
            text: z.string().describe('Text to insert (will be a new line)'),
        })).optional().describe('Insert new lines at specific positions'),
        deleteLines: z.array(z.number().int().positive()).optional().describe('1-based line numbers to delete'),
        dryRun: z.boolean().default(false).describe('Preview changes without writing to file'),
    },
};

export const applyTextEditMetadata = {
    id: 'apply_text_edit',
    displayName: 'Apply Text Edit',
    layer: 'utility' as const,
    severity: 'medium' as const,
    version: '1.0.0',
    shortDescription: 'Text-level editing for OML files (works on broken files)',
    description: 'Apply text edits without requiring valid AST. Useful for fixing syntax errors.',
    tags: ['editing', 'text', 'syntax-fix', 'utility'],
    dependencies: [],
    addedDate: '2026-02-01',
};

interface TextEdit {
    lineNumber: number;
    oldText: string;
    newText: string;
}

interface RangeEdit {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    newText: string;
}

interface InsertLine {
    afterLine: number;
    text: string;
}

interface ApplyTextEditParams {
    filePath: string;
    lineEdits?: TextEdit[];
    rangeEdits?: RangeEdit[];
    insertLines?: InsertLine[];
    deleteLines?: number[];
    dryRun?: boolean;
}

interface EditResult {
    type: 'line' | 'range' | 'insert' | 'delete';
    line: number;
    description: string;
    success: boolean;
    error?: string;
}

export async function applyTextEditHandler(params: ApplyTextEditParams) {
    try {
        const { filePath, lineEdits, rangeEdits, insertLines, deleteLines, dryRun = false } = params;

        // Resolve and validate file path
        let resolvedPath: string;
        if (path.isAbsolute(filePath)) {
            resolvedPath = filePath;
        } else {
            resolvedPath = resolveWorkspacePath(filePath);
        }

        logger.info(`Processing text edits`, { path: resolvedPath, dryRun });

        if (!fs.existsSync(resolvedPath)) {
            throw new FileNotFoundError(resolvedPath);
        }

        // Read file content
        let content: string;
        try {
            content = fs.readFileSync(resolvedPath, 'utf-8');
        } catch (err) {
            throw new FileReadError(resolvedPath, err as Error);
        }

        // Split into lines (preserve line endings)
        let lines = content.split(/\r?\n/);
        const results: EditResult[] = [];

        // Track line number adjustments for inserts/deletes
        let lineOffset = 0;

        // 1. Apply line-based edits first
        if (lineEdits && lineEdits.length > 0) {
            for (const edit of lineEdits) {
                const adjustedLine = edit.lineNumber + lineOffset;
                if (adjustedLine < 1 || adjustedLine > lines.length) {
                    results.push({
                        type: 'line',
                        line: edit.lineNumber,
                        description: `Replace "${edit.oldText}" with "${edit.newText}"`,
                        success: false,
                        error: `Line ${edit.lineNumber} out of range (file has ${lines.length} lines)`,
                    });
                    continue;
                }

                const lineIndex = adjustedLine - 1;
                const originalLine = lines[lineIndex];

                if (edit.oldText === '') {
                    // Empty oldText means append to line
                    lines[lineIndex] = originalLine + edit.newText;
                    results.push({
                        type: 'line',
                        line: edit.lineNumber,
                        description: `Appended "${edit.newText}" to line`,
                        success: true,
                    });
                } else if (originalLine.includes(edit.oldText)) {
                    lines[lineIndex] = originalLine.replace(edit.oldText, edit.newText);
                    results.push({
                        type: 'line',
                        line: edit.lineNumber,
                        description: `Replaced "${edit.oldText}" with "${edit.newText}"`,
                        success: true,
                    });
                } else {
                    results.push({
                        type: 'line',
                        line: edit.lineNumber,
                        description: `Replace "${edit.oldText}" with "${edit.newText}"`,
                        success: false,
                        error: `Text "${edit.oldText}" not found on line ${edit.lineNumber}`,
                    });
                }
            }
        }

        // 2. Apply range-based edits (more precise)
        if (rangeEdits && rangeEdits.length > 0) {
            // Sort by position (reverse order to maintain indices)
            const sortedRangeEdits = [...rangeEdits].sort((a, b) => {
                if (b.startLine !== a.startLine) return b.startLine - a.startLine;
                return b.startColumn - a.startColumn;
            });

            for (const edit of sortedRangeEdits) {
                const startIdx = edit.startLine - 1 + lineOffset;
                const endIdx = edit.endLine - 1 + lineOffset;

                if (startIdx < 0 || endIdx >= lines.length) {
                    results.push({
                        type: 'range',
                        line: edit.startLine,
                        description: `Range edit at ${edit.startLine}:${edit.startColumn}-${edit.endLine}:${edit.endColumn}`,
                        success: false,
                        error: 'Range out of bounds',
                    });
                    continue;
                }

                if (edit.startLine === edit.endLine) {
                    // Single-line range edit
                    const line = lines[startIdx];
                    const before = line.substring(0, edit.startColumn);
                    const after = line.substring(edit.endColumn);
                    lines[startIdx] = before + edit.newText + after;
                } else {
                    // Multi-line range edit
                    const firstLine = lines[startIdx].substring(0, edit.startColumn);
                    const lastLine = lines[endIdx].substring(edit.endColumn);
                    const newLines = edit.newText.split('\n');
                    
                    // Combine first line prefix + new text + last line suffix
                    if (newLines.length === 1) {
                        lines.splice(startIdx, endIdx - startIdx + 1, firstLine + newLines[0] + lastLine);
                        lineOffset -= (endIdx - startIdx);
                    } else {
                        newLines[0] = firstLine + newLines[0];
                        newLines[newLines.length - 1] = newLines[newLines.length - 1] + lastLine;
                        lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
                        lineOffset += newLines.length - (endIdx - startIdx + 1);
                    }
                }

                results.push({
                    type: 'range',
                    line: edit.startLine,
                    description: `Range edit at ${edit.startLine}:${edit.startColumn}-${edit.endLine}:${edit.endColumn}`,
                    success: true,
                });
            }
        }

        // 3. Insert new lines (process in reverse order to maintain indices)
        if (insertLines && insertLines.length > 0) {
            const sortedInserts = [...insertLines].sort((a, b) => b.afterLine - a.afterLine);
            
            for (const insert of sortedInserts) {
                const insertIdx = insert.afterLine + lineOffset;
                if (insertIdx < 0 || insertIdx > lines.length) {
                    results.push({
                        type: 'insert',
                        line: insert.afterLine,
                        description: `Insert line after ${insert.afterLine}`,
                        success: false,
                        error: `Position ${insert.afterLine} out of range`,
                    });
                    continue;
                }

                lines.splice(insertIdx, 0, insert.text);
                lineOffset++;
                results.push({
                    type: 'insert',
                    line: insert.afterLine,
                    description: `Inserted line after ${insert.afterLine}`,
                    success: true,
                });
            }
        }

        // 4. Delete lines (process in reverse order)
        if (deleteLines && deleteLines.length > 0) {
            const sortedDeletes = [...deleteLines].sort((a, b) => b - a);
            
            for (const lineNum of sortedDeletes) {
                const deleteIdx = lineNum - 1 + lineOffset;
                if (deleteIdx < 0 || deleteIdx >= lines.length) {
                    results.push({
                        type: 'delete',
                        line: lineNum,
                        description: `Delete line ${lineNum}`,
                        success: false,
                        error: `Line ${lineNum} out of range`,
                    });
                    continue;
                }

                lines.splice(deleteIdx, 1);
                lineOffset--;
                results.push({
                    type: 'delete',
                    line: lineNum,
                    description: `Deleted line ${lineNum}`,
                    success: true,
                });
            }
        }

        // Build result content
        const newContent = lines.join('\n');
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        if (dryRun) {
            logger.info(`Dry run complete`, { successCount, failCount });
            return {
                content: [{
                    type: 'text' as const,
                    text: `## Dry Run Results\n\n` +
                        `**${successCount} edits would succeed, ${failCount} would fail**\n\n` +
                        `### Edit Results:\n${formatResults(results)}\n\n` +
                        `### Preview:\n\`\`\`oml\n${newContent}\n\`\`\``,
                }],
            };
        }

        // Write the file
        fs.writeFileSync(resolvedPath, newContent, 'utf-8');
        logger.info(`File updated`, { path: resolvedPath, successCount, failCount });

        return {
            content: [{
                type: 'text' as const,
                text: `## Text Edit Results\n\n` +
                    `**${successCount} edits applied, ${failCount} failed**\n\n` +
                    `### Edit Results:\n${formatResults(results)}\n\n` +
                    `File saved: \`${resolvedPath}\``,
            }],
        };

    } catch (error) {
        return handleError(error, 'apply_text_edit', logger);
    }
}

function formatResults(results: EditResult[]): string {
    return results.map(r => {
        const icon = r.success ? '✓' : '✗';
        const errorMsg = r.error ? ` - ${r.error}` : '';
        return `- ${icon} Line ${r.line}: ${r.description}${errorMsg}`;
    }).join('\n');
}
