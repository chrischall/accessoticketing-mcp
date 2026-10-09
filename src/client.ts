import { readEnvVar, McpToolError, currentCallSignal } from '@chrischall/mcp-utils';
import { parseTicketPage, isExpiredOrderPage } from './parse.js';
import type { AccessoOrder, ParseOptions } from './types.js';
import { assertPublicHost, systemLookup, type Lookup } from './netguard.js';

/**
 * accesso serves ticket pages from regional media-engine hosts under this
 * apex. Every URL these tools fetch is checked against it.
 *
 * This is a security boundary, not tidiness: the tools take a URL chosen by the
 * model, so without an allowlist the server is an open redirector/SSRF proxy
 * that will fetch `http://169.254.169.254/` or an internal host on request.
 */
const ALLOWED_APEX = '.accessoticketing.com';

const MAX_REDIRECTS = 10;

/** Default bound on one fetch (every hop plus the body), in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

const TIMEOUT_HINT = 'The request did not finish in time (or the call was cancelled); retry.';

/** An http(s) URL on the accesso apex, parsed; null for anything else. */
function parseAccessoUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname !== 'accessoticketing.com' && !url.hostname.endsWith(ALLOWED_APEX)) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * The https form of an accesso URL, or null for anything off the accesso apex.
 *
 * A plain-http accesso link is upgraded rather than refused: links in older
 * emails can be http, and the token they carry must never travel in cleartext,
 * so the fetch (and every URL derived from the page's origin, such as the
 * Wallet endpoint) uses https.
 */
function toAccessoHttps(value: string): string | null {
  const url = parseAccessoUrl(value);
  if (url === null) return null;
  url.protocol = 'https:';
  return url.toString();
}

/** True for an https URL on the accesso apex — one these tools fetch as-is. */
export function isAccessoUrl(value: string): boolean {
  return parseAccessoUrl(value)?.protocol === 'https:';
}

/** The https URL to fetch for an accesso link; throws for anything else. */
function requireAccessoUrl(value: string): string {
  const https = toAccessoHttps(value);
  if (https === null) {
    throw new McpToolError(`Refusing to fetch a non-accesso URL: ${redactUrl(value)}`, {
      hint:
        'This server only fetches https://*.accessoticketing.com. If you have an email ' +
        'tracking link, resolve it first with accesso_resolve_link.',
    });
  }
  return https;
}

/**
 * Strip the order tokens out of a URL before it can reach a log, an error
 * message or a tool result. `oToken` alone grants the whole order.
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ['oToken', 'cToken', 'token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return value.replace(/A1:[A-Za-z0-9_-]+/g, 'A1:REDACTED');
  }
}

/**
 * The `jwt` from a Wallet endpoint's body, or null. accesso answers some error
 * states with an HTML page at HTTP 200, so the body is not trusted to be JSON,
 * or an object, at all.
 */
function readJwt(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { jwt } = body as { jwt?: unknown };
  return typeof jwt === 'string' && jwt !== '' ? jwt : null;
}

export interface FetchDeps {
  fetch?: typeof globalThis.fetch;
  /** DNS resolver for the click-tracker SSRF guard; defaults to the OS resolver. */
  lookup?: Lookup;
  /** Bound on one fetch, redirects and body included. Default 15s. */
  timeoutMs?: number;
}

export class AccessoClient {
  readonly #fetch: typeof globalThis.fetch;
  readonly #lookup: Lookup;
  readonly #timeoutMs: number;
  /**
   * Deferred config: a missing default URL is not an error at construction, so
   * the server still boots and answers the host's install-time tools/list probe.
   * It only bites when a tool is called with no `url` argument either.
   */
  readonly #defaultUrl: string | null;

  constructor(deps: FetchDeps = {}) {
    this.#fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.#lookup = deps.lookup ?? systemLookup;
    this.#timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#defaultUrl = readEnvVar('ACCESSO_TICKET_URL') ?? null;
  }

