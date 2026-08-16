import { McpToolError, errorResult } from '@chrischall/mcp-utils';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Surface an `McpToolError`'s `hint` to the caller.
 *
 * The MCP tool boundary turns a thrown error into a result carrying only
 * `message`, so a `hint` — which is where the actionable half lives here ("the
 * available options are …", "the school describes the note as …") — is
 * otherwise dropped on the floor. Wrapping the handler folds it into the text
 * the caller actually sees.
 *
 * Only `McpToolError` is handled: an unexpected error keeps propagating, so a
 * genuine bug still reads as one instead of being flattened into advice.
 */
export function withHints<A>(
  handler: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof McpToolError && err.hint) {
        return errorResult(`${err.message}\n\nHint: ${err.hint}`);
      }
      throw err;
    }
  };
}
