import { parse, type HTMLElement } from 'node-html-parser';
import { decodeHtmlEntities } from '@chrischall/mcp-utils/scrape';
import type { AccessoOrder, AccessoTicket, ParseOptions } from './types.js';

/**
 * accesso answers an expired or invalid order token with **HTTP 200** and this
 * copy — verified live against a deliberately bogus `oToken`. The status line
 * is therefore no signal at all, and the body is the only way to tell a dead
 * link from a parser that has drifted.
 */
const EXPIRED_MARKER = /no tickets available to print/i;

export function isExpiredOrderPage(html: string): boolean {
  return EXPIRED_MARKER.test(html);
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/**
 * Harvest `<label><value>` sibling pairs by class.
 *
 * accesso renders Date, Time, Guest Number, Web Sales ID and every venue-specific
 * row with the same two-div shape, so reading them generically means a merchant
 * we have never seen still comes through instead of being silently dropped.
 */
function pairs(root: HTMLElement, labelClass: string, valueClass: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const label of root.querySelectorAll(`.${labelClass}`)) {
    const value = label.nextElementSibling;
    if (!value?.classList.contains(valueClass)) continue;
    const key = clean(label.text)?.replace(/:+$/, '');
    const text = clean(value.text);
    if (key && text && !(key in out)) out[key] = text;
  }
  return out;
}

function decodeDataUrl(src: string | undefined): Buffer | null {
  if (!src?.startsWith('data:')) return null;
  const comma = src.indexOf(',');
  if (comma === -1) return null;
  if (!/;base64$/i.test(src.slice(5, comma))) return null;
  const buf = Buffer.from(src.slice(comma + 1), 'base64');
  return buf.length > 0 ? buf : null;
}

export function parseTicketPage(html: string, opts: ParseOptions = {}): AccessoOrder {
  const { includeTerms = false, sourceUrl = null } = opts;
  const root = parse(html);
  const warnings: string[] = [];

  const orderLabel = clean(root.querySelector('.ticketHeader__orderNumber')?.text);
  const orderNumber = orderLabel ? (/([0-9]{4,})/.exec(orderLabel)?.[1] ?? orderLabel) : null;

  const merchantLogo = root.querySelector('img.ticketHeader__merchantLogo')?.getAttribute('src') ?? null;

  let origin: string | null = null;
  let oToken: string | null = null;
  let island: string | null = null;
  if (sourceUrl) {
    island = /\/tickets\/v1\/([^/?#]+)/.exec(sourceUrl)?.[1] ?? null;
    try {
      const url = new URL(sourceUrl);
      origin = url.origin;
      oToken = url.searchParams.get('oToken');
    } catch {
      warnings.push(`sourceUrl is not a valid URL: wallet links unavailable`);
    }
  }
  island ??= merchantLogo ? (/\/assets\/([^/]+)\//.exec(merchantLogo)?.[1] ?? null) : null;

  const hidden = (name: string): string | null =>
    root.querySelector(`input[name="${name}"]`)?.getAttribute('value') ?? null;
  const merchantId = hidden('merchantId');

  // Only the mobile grouping carries `id="ticket-item-container<N>"`; the
  // duplicate `desktopTicketGrouping` rendering does not, so this selector is
  // already one-per-ticket rather than one-per-rendering.
  const blocks = root.querySelectorAll('[id^="ticket-item-container"]');

  // ticketId appears in neither rendering — only in the trailing per-ticket
  // "Register this ticket" modal forms, in ticket order.
  const registrationIds = root
    .querySelectorAll('input[name="ticketId"]')
    .map((el) => el.getAttribute('value') ?? '')
    .filter((v) => v !== '');
  const idsUsable = registrationIds.length === blocks.length;
  if (registrationIds.length > 0 && !idsUsable) {
    warnings.push(
      `found ${registrationIds.length} ticketId input(s) for ${blocks.length} ticket(s); ` +
        'ticketId and googleWalletUrl omitted rather than mapped to the wrong tickets',
    );
  }

  const tickets: AccessoTicket[] = blocks.map((block, i) => {
    const idx = Number(block.getAttribute('data-ticketidx') ?? i);

    // The expandable detail panel is a SIBLING of the ticket block, not a child
    // — both hang off `#ticket-grouping-container` — so Guest Number, Web Sales
    // ID, Instructions and Terms have to be paired back by index rather than
    // read from inside the block.
    const flip = root.querySelector(`#flip-ticket-info-container${idx}`);
    const details = {
      ...pairs(block, 'gap-font--overline', 'gap-font--body-2'),
      ...(flip ? pairs(flip, 'gap-font--overline', 'gap-font--body-2') : {}),
    };
    const notes = flip ? pairs(flip, 'flipTicket__content-heading', 'flipTicket__content') : {};
    if (!flip) warnings.push(`ticket ${idx}: detail panel not found; extra fields omitted`);

    const names = (block.querySelector('.ticket__customerName')?.querySelectorAll('div') ?? [])
      .map((d) => clean(d.text))
      .filter((n): n is string => n !== null);

    // `idsUsable` already proved the arrays are the same length.
    const ticketId = idsUsable ? registrationIds[i]! : null;
    const walletToken = oToken ?? hidden('oToken');

    const { Date: date, Time: time, ...rest } = details;
    const { Instructions: instructions, ...otherNotes } = notes;

    const ticket: AccessoTicket = {
      index: idx,
      ticketId,
      packageName: clean(block.querySelector('.ticket__packageName')?.text),
      participant: names[0] ?? null,
      additionalGuests: names.slice(1),
      date: date ?? null,
      time: time ?? null,
      barcodeText: clean(block.querySelector('.ticket__barcodeText')?.text),
      barcodePng: decodeDataUrl(block.querySelector('img[id^="barcode"]')?.getAttribute('src')),
      details: rest,
      instructions: instructions ?? null,
      googleWalletUrl:
        origin && island && walletToken && ticketId
          ? `${origin}/google-wallet/v1/${island}/${walletToken}/${ticketId}`
          : null,
    };

    for (const [label, value] of Object.entries(otherNotes)) {
      if (/terms/i.test(label)) {
        if (includeTerms) ticket.termsAndConditions = value;
        continue;
      }
      ticket.details[label] ??= value;
    }

    return ticket;
  });

  const declaredRaw = root.querySelector('[data-totaltickets]')?.getAttribute('data-totaltickets');
  const declaredTicketCount = declaredRaw != null ? Number(declaredRaw) : null;
  if (declaredTicketCount !== null && declaredTicketCount !== tickets.length) {
    warnings.push(
      `page declared ${declaredTicketCount} ticket(s) but ${tickets.length} were parsed`,
    );
  }

  return {
    orderNumber,
    island,
    merchantId,
    merchantLogo,
    ticketCount: tickets.length,
    declaredTicketCount,
    tickets,
    warnings,
  };
}