  /**
   * The signal for one fetch: a timeout, combined with the tool call's own
   * cancellation (set by the server runtime), so a stalled host or a caller
   * that has gone away stops the request instead of holding it for minutes.
   */
  #signal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const caller = currentCallSignal();
    return caller ? AbortSignal.any([timeout, caller]) : timeout;
  }

  get hasDefaultUrl(): boolean {
    return this.#defaultUrl !== null;
  }

  /** The URL a tool should use, given its optional `url` argument. */
  resolveTicketUrl(url?: string): string {
    const chosen = url ?? this.#defaultUrl;
    if (!chosen) {
      throw new McpToolError('No accesso ticket link available.', {
        hint:
          'Pass `url` (the link from your order-confirmation email), or set ACCESSO_TICKET_URL ' +
          'so these tools have a default order to read.',
      });
    }
    return requireAccessoUrl(chosen);
  }

  /**
   * GET an accesso URL, following redirects by hand so every hop is held to
   * the accesso allowlist (and upgraded to https) before it is requested. With
   * `redirect: 'follow'` only the first URL was checked, so a 3xx from any
   * accesso host could steer the server anywhere. Returns the final URL too,
   * since the page's links are resolved against it.
   */
  async #get(requested: string, accept: string): Promise<{ res: Response; url: string }> {
    let url = requireAccessoUrl(requested);
    const signal = this.#signal();
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      let res: Response;
      try {
        res = await this.#fetch(url, { redirect: 'manual', headers: { accept }, signal });
      } catch (cause) {
        throw new McpToolError(`Could not reach accesso: ${redactUrl(url)}`, {
          hint: signal.aborted
            ? TIMEOUT_HINT
            : 'Check network connectivity; accesso ticket pages need no login.',
          cause,
        });
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (location !== null) {
        await res.body?.cancel();
        url = requireAccessoUrl(new URL(location, url).toString());
        continue;
      }
      if (!res.ok) {
        throw new McpToolError(`accesso returned HTTP ${res.status} for ${redactUrl(url)}`, {
          hint:
            res.status === 404
              ? 'The island/merchant path in the link looks wrong — re-copy it from the email.'
              : 'Retry; if it persists the ticket link may have been revoked.',
        });
      }
      return { res, url };
    }
    throw new McpToolError(`accesso exceeded ${MAX_REDIRECTS} redirects for ${redactUrl(requested)}`, {
      hint: 'Retry; if it persists the ticket link may have been revoked.',
    });
  }

  /** Fetch and parse an order page. */
  async getOrder(url: string, opts: ParseOptions = {}): Promise<AccessoOrder> {
    const { res, url: finalUrl } = await this.#get(url, 'text/html');
    const html = await res.text();

    const order = parseTicketPage(html, { ...opts, sourceUrl: finalUrl });
    if (order.tickets.length === 0) {
      // Verified live: accesso answers a dead token with 200, not 4xx, so the
      // status code above cannot catch this.
      if (isExpiredOrderPage(html)) {
        throw new McpToolError('This accesso ticket link is expired or invalid.', {
          hint:
            'accesso replied "no tickets available to print on this order" (HTTP 200). ' +
            'Open the most recent order-confirmation email and use its link.',
        });
      }
      throw new McpToolError('No tickets found on a page accesso did not report as invalid.', {
        hint: 'The ticket page layout may have changed; the parser needs re-checking.',
      });
    }
    return order;
  }

  /**
   * Follow an email click-tracker to the accesso link it wraps.
   *
   * Redirects are followed manually so the chain can be capped and every hop
   * checked. This is the one place the server fetches a non-accesso URL, so
   * each hop must pass the SSRF guard (public name, public addresses) before it
   * is requested; the body is never read, and is cancelled so the connection
   * is released.
   */
  async resolveLink(url: string): Promise<{ url: string; hops: number }> {
    let current = url;
    const signal = this.#signal();
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      const accesso = toAccessoHttps(current);
      if (accesso !== null) return { url: accesso, hops };
      await assertPublicHost(new URL(current), this.#lookup);

      let res: Response;
      try {
        res = await this.#fetch(current, { redirect: 'manual', headers: { accept: 'text/html' }, signal });
      } catch (cause) {
        throw new McpToolError(`Could not follow the link: ${redactUrl(current)}`, {
          hint: signal.aborted ? TIMEOUT_HINT : 'Check network connectivity.',
          cause,
        });
      }
      await res.body?.cancel();
      const next = res.headers.get('location');
      if (!next) {
        // The upstream status is deliberately not echoed: it would let the
        // tool be used to probe which hosts and ports answer.
        throw new McpToolError('Link did not lead to an accesso ticket page.', {
          hint: 'Check you copied the whole link from the email.',
        });
      }
      const resolved = new URL(next, current).toString();
      if (!/^https?:/.test(resolved)) {
        throw new McpToolError('Link redirected to a non-HTTP scheme; refusing to follow.');
      }
      current = resolved;
    }
    throw new McpToolError(`Link exceeded ${MAX_REDIRECTS} redirects without reaching accesso.`);
  }

  /** Exchange a Google Wallet pass endpoint for its save URL. */
  async getWalletSaveUrl(walletUrl: string): Promise<string> {
    requireAccessoUrl(walletUrl);
    const { res } = await this.#get(walletUrl, 'application/json');
    const jwt = readJwt(await res.text());
    if (jwt === null) {
      throw new McpToolError('accesso did not return a Google Wallet pass for that ticket.', {
        hint: 'Not every merchant enables Wallet passes.',
      });
    }
    return `https://pay.google.com/gp/v/save/${jwt}`;
  }
}

export const client = new AccessoClient();
