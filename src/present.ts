import type { AccessoOrder, AccessoTicket } from './types.js';

/**
 * A ticket as it should appear in a tool result.
 *
 * `barcodePng` is dropped unconditionally: it is raw image bytes, and letting
 * it reach `textResult` would serialise a Buffer as a JSON object of hundreds
 * of numeric keys per ticket. The barcode is offered through
 * `accesso_save_barcodes` instead.
 */
export function presentTicket(ticket: AccessoTicket): Record<string, unknown> {
  const { barcodePng, ...rest } = ticket;
  return { ...rest, hasBarcode: barcodePng !== null };
}

/** The slim projection for browsing an order — identity, when, and who. */
export function compactTicket(ticket: AccessoTicket): Record<string, unknown> {
  return {
    index: ticket.index,
    packageName: ticket.packageName,
    participant: ticket.participant,
    date: ticket.date,
    time: ticket.time,
    ...(ticket.additionalGuests.length > 0 ? { additionalGuests: ticket.additionalGuests } : {}),
  };
}

export function presentOrder(order: AccessoOrder, compact: boolean): Record<string, unknown> {
  const { tickets, warnings, ...header } = order;
  return {
    ...header,
    tickets: tickets.map(compact ? compactTicket : presentTicket),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Select tickets by their `index`, preserving order-page order.
 *
 * Returns the unmatched selectors too — silently ignoring a bad index would let
 * "save ticket 99" report success having written nothing.
 */
export function selectTickets(
  tickets: AccessoTicket[],
  indexes?: number[],
): { selected: AccessoTicket[]; missing: number[] } {
  if (indexes === undefined || indexes.length === 0) return { selected: tickets, missing: [] };
  const wanted = new Set(indexes);
  const selected = tickets.filter((t) => wanted.has(t.index));
  const found = new Set(selected.map((t) => t.index));
  return { selected, missing: indexes.filter((i) => !found.has(i)) };
}
