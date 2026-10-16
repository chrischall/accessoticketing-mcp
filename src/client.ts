import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readEnvVar,
  McpToolError,
  currentCallSignal,
  loadDotenvSafely,
  UrlNotAllowedError,
  RedirectRefusedError,
} from '@chrischall/mcp-utils';
import { parseTicketPage, isExpiredOrderPage } from './parse.js';
import type { AccessoOrder, ParseOptions } from './types.js';
import { fetchPublic } from '@chrischall/mcp-utils/netguard';
import type { Dispatcher } from 'undici';
import { isIP } from 'node:net';

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
 *
 * Library callers that need to accept http accesso links (which
 * {@link isAccessoUrl} rejects) should use this instead: it is the
 * http-tolerant check, and it never hands back a cleartext URL.
 */
export function toAccessoHttps(value: string): string | null {
  const url = parseAccessoUrl(value);
  if (url === null) return null;
  url.protocol = 'https:';
  return url.toString();
}

/**
 * True for an https URL on the accesso apex — one these tools fetch as-is.
 *
 * Behaviour change after 1.0.6 (#80): this now returns false for plain-http
 * accesso URLs (it used to return true), because those carry the order token
 * in cleartext. To accept an http link, upgrade it with
 * {@link toAccessoHttps} (null = not accesso).
 */
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

/** An accesso order token, raw or with its colon percent-encoded. */
const TOKEN_TEXT = /A1(?::|%3A)[A-Za-z0-9_-]+/gi;

/**
 * Strip the order tokens out of a URL before it can reach a log, an error
 * message or a tool result. `oToken` alone grants the whole order.
 *
 * Tokens ride in the query (`oToken`/`cToken`/`token`) on ticket pages and in
 * the PATH on Google Wallet endpoints
 * (`/google-wallet/v1/<island>/<oToken>/<ticketId>`), so both are scrubbed;
 * a final token-shaped sweep catches any other position.
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ['oToken', 'cToken', 'token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, 'REDACTED');
    }
    const segments = url.pathname.split('/');
    if (segments[1] === 'google-wallet' && segments.length > 4) segments[4] = 'REDACTED';
    url.pathname = segments.map((seg) => (/^A1(?::|%3A)/i.test(seg) ? 'REDACTED' : seg)).join('/');
    return url.toString().replace(TOKEN_TEXT, 'A1:REDACTED');
  } catch {
    return value.replace(TOKEN_TEXT, 'A1:REDACTED');
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

/** Resolves a hostname to its addresses. Injectable so tests never touch DNS. */
export type Lookup = (hostname: string) => Promise<string[]>;

