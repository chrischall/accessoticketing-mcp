import { describe, expect, it } from 'vitest';
import { parseTicketPage } from '../src/parse.js';
import { presentOrder, presentTicket, compactTicket, selectTickets } from '../src/present.js';
import { ORDER_HTML } from './helpers.js';

const order = parseTicketPage(ORDER_HTML);

describe('presentTicket', () => {
  it('never serialises barcode bytes into a text result', () => {
    // A Buffer through JSON becomes hundreds of numeric keys per ticket.
    const shown = presentTicket(order.tickets[0]!);
    expect(shown['barcodePng']).toBeUndefined();
    expect(shown['hasBarcode']).toBe(true);
    expect(JSON.stringify(shown)).not.toMatch(/"0":/);
  });

  it('reports a ticket with no barcode honestly', () => {
    expect(presentTicket({ ...order.tickets[0]!, barcodePng: null })['hasBarcode']).toBe(false);
  });
});

describe('compactTicket', () => {
  it('keeps only what browsing needs', () => {
    expect(compactTicket(order.tickets[0]!)).toEqual({
      index: 0,
      packageName: 'Tiny Trekkers Full-Day (Ages 4-7)',
      participant: 'ALEX RIVERA',
      date: '08/17/2026',
      time: '9:00 AM',
    });
  });

  it('includes additional guests only when there are some', () => {
    const withGuests = { ...order.tickets[0]!, additionalGuests: ['SAM RIVERA'] };
    expect(compactTicket(withGuests)['additionalGuests']).toEqual(['SAM RIVERA']);
  });
});

describe('presentOrder', () => {
  it('omits the warnings key when there is nothing wrong', () => {
    expect(presentOrder(order, false)['warnings']).toBeUndefined();
  });

  it('surfaces warnings when there are some', () => {
    const shown = presentOrder({ ...order, warnings: ['careful'] }, true);
    expect(shown['warnings']).toEqual(['careful']);
  });

  it('switches projection on the compact flag', () => {
    const full = presentOrder(order, false)['tickets'] as Record<string, unknown>[];
    const slim = presentOrder(order, true)['tickets'] as Record<string, unknown>[];
    expect(full[0]!['instructions']).toBeDefined();
    expect(slim[0]!['instructions']).toBeUndefined();
  });
});

describe('selectTickets', () => {
  it('returns everything when nothing is specified', () => {
    expect(selectTickets(order.tickets).selected).toHaveLength(12);
    expect(selectTickets(order.tickets, []).selected).toHaveLength(12);
  });

  it('selects by index in page order', () => {
    const { selected, missing } = selectTickets(order.tickets, [3, 1]);
    expect(selected.map((t) => t.index)).toEqual([1, 3]);
    expect(missing).toEqual([]);
  });

  it('reports unmatched indexes instead of silently dropping them', () => {
    // "save ticket 99" must not report success having written nothing.
    expect(selectTickets(order.tickets, [0, 99]).missing).toEqual([99]);
  });
});
