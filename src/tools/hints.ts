/**
 * Context-group hints, published on each tool as `_meta.mint` (the mcp-host
 * context-groups contract). Inert data: a host that does not read them sees an
 * extra `_meta` key and nothing else. The shape is fixed by the host's
 * contract, so it is restated here rather than imported — this server takes no
 * dependency on mcp-host.
 *
 * Every tool here is in the `family` group. None is `canonical`: this server
 * reads ONE order behind an emailed link (a credential, passed per call or set
 * as a default), so it has no feed that answers "what's new / due / on", no
 * date range, and no listable set of subjects to fan a question out over. The
 * hints are lookups and one write, and declare no `subject` or `when`.
 *
 * `aliases` are the words a person says (lowercase, at most 8, each at most 40
 * chars), never tool names.
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'family';
  intent: MintIntent;
  aliases?: string[];
}

/** `_meta` for an accesso tool: every tool here is in the `family` group. */
export function familyMeta(intent: MintIntent, aliases?: string[]): { mint: MintHint } {
  return { mint: { domain: 'family', intent, ...(aliases ? { aliases } : {}) } };
}

/** What people call what is on an order. */
export const ORDER_ALIASES = ['tickets', 'my tickets', 'ticket order', 'admission', 'park tickets', 'entry time'];
/** What people call the scannable code. */
export const BARCODE_ALIASES = ['barcode', 'barcodes', 'scan code', 'ticket image'];
/** What people call a phone pass. */
export const WALLET_ALIASES = ['google wallet', 'wallet pass', 'add to wallet', 'phone ticket'];
