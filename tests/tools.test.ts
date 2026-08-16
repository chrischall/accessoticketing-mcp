import { describe, expect, it, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AccessoClient } from '../src/client.js';
import { NoFileIO, DiskFileIO } from '../src/io.js';
import { registerTicketTools } from '../src/tools/tickets.js';
import { ORDER_HTML, HOST, TICKET_URL, fakeFetch } from './helpers.js';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WALLET_JWT = { jwt: 'JWT123' };

function harness(
  opts: { fetch?: typeof globalThis.fetch; io?: DiskFileIO | NoFileIO; maxInlineBytes?: number } = {},
) {
  const client = new AccessoClient({
    fetch:
      opts.fetch ??
      fakeFetch({
        [`${HOST}/google-wallet`]: { json: WALLET_JWT },
        [HOST]: { body: ORDER_HTML },
      }),
  });
  const io = opts.io ?? new NoFileIO();
  return createTestHarness((server) =>
    registerTicketTools(server, {
      client,
      io,
      ...(opts.maxInlineBytes !== undefined ? { maxInlineBytes: opts.maxInlineBytes } : {}),
    }),
  );
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('tool surface', () => {
  it('registers the documented tools', async () => {
    const h = await harness();
    const names = (await h.listTools()).map((t) => t.name).sort();
    expect(names).toEqual([
      'accesso_get_order',
      'accesso_get_ticket',
      'accesso_get_wallet_passes',
      'accesso_healthcheck',
      'accesso_resolve_link',
      'accesso_save_barcodes',
    ]);
    await h.close();
  });
});

describe('accesso_get_order', () => {
  it('returns the order and every admission', async () => {
    const h = await harness();
    const out = parseToolResult<{ orderNumber: string; tickets: unknown[] }>(
      await h.callTool('accesso_get_order', { url: TICKET_URL }),
    );
    expect(out.orderNumber).toBe('90000001');
    expect(out.tickets).toHaveLength(12);
    await h.close();
  });

  it('honours compact', async () => {
    const h = await harness();
    const out = parseToolResult<{ tickets: Record<string, unknown>[] }>(
      await h.callTool('accesso_get_order', { url: TICKET_URL, compact: true }),
    );
    expect(out.tickets[0]).not.toHaveProperty('instructions');
    await h.close();
  });

  it('includes terms only on request', async () => {
    const h = await harness();
    const withTerms = parseToolResult<{ tickets: Record<string, unknown>[] }>(
      await h.callTool('accesso_get_order', { url: TICKET_URL, include_terms: true }),
    );
    expect(withTerms.tickets[0]!['termsAndConditions']).toContain('Assumption of Risk');
    await h.close();
  });

  it('surfaces the hint when no link is configured', async () => {
    const h = await harness();
    const res = await h.callTool('accesso_get_order', {});
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/ACCESSO_TICKET_URL/);
    await h.close();
  });
});

describe('accesso_get_ticket', () => {
  it('returns one admission in full', async () => {
    const h = await harness();
    const out = parseToolResult<Record<string, unknown>>(
      await h.callTool('accesso_get_ticket', { url: TICKET_URL, index: 7 }),
    );
    expect(out['packageName']).toBe('Early Drop-Off Week 12');
    expect(out['time']).toBeNull();
    await h.close();
  });

  it('names the valid range when the index is wrong', async () => {
    const h = await harness();
    const res = await h.callTool('accesso_get_ticket', { url: TICKET_URL, index: 99 });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/0–11/);
    await h.close();
  });
});

describe('accesso_save_barcodes', () => {
  it('writes files and returns their paths when the filesystem is the user\'s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-tool-'));
    const h = await harness({ io: new DiskFileIO(dir) });
    const out = parseToolResult<{ saved: { path: string }[] }>(
      await h.callTool('accesso_save_barcodes', { url: TICKET_URL, indexes: [0, 1] }),
    );
    expect(out.saved).toHaveLength(2);
    expect(readdirSync(dir)).toHaveLength(2);
    await h.close();
  });

  it('still names files when the order number could not be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-tool-'));
    const anon = ORDER_HTML.replace(/ticketHeader__orderNumber/g, 'x');
    const h = await harness({ io: new DiskFileIO(dir), fetch: fakeFetch({ [HOST]: { body: anon } }) });
    await h.callTool('accesso_save_barcodes', { url: TICKET_URL, indexes: [0] });
    expect(readdirSync(dir)[0]).toBe('accesso-order-00.png');
    await h.close();
  });

  it('inlines images instead of reporting paths the caller cannot open', async () => {
    // NoFileIO models the hosted case: a written path is on a machine the user
    // has no access to, so claiming "wrote /data/x.png" would be a lie.
    const h = await harness({ io: new NoFileIO() });
    const res = await h.callTool('accesso_save_barcodes', { url: TICKET_URL, indexes: [0] });
    expect(res.content.some((c) => c.type === 'image')).toBe(true);
    await h.close();
  });

  it('inlines on request even when files would persist', async () => {
    const h = await harness({ io: new DiskFileIO(mkdtempSync(join(tmpdir(), 'accesso-tool-'))) });
    const res = await h.callTool('accesso_save_barcodes', { url: TICKET_URL, inline: true });
    expect(res.content.filter((c) => c.type === 'image')).toHaveLength(12);
    await h.close();
  });

  it('drops images past the byte cap and says how many, rather than flooding silently', async () => {
    const h = await harness({ io: new NoFileIO(), maxInlineBytes: 100 });
    const res = await h.callTool('accesso_save_barcodes', { url: TICKET_URL });
    const note = JSON.parse(
      res.content.filter((c) => c.type === 'text').map((c) => c.text).join(''),
    ) as { returned: number; omittedForSize: number };
    expect(note.returned).toBeGreaterThan(0);
    expect(note.omittedForSize).toBe(12 - note.returned);
    await h.close();
  });

  it('rejects an unknown index rather than silently saving nothing', async () => {
    const h = await harness();
    const res = await h.callTool('accesso_save_barcodes', { url: TICKET_URL, indexes: [99] });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/no ticket at index 99/i);
    await h.close();
  });

  it('reports when the selected tickets carry no barcode', async () => {
    const stripped = ORDER_HTML.replace(/src="data:image\/png;base64,[^"]*"/g, 'src=""');
    const h = await harness({ fetch: fakeFetch({ [HOST]: { body: stripped } }) });
    const res = await h.callTool('accesso_save_barcodes', { url: TICKET_URL });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/carry a barcode/i);
    await h.close();
  });
});

