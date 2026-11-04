import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { AccessoClient } from '../src/client.js';
import { NoFileIO } from '../src/io.js';
import { registerTicketTools } from '../src/tools/tickets.js';
import { HOST, ORDER_HTML, fakeFetch } from './helpers.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * asserted against the served tool list — what a host actually sees.
 *
 * This MCP reads one ticket order behind an emailed link; it has no feed that
 * answers "what's new / what's due / what's on" across a person's life, no
 * date range and no listable subjects. So every hint is a lookup or a write,
 * and nothing is canonical — the canonical-read checks below hold vacuously
 * and stay to catch a tool that later claims canonical without earning it.
 */
type Listed = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, { enum?: unknown[] }> };
  _meta?: { mint?: Record<string, unknown> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  accesso_get_order: 'lookup',
  accesso_get_ticket: 'lookup',
  accesso_get_wallet_passes: 'lookup',
  accesso_resolve_link: 'lookup',
  accesso_save_barcodes: 'other',
};

async function served(): Promise<Listed[]> {
  const client = new AccessoClient({ fetch: fakeFetch({ [HOST]: { body: ORDER_HTML } }) });
  const h = await createTestHarness((server) => registerTicketTools(server, { client, io: new NoFileIO() }));
  const { tools } = await h.client.listTools();
  await h.close();
  return tools as Listed[];
}

const hinted = async () => (await served()).filter((t) => !t.name.endsWith('_healthcheck'));
const mintOf = (t: Listed) => t._meta?.mint as Record<string, unknown>;

describe('_meta.mint hints', () => {
  it('names every served tool but the healthcheck, so a new tool cannot skip the decision', async () => {
    expect((await hinted()).map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_INTENT).sort());
  });

  it('every tool but the healthcheck carries domain family and its intent', async () => {
    for (const t of await hinted()) {
      const mint = mintOf(t);
      expect(mint, t.name).toBeDefined();
      expect(mint.domain, t.name).toBe('family');
      expect(mint.intent, t.name).toBe(EXPECTED_INTENT[t.name]);
    }
  });

  it('the healthcheck carries no hint', async () => {
    const health = (await served()).find((t) => t.name === 'accesso_healthcheck');
    expect(health).toBeDefined();
    expect(health?._meta?.mint).toBeUndefined();
  });

  it('every hint is shaped per the host contract', async () => {
    for (const t of await hinted()) {
      const mint = mintOf(t);
      const props = t.inputSchema.properties ?? {};
      expect(Object.keys(mint).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS, t.name).toContain(mint.domain);
      expect(INTENTS, t.name).toContain(mint.intent);
      if ('subject' in mint) expect(props, t.name).toHaveProperty(mint.subject as string);
      if ('when' in mint) {
        const when = mint.when as { start: string; end: string };
        expect(Object.keys(when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(when.start);
        expect(props, t.name).toHaveProperty(when.end);
      }
      if ('aliases' in mint) {
        const aliases = mint.aliases as string[];
        expect(aliases.length, t.name).toBeGreaterThan(0);
        expect(aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of aliases) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
          expect(a, t.name).not.toMatch(/^accesso_/); // words a person says, not tool names
        }
      }
    }
  });

  it('canonical only on read-only whats-new/due/on reads, at most one per intent', async () => {
    const canonical = (await hinted()).filter((t) => mintOf(t).canonical !== undefined);
    const perIntent = new Map<string, number>();
    for (const t of canonical) {
      const mint = mintOf(t);
      expect(mint.canonical, t.name).toBe(true);
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(CANONICAL_INTENTS, t.name).toContain(mint.intent);
      perIntent.set(mint.intent as string, (perIntent.get(mint.intent as string) ?? 0) + 1);
      expect(t.inputSchema.properties?.view?.enum, t.name).toContain('brief');
    }
    for (const [intent, n] of perIntent) expect(n, intent).toBeLessThanOrEqual(1);
    // Nothing here answers a what's-new/due/on question: see the file comment.
    expect(canonical.map((t) => t.name)).toEqual([]);
  });

  it('declares no subject: an emailed ticket link is not a listable set of people or places', async () => {
    for (const t of await hinted()) expect(mintOf(t), t.name).not.toHaveProperty('subject');
  });

  it('gives the ticket reads the words a person says', async () => {
    const byName = new Map((await hinted()).map((t) => [t.name, mintOf(t)]));
    expect(byName.get('accesso_get_order')?.aliases).toEqual(
      expect.arrayContaining(['tickets', 'admission']),
    );
    expect(byName.get('accesso_save_barcodes')?.aliases).toEqual(expect.arrayContaining(['barcode']));
    expect(byName.get('accesso_get_wallet_passes')?.aliases).toEqual(expect.arrayContaining(['google wallet']));
  });
});
