import { describe, expect, it, vi } from 'vitest';
import { parseTicketPage } from '../src/parse.js';
import type { AccessoOrder } from '../src/types.js';
import { ORDER_HTML, TICKET_URL } from './helpers.js';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain JS, shipped in the skill; no type declarations.
import { parseTickets, saveBarcodes } from '../skills/accesso-tickets/references/parse-tickets.mjs';

/**
 * The skill ships its own dependency-free copy of the parser
 * (skills/accesso-tickets/references/parse-tickets.mjs). Every input here goes
 * through both, so a page-layout fix applied to one and not the other fails CI
 * instead of silently drifting. The two output shapes differ by design (the
 * skill camelCases detail rows to top-level keys; the server keeps a `details`
 * map), so both are projected onto one comparable shape first.
 */

const CORE = new Set([
  'index', 'ticketId', 'packageName', 'participant', 'additionalGuests', 'date', 'time',
  'barcodeText', 'barcodeIsDataUrl', 'instructions', 'termsAndConditions', 'googleWalletUrl', 'barcodeFile',
]);

function camel(label: string): string {
  return label
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((p, i) => (i === 0 ? p.toLowerCase() : p[0]!.toUpperCase() + p.slice(1).toLowerCase()))
    .join('');
}

function fromServer(o: AccessoOrder) {
  return {
    orderNumber: o.orderNumber,
    island: o.island,
    merchantId: o.merchantId,
    merchantLogo: o.merchantLogo,
    ticketCount: o.ticketCount,
    declaredTicketCount: o.declaredTicketCount,
    tickets: o.tickets.map((t) => ({
      index: t.index,
      ticketId: t.ticketId,
      packageName: t.packageName,
      participant: t.participant,
      additionalGuests: t.additionalGuests,
      date: t.date,
      time: t.time,
      barcodeText: t.barcodeText,
      barcode: t.barcodePng ? t.barcodePng.toString('base64') : null,
      instructions: t.instructions,
      termsAndConditions: t.termsAndConditions ?? null,
      googleWalletUrl: t.googleWalletUrl,
      details: Object.fromEntries(Object.entries(t.details).map(([k, v]) => [camel(k), v])),
    })),
  };
}

function fromSkill(o: any) {
  return {
    orderNumber: o.orderNumber,
    island: o.island,
    merchantId: o.merchantId,
    merchantLogo: o.merchantLogo,
    ticketCount: o.ticketCount,
    declaredTicketCount: o.declaredTicketCount,
    tickets: o.tickets.map((t: any) => {
      const src: string | null = t._barcodeSrc;
      const b64 = src?.startsWith('data:') ? src.slice(src.indexOf(',') + 1) : '';
      return {
        index: t.index,
        ticketId: t.ticketId,
        packageName: t.packageName,
        participant: t.participant,
        additionalGuests: t.additionalGuests,
        date: t.date,
        time: t.time,
        barcodeText: t.barcodeText,
        barcode: b64 === '' ? null : b64,
        instructions: t.instructions ?? null,
        termsAndConditions: t.termsAndConditions ?? null,
        googleWalletUrl: t.googleWalletUrl ?? null,
        details: Object.fromEntries(Object.entries(t).filter(([k]) => !CORE.has(k))),
      };
    }),
  };
}

const variants: [string, string][] = [
  ['the captured order', ORDER_HTML],
  [
    'a merchant-specific detail row',
    ORDER_HTML.replace(
      '<div class="gap-font--overline uppercase">Guest Number:</div>',
      '<div class="gap-font--overline uppercase">Locker Number:</div>',
    ),
  ],
  [
    'an unrecognised long-form panel',
    ORDER_HTML.replace(
      '<div class="flipTicket__content-heading gap-font--overline">Instructions:</div>',
      '<div class="flipTicket__content-heading gap-font--overline">Parking:</div>',
    ),
  ],
  ['an additional guest', ORDER_HTML.replace('<div>ALEX RIVERA</div>', '<div>ALEX RIVERA</div><div>ROBIN RIVERA</div>')],
  ['a ticketId count mismatch', ORDER_HTML.replace(/<input[^>]*name="ticketId"[^>]*value="900012"[^>]*>/, '')],
  ['a lying declared count', ORDER_HTML.replace(/data-totaltickets="12"/g, 'data-totaltickets="13"')],
  ['an all-day ticket', ORDER_HTML.replace(/>Time</, '>Tijd<')],
];

describe('skill parser parity with src/parse.ts', () => {
  it.each(variants)('agrees on %s', (_label, html) => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      for (const includeTerms of [false, true]) {
        for (const sourceUrl of [TICKET_URL, null]) {
          const server = fromServer(parseTicketPage(html, { includeTerms, sourceUrl }));
          const skill = fromSkill(parseTickets(html, { includeTerms, sourceUrl }));
          expect(skill).toEqual(server);
        }
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('skill saveBarcodes', () => {
  it('never clobbers an existing file, like the server', () => {
    const dir = mkdtempSync(join(tmpdir(), 'accesso-skill-'));
    const order = parseTickets(ORDER_HTML, { sourceUrl: TICKET_URL });
    const first: string[] = saveBarcodes(order, dir);
    const taken = first[0]!;
    writeFileSync(taken, 'sentinel');
    const second: string[] = saveBarcodes(parseTickets(ORDER_HTML, { sourceUrl: TICKET_URL }), dir);
    expect(readFileSync(taken, 'utf8')).toBe('sentinel');
    expect(second).not.toContain(taken);
    expect(new Set([...first, ...second]).size).toBe(first.length * 2);
    expect(readdirSync(dir)).toHaveLength(first.length * 2);
  });
});
