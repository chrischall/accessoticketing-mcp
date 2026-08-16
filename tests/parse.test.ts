import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTicketPage, isExpiredOrderPage } from '../src/parse.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const order = readFileSync(join(fixtures, 'order.html'), 'utf8');
const expired = readFileSync(join(fixtures, 'expired.html'), 'utf8');

const SOURCE = 'https://media-engine.na3.accessoticketing.com/tickets/v1/accesso155?oToken=A1:TOK&cToken=A1:C';

describe('parseTicketPage', () => {
  it('reads the order header', () => {
    const o = parseTicketPage(order);
    // The order number lives on a <span>, not a <div> — a div-only selector
    // silently yields null, which is how it was first written.
    expect(o.orderNumber).toBe('90000001');
    expect(o.island).toBe('accesso155');
    expect(o.merchantId).toBe('100');
    expect(o.merchantLogo).toContain('accesso155');
  });

  it('returns one ticket per order line, not one per rendering', () => {
    // The page renders every ticket TWICE (a mobile `ticket-item-container<N>`
    // grouping and a `desktopTicketGrouping` one) sharing barcode element ids.
    const o = parseTicketPage(order);
    expect(o.tickets).toHaveLength(12);
    expect(o.declaredTicketCount).toBe(12);
    expect(o.ticketCount).toBe(o.declaredTicketCount);
  });

  it('maps every field of a timed ticket', () => {
    const t = parseTicketPage(order).tickets[0]!;
    expect(t).toMatchObject({
      index: 0,
      ticketId: '900001',
      packageName: 'Tiny Trekkers Full-Day (Ages 4-7)',
      participant: 'ALEX RIVERA',
      date: '08/17/2026',
      time: '9:00 AM',
      barcodeText: 'ID %RC90000001',
    });
    expect(t.additionalGuests).toEqual([]);
    expect(t.details).toMatchObject({
      'Guest Number': '400000000001',
      'Web Sales ID': '290000000001',
    });
    expect(t.instructions).toContain('Parent Information Packet');
  });

  it('leaves time null on an all-day ticket rather than inventing one', () => {
    const t = parseTicketPage(order).tickets[7]!;
    expect(t.time).toBeNull();
    expect(t.date).toBe('08/17/2026');
    expect(t.packageName).toBe('Early Drop-Off Week 12');
  });

  it('assigns ticketIds from the trailing registration section in order', () => {
    // ticketId appears in NEITHER rendering — only in the per-ticket
    // "Register this ticket" modal forms after the desktop grouping.
    const ids = parseTicketPage(order).tickets.map((t) => t.ticketId);
    expect(ids).toEqual([
      '900001', '900002', '900003', '900004', '900005', '900006',
      '900007', '900008', '900009', '900010', '900011', '900012',
    ]);
  });

  it('omits ticketIds rather than guessing when the counts disagree', () => {
    // Drop one registration form: a positional map would silently shift every
    // id by one and hand back wallet links for the wrong tickets.
    const truncated = order.replace(/<input[^>]*name="ticketId"[^>]*value="900012"[^>]*>/, '');
    const o = parseTicketPage(truncated);
    expect(o.tickets).toHaveLength(12);
    expect(o.tickets.every((t) => t.ticketId === null)).toBe(true);
    expect(o.warnings.join(' ')).toMatch(/ticketId/i);
  });

  it('harvests merchant-specific detail rows generically', () => {
    // A different venue renders different label/value rows; they must survive.
    const custom = order.replace(
      '<div class="gap-font--overline uppercase">Guest Number:</div>',
      '<div class="gap-font--overline uppercase">Locker Number:</div>',
    );
    expect(parseTicketPage(custom).tickets[0]!.details['Locker Number']).toBe('400000000001');
  });

  it('omits terms by default and includes them on request', () => {
    expect(parseTicketPage(order).tickets[0]!.termsAndConditions).toBeUndefined();
    const withTerms = parseTicketPage(order, { includeTerms: true });
    expect(withTerms.tickets[0]!.termsAndConditions).toContain('Assumption of Risk');
  });

  it('builds a Google Wallet URL only with a source URL and a ticketId', () => {
    expect(parseTicketPage(order).tickets[0]!.googleWalletUrl).toBeNull();
    const o = parseTicketPage(order, { sourceUrl: SOURCE });
    expect(o.tickets[0]!.googleWalletUrl).toBe(
      'https://media-engine.na3.accessoticketing.com/google-wallet/v1/accesso155/A1:TOK/900001',
    );
  });

  it('exposes barcodes as decodable bytes', () => {
    const t = parseTicketPage(order).tickets[0]!;
    expect(t.barcodePng).toBeInstanceOf(Buffer);
    expect(t.barcodePng!.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('parses an order page with no tickets to an empty list', () => {
    const o = parseTicketPage(expired);
    expect(o.tickets).toEqual([]);
    expect(o.ticketCount).toBe(0);
  });
});

describe('isExpiredOrderPage', () => {
  it('recognises the 200-with-no-tickets body accesso serves for a dead link', () => {
    // Verified live: a bogus oToken returns HTTP 200, so status is no signal.
    expect(isExpiredOrderPage(expired)).toBe(true);
  });

  it('does not fire on a good order page', () => {
    expect(isExpiredOrderPage(order)).toBe(false);
  });
});

describe('parseTicketPage edge cases', () => {
  it('warns instead of throwing when the source URL is unusable', () => {
    const o = parseTicketPage(order, { sourceUrl: '/tickets/v1/accesso155' });
    expect(o.warnings.join(' ')).toMatch(/not a valid URL/);
    expect(o.tickets[0]!.googleWalletUrl).toBeNull();
  });

  it('flags a page whose declared count disagrees with what was parsed', () => {
    const lying = order.replace(/data-totaltickets="12"/g, 'data-totaltickets="13"');
    const o = parseTicketPage(lying);
    expect(o.declaredTicketCount).toBe(13);
    expect(o.ticketCount).toBe(12);
    expect(o.warnings.join(' ')).toMatch(/declared 13/);
  });

  it('keeps an unrecognised long-form panel as a detail rather than dropping it', () => {
    const extra = order.replace(
      '<div class="flipTicket__content-heading gap-font--overline">Instructions:</div>',
      '<div class="flipTicket__content-heading gap-font--overline">Parking:</div>',
    );
    expect(parseTicketPage(extra).tickets[0]!.details['Parking']).toMatch(/Parent Information Packet/);
  });

  it('warns when a ticket has no detail panel to pair with', () => {
    const orphaned = order.replace(/id="flip-ticket-info-container0"/, 'id="flip-ticket-info-containerX"');
    const o = parseTicketPage(orphaned);
    expect(o.warnings.join(' ')).toMatch(/detail panel not found/);
    expect(o.tickets[0]!.details).toEqual({});
  });

  it('treats an empty barcode source as no barcode', () => {
    const stripped = order.replace(/src="data:image\/png;base64,[^"]*"/g, 'src="data:image/png;base64,"');
    expect(parseTicketPage(stripped).tickets[0]!.barcodePng).toBeNull();
  });

  it('ignores a barcode that is not a data URL', () => {
    const remote = order.replace(/src="data:image\/png;base64,[^"]*"/g, 'src="https://cdn.example/x.png"');
    expect(parseTicketPage(remote).tickets[0]!.barcodePng).toBeNull();
  });
});

describe('parseTicketPage degrades on missing markup', () => {
  it('falls back to document order when a ticket has no data-ticketidx', () => {
    const o = parseTicketPage(order.replace(/ data-ticketidx="\d+"/g, ''));
    expect(o.tickets.map((t) => t.index)).toEqual([...Array(12).keys()]);
  });

  it('reports no participant rather than inventing one', () => {
    const o = parseTicketPage(order.replace(/ticket__customerName/g, 'ticket__customerNameX'));
    expect(o.tickets[0]!.participant).toBeNull();
    expect(o.tickets[0]!.additionalGuests).toEqual([]);
  });

  it('reports no date when the row is absent', () => {
    const o = parseTicketPage(order.replace(/>Date</g, '>Datum<'));
    expect(o.tickets[0]!.date).toBeNull();
    expect(o.tickets[0]!.details['Datum']).toBe('08/17/2026');
  });

  it('reports no order number rather than guessing', () => {
    expect(parseTicketPage(order.replace(/ticketHeader__orderNumber/g, 'x')).orderNumber).toBeNull();
  });

  it('keeps additional guest names', () => {
    const two = order.replace(
      '<div>ALEX RIVERA</div>',
      '<div>ALEX RIVERA</div><div>ROBIN RIVERA</div>',
    );
    expect(parseTicketPage(two).tickets[0]!.additionalGuests).toEqual(['ROBIN RIVERA']);
  });
});

describe('parseTicketPage rejects malformed inputs safely', () => {
  it.each([
    ['a data URL with no payload separator', 'src="data:image/png;base64"'],
    ['a data URL that is not base64', 'src="data:image/png,rawbytes"'],
  ])('ignores %s', (_label, replacement) => {
    const o = parseTicketPage(order.replace(/src="data:image\/png;base64,[^"]*"/g, replacement));
    expect(o.tickets[0]!.barcodePng).toBeNull();
  });

  it('derives the island from the logo when the URL does not carry one', () => {
    const o = parseTicketPage(order, { sourceUrl: 'https://media-engine.na3.accessoticketing.com/other' });
    expect(o.island).toBe('accesso155');
  });

  it('leaves the island null when neither URL nor logo supplies one', () => {
    const o = parseTicketPage(order.replace(/ticketHeader__merchantLogo/g, 'x'));
    expect(o.merchantLogo).toBeNull();
    expect(o.island).toBeNull();
  });

  it('ignores a registration input carrying no value', () => {
    const blanked = order.replace('value="900001"', '');
    const o = parseTicketPage(blanked);
    // 11 usable ids for 12 tickets -> refuse to map rather than shift them all.
    expect(o.tickets.every((t) => t.ticketId === null)).toBe(true);
    expect(o.warnings.join(' ')).toMatch(/11 ticketId input/);
  });
});
