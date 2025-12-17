import { z } from 'zod';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js';
import {
  CompletionRequest,
  CompletionParams,
  CompletionItem,
  CompletionList,
  TextDocumentIdentifier,
  Position
} from 'vscode-languageserver-protocol';

const LSP_BRIDGE_PORT = 5007;

/**
 * Convert a file path to a file URI
 */
function pathToFileUri(filePath: string): string {
  if (filePath.startsWith('file://')) {
    return filePath;
  }
  const normalized = path.resolve(filePath);
  const withForwardSlashes = normalized.replace(/\\/g, '/');
  const absolute = withForwardSlashes.startsWith('/') ? withForwardSlashes : '/' + withForwardSlashes;
  return 'file://' + absolute;
}

/**
 * Tool: suggest_super_concepts
 * Queries the language server for completion suggestions at a specialization point.
 * Returns the same suggestions you'd see in VS Code intellisense.
 * 
 * IMPORTANT: This tool ONLY returns suggestions. It does NOT modify files.
 * After getting suggestions, ASK THE USER which one they want, then use
 * add_specialization (with auto-import) to apply their choice.
 */
export const suggestSuperConceptsTool = {
  name: 'suggest_super_concepts',
  description: 'REQUIRED FIRST STEP for specialization: Query available super-concepts from the workspace. Returns a numbered list of existing concepts/aspects. CRITICAL: (1) Present ALL options to user, (2) Wait for user to choose by number or name, (3) NEVER create new concepts - only use what this tool returns. User MUST make the choice, not you.',
  paramsSchema: {
    ontology: z.string().describe('File path or file:// URI to the vocabulary to analyze'),
    term: z.string().optional().describe('[Optional] Name of the term being specialized (for context)'),
    prefix: z.string().optional().describe('[Optional] Filter prefix (e.g., "base:" to only show base:* concepts)')
  }
};

export interface SuperConceptSuggestion {
  index: number;  // 1-based index for easy reference
  label: string;
  detail?: string;
  kind?: number;
  importStatement?: string;  // The import that would be auto-added
}