describe('accesso_get_wallet_passes', () => {
  it('returns Google save links', async () => {
    const h = await harness();
    const out = parseToolResult<{ passes: { saveUrl: string }[] }>(
      await h.callTool('accesso_get_wallet_passes', { url: TICKET_URL, indexes: [0] }),
    );
    expect(out.passes[0]!.saveUrl).toBe('https://pay.google.com/gp/v/save/JWT123');
    await h.close();
  });

  it('rejects an unknown index', async () => {
    const h = await harness();
    const res = await h.callTool('accesso_get_wallet_passes', { url: TICKET_URL, indexes: [99] });
    expect(res.isError).toBe(true);
    await h.close();
  });

  it('passes the parse warning through when ids could not be mapped', async () => {
    // Dropping ONE registration input makes the positional map unsafe: the
    // parser refuses to guess, and the reason must reach the caller.
    const oneMissing = ORDER_HTML.replace(/<input[^>]*name="ticketId"[^>]*value="900012"[^>]*>/, '');
    const h = await harness({ fetch: fakeFetch({ [HOST]: { body: oneMissing } }) });
    const res = await h.callTool('accesso_get_wallet_passes', { url: TICKET_URL });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/11 ticketId input\(s\) for 12 ticket\(s\)/);
    await h.close();
  });

  it('explains when no ticket can produce a pass', async () => {
    // No ticketIds -> no wallet URLs; the warning explains why.
    const noIds = ORDER_HTML.replace(/<input[^>]*name="ticketId"[^>]*>/g, '');
    const h = await harness({ fetch: fakeFetch({ [HOST]: { body: noIds } }) });
    const res = await h.callTool('accesso_get_wallet_passes', { url: TICKET_URL });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/no wallet passes/i);
    await h.close();
  });
});

describe('accesso_resolve_link', () => {
  it('unwraps a tracking link', async () => {
    const h = await harness({
      fetch: fakeFetch({ 'https://track.example.com': { status: 302, headers: { location: TICKET_URL } } }),
    });
    const out = parseToolResult<{ url: string; hops: number }>(
      await h.callTool('accesso_resolve_link', { url: 'https://track.example.com/a' }),
    );
    expect(out.url).toBe(TICKET_URL);
    expect(out.hops).toBe(1);
    await h.close();
  });
});

describe('accesso_healthcheck', () => {
  it('reports missing configuration without failing', async () => {
    const h = await harness();
    const out = parseToolResult<{ ok: boolean; hint: string }>(await h.callTool('accesso_healthcheck', {}));
    expect(out.ok).toBe(false);
    expect(out.hint).toMatch(/ACCESSO_TICKET_URL/);
    await h.close();
  });

  it('confirms reachability and redacts the token it used', async () => {
    const h = await harness();
    const out = parseToolResult<{ ok: boolean; reachedUrl: string; ticketCount: number }>(
      await h.callTool('accesso_healthcheck', { url: TICKET_URL }),
    );
    expect(out.ok).toBe(true);
    expect(out.ticketCount).toBe(12);
    expect(out.reachedUrl).not.toContain('A1:TOK');
    await h.close();
  });

  it('uses the configured default link', async () => {
    vi.stubEnv('ACCESSO_TICKET_URL', TICKET_URL);
    const h = await harness();
    const out = parseToolResult<{ ok: boolean; defaultTicketUrl: boolean }>(
      await h.callTool('accesso_healthcheck', {}),
    );
    expect(out.defaultTicketUrl).toBe(true);
    expect(out.ok).toBe(true);
    await h.close();
  });
});