export interface FetchDeps {
  /** Replaces every accesso request (tests). Tracker hops never use it. */
  fetch?: typeof globalThis.fetch;
  /**
   * DNS resolver for click-tracker connections; defaults to the OS resolver.
   * The public-only dispatcher resolves each host once and connects to
   * exactly the addresses it checked.
   */
  lookup?: Lookup;
  /**
   * Test seam: the dispatcher tracker hops are sent through (e.g. an undici
   * MockAgent). Production omits it, and every resolveLink call gets a fresh
   * mcp-utils public-only dispatcher.
   */
  trackerDispatcher?: Dispatcher;
  /** Bound on one fetch, redirects and body included. Default 15s. */
  timeoutMs?: number;
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.arpa'];

function refusePrivateHost(): never {
  throw new McpToolError('Refusing to follow a link to a private, local or IP-address host.', {
    hint: 'accesso_resolve_link only follows public email click-tracking links.',
  });
}

/**
 * Early, lookup-free refusal for a tracker hop: IP literals (a real tracker
 * uses a name) and local/single-label names (resolved via local search
 * domains, never public DNS). Names that RESOLVE inward are refused at
 * connect by the public-only dispatcher.
 */
function assertTrackerHostShape(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (isIP(host) !== 0) refusePrivateHost();
  if (!host.includes('.') || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) refusePrivateHost();
}

/** The URL refusal anywhere in an error's cause chain, if any. */
function urlRefusal(err: unknown): UrlNotAllowedError | undefined {
  let e: unknown = err;
  for (let i = 0; i < 8 && e; i += 1) {
    if (e instanceof UrlNotAllowedError) return e;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

export class AccessoClient {
  readonly #fetch: typeof globalThis.fetch;
  readonly #lookup: Lookup | undefined;
  readonly #trackerDispatcher: Dispatcher | undefined;
  readonly #timeoutMs: number;
  /**
   * Deferred config: a missing default URL is not an error at construction, so
   * the server still boots and answers the host's install-time tools/list probe.
   * It only bites when a tool is called with no `url` argument either.
   */
  readonly #defaultUrl: string | null;

  constructor(deps: FetchDeps = {}) {
    this.#fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.#lookup = deps.lookup;
    this.#trackerDispatcher = deps.trackerDispatcher;
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
    for (let hops = 0; hops < MAX_REDIRECTS; hops++) {
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
   * This is the one place the server fetches a non-accesso URL, so it goes
   * through mcp-utils netguard `fetchPublic`: every connection is pinned to
   * public addresses (a name that resolves or rebinds inward is refused at
   * connect), redirects are followed by hand with each target checked before
   * it is requested, credentials are dropped across origins, and one deadline
   * covers the chain. `stopBefore` ends the walk at the first accesso link
   * without requesting it, and refuses IP-literal/local hops up front.
   */
  async resolveLink(url: string): Promise<{ url: string; hops: number }> {
    const signal = this.#signal();
    let result: { stopped: boolean; url: string; hops: number };
    try {
      result = await fetchPublic(url, {
        stopBefore: (u) => {
          if (toAccessoHttps(u.href) !== null) return true;
          assertTrackerHostShape(u);
          return false;
        },
        requireHttps: false,
        // MAX_REDIRECTS requests in all: the first plus MAX_REDIRECTS - 1 hops.
        maxRedirects: MAX_REDIRECTS - 1,
        // Only a non-redirect final answer has a body, and it is an error
        // either way; read none of it.
        maxBytes: 0,
        signal,
        headers: { accept: 'text/html' },
        ...(this.#lookup ? { resolve: this.#lookup } : {}),
        ...(this.#trackerDispatcher ? { dispatcher: this.#trackerDispatcher } : {}),
      });
    } catch (cause) {
      if (cause instanceof McpToolError && /private, local or IP-address/.test(cause.message)) throw cause;
      const refused = urlRefusal(cause);
      if (refused?.reason === 'scheme' || refused?.reason === 'invalid') {
        throw new McpToolError('Link redirected to a non-HTTP scheme; refusing to follow.');
      }
      if (refused) refusePrivateHost();
      if (cause instanceof RedirectRefusedError) {
        throw new McpToolError(`Link exceeded ${MAX_REDIRECTS} redirects without reaching accesso.`);
      }
      if ((cause as { kind?: unknown } | null)?.kind === 'too_large') {
        throw new McpToolError('Link did not lead to an accesso ticket page.', {
          hint: 'Check you copied the whole link from the email.',
        });
      }
      throw new McpToolError(`Could not follow the link: ${redactUrl(url)}`, {
        hint: signal.aborted ? TIMEOUT_HINT : 'Check network connectivity.',
        cause,
      });
    }
    if (result.stopped) {
      return { url: toAccessoHttps(result.url) as string, hops: result.hops };
    }
    // The upstream status is deliberately not echoed: it would let the
    // tool be used to probe which hosts and ports answer.
    throw new McpToolError('Link did not lead to an accesso ticket page.', {
      hint: 'Check you copied the whole link from the email.',
    });
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

// Load .env for local dev before the singleton reads its config; a silent
// no-op where dotenv is absent (the .mcpb bundle), and never overrides a
// host-provided value.
await loadDotenvSafely({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  override: false,
});

export const client = new AccessoClient();