export async function suggestSuperConcepts(input: any) {
  const { ontology, prefix } = input;

  if (!ontology || typeof ontology !== 'string') {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Error: ontology parameter is required' }],
    };
  }

  const fileUri = pathToFileUri(ontology);
  
  // Check file exists
  const filePath = path.resolve(ontology.replace(/^file:\/\//, '').replace(/\//g, path.sep));
  if (!fs.existsSync(filePath)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Error: File not found at ${filePath}` }],
    };
  }

  let socket: net.Socket | undefined;
  let connection: ReturnType<typeof createMessageConnection> | undefined;

  try {
    // Read the file to find a good position to request completions
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');
    
    // Find a position where super-concept completions would appear
    // This is right after "<" in "concept X <" or after "," in "concept X < A,"
    let targetLine = -1;
    let targetChar = 0;
    let foundConceptDecl = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Look for concept/aspect declarations with specialization
      // Pattern: concept Name < (ignore any partial input after <)
      const specMatch = line.match(/(concept|aspect)\s+\w+\s*</);
      if (specMatch) {
        targetLine = i;
        // Always position right after < to get full completions
        const ltIndex = line.indexOf('<');
        targetChar = ltIndex + 1;
        // Skip whitespace after <
        while (targetChar < line.length && line[targetChar] === ' ') {
          targetChar++;
        }
        foundConceptDecl = true;
        console.error(`[suggest] Found specialization at line ${i}: "${line.substring(0, 50)}..."`);
        break;
      }
    }
    
    // If no specialization found, look for any concept declaration and position after it
    if (!foundConceptDecl) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const conceptMatch = line.match(/(concept|aspect)\s+(\w+)/);
        if (conceptMatch) {
          targetLine = i;
          // Position at end of concept name, where user might type " < "
          targetChar = line.indexOf(conceptMatch[2]) + conceptMatch[2].length;
          console.error(`[suggest] Found concept without spec at line ${i}, char ${targetChar}`);
          break;
        }
      }
    }
    
    // Last resort: position inside the vocabulary body
    if (targetLine < 0) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('{')) {
          targetLine = i + 1;
          targetChar = 4; // Indented position
          console.error(`[suggest] Using fallback position after opening brace`);
          break;
        }
      }
    }

    if (targetLine < 0) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'Could not find a suitable position in the file for completions' }],
      };
    }

    console.error(`[suggest] Requesting completions at line ${targetLine}, char ${targetChar}`);
    console.error(`[suggest] Line content: "${lines[targetLine]}"`);

    // Connect to the LSP bridge
    socket = net.connect({ port: LSP_BRIDGE_PORT });

    await new Promise<void>((resolve, reject) => {
      socket!.on('connect', () => resolve());
      socket!.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('Connection timeout - is VS Code running with OML extension?')), 5000);
    });

    const reader = new StreamMessageReader(socket);
    const writer = new StreamMessageWriter(socket);
    connection = createMessageConnection(reader, writer);
    connection.listen();

    // Request completions at the target position
    const completionParams: CompletionParams = {
      textDocument: TextDocumentIdentifier.create(fileUri),
      position: Position.create(targetLine, targetChar),
      context: {
        triggerKind: 1 // Invoked (manual trigger like Ctrl+Space)
      }
    };

    console.error(`[suggest_super_concepts] Requesting completions at ${fileUri} line ${targetLine}:${targetChar}`);

    const completionResponse = await connection.sendRequest<CompletionList | CompletionItem[] | null>(
      CompletionRequest.method,
      completionParams
    );

    connection.dispose();
    socket.end();

    // Parse completions
    let items: CompletionItem[] = [];
    if (completionResponse) {
      if (Array.isArray(completionResponse)) {
        items = completionResponse;
        console.error(`[suggest] Got array response with ${items.length} items`);
      } else if ('items' in completionResponse) {
        items = completionResponse.items;
        console.error(`[suggest] Got CompletionList with ${items.length} items`);
      } else {
        console.error(`[suggest] Unknown response format:`, JSON.stringify(completionResponse).substring(0, 200));
      }
    } else {
      console.error(`[suggest] Got null/undefined response`);
    }

    // Log first few items for debugging
    if (items.length > 0) {
      console.error(`[suggest] First 5 items:`, items.slice(0, 5).map(i => ({ label: i.label, kind: i.kind, detail: i.detail })));
    }

    // Filter for type-like completions (concepts, aspects)
    // Keep items that look like type references: prefix:Name, Name, or have Class/Interface kind
    let suggestions: SuperConceptSuggestion[] = items
      .filter(item => {
        const label = item.label;
        // CompletionItemKind: 7 = Class, 8 = Interface, 22 = Struct
        const isTypeKind = item.kind && [7, 8, 22].includes(item.kind);
        // Or label looks like a type (starts with capital, possibly prefixed)
        const looksLikeType = /^[A-Z]/.test(label) || /^[\w-]+:[A-Z]/.test(label);
        return isTypeKind || looksLikeType;
      })
      .map((item, index) => {
        // Extract import statement from additionalTextEdits if present
        let importStatement: string | undefined;
        if (item.additionalTextEdits && item.additionalTextEdits.length > 0) {
          // The newText usually contains the import statement
          importStatement = item.additionalTextEdits[0].newText?.trim();
        }
        
        return {
          index: index + 1,  // 1-based index for user-facing display
          label: item.label,
          detail: item.detail,
          kind: item.kind,
          importStatement
        };
      });

    // Apply prefix filter if provided
    if (prefix && typeof prefix === 'string') {
      const filterPrefix = prefix.toLowerCase();
      suggestions = suggestions.filter(s => s.label.toLowerCase().startsWith(filterPrefix));
      console.error(`[suggest] Applied prefix filter "${prefix}", ${suggestions.length} items remaining`);
    }

    // Format output
    if (suggestions.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No super-concept suggestions found. This could mean:\n' +
                '- The vocabulary has no imports with concepts/aspects\n' +
                '- The language server is not running\n' +
                '- The file has no existing concept declarations to analyze'
        }],
      };
    }

    // Format as a numbered list for user selection
    const formattedList = suggestions
      .map((s) => {
        let line = `${s.index}. **${s.label}**`;
        if (s.detail) line += ` - ${s.detail}`;
        if (s.importStatement) line += `\n   └─ Will add import: \`${s.importStatement}\``;
        return line;
      })
      .join('\n');

    const promptText = `Found ${suggestions.length} available super-concepts:\n\n${formattedList}\n\n` +
      `⚠️ **STOP: User MUST choose - DO NOT proceed without explicit user selection**\n` +
      `⚠️ **DO NOT create new concepts - ONLY use concepts from this list**\n\n` +
      `ASK THE USER: "I found ${suggestions.length} existing concepts. Which one should ${input.term || 'the term'} extend? Choose by number (1-${suggestions.length}) or name."\n\n` +
      `After user responds, call add_specialization with both suggestionIndex = their chosen number AND importStatement from that suggestion (if present) so the import is added automatically.`;
    return {
      content: [
        {
          type: 'text' as const,
          text: promptText,
        },
        {
          type: 'text' as const,
          text: JSON.stringify({ suggestions, count: suggestions.length }, null, 2),
        },
      ],
    };

  } catch (error) {
    if (connection) connection.dispose();
    if (socket) socket.end();

    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: `Failed to get completions: ${error instanceof Error ? error.message : String(error)}.\n` +
              'Make sure VS Code is running with the OML extension active.',
      }],
    };
  }
}
