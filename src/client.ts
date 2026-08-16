import { readEnvVar, McpToolError } from '@chrischall/mcp-utils';
import { parseTicketPage, isExpiredOrderPage } from './parse.js';
import type { AccessoOrder, ParseOptions } from './types.js';

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

export function isAccessoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return url.hostname === 'accessoticketing.com' || url.hostname.endsWith(ALLOWED_APEX);
  } catch {
    return false;
  }
}

function requireAccessoUrl(value: string): string {
  if (!isAccessoUrl(value)) {
    throw new McpToolError(`Refusing to fetch a non-accesso URL: ${redactUrl(value)}`, {
      hint:
        'This server only fetches https://*.accessoticketing.com. If you have an email ' +
        'tracking link, resolve it first with accesso_resolve_link.',
    });
  }
  return value;
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

export interface FetchDeps {
  fetch?: typeof globalThis.fetch;
}

export class AccessoClient {
  readonly #fetch: typeof globalThis.fetch;
  /**
   * Deferred config: a missing default URL is not an error at construction, so
   * the server still boots and answers the host's install-time tools/list probe.
   * It only bites when a tool is called with no `url` argument either.
   */
  readonly #defaultUrl: string | null;

  constructor(deps: FetchDeps = {}) {
    this.#fetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    this.#defaultUrl = readEnvVar('ACCESSO_TICKET_URL') ?? null;
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

  async #get(url: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.#fetch(url, { redirect: 'follow', headers: { accept } });
    } catch (cause) {
      throw new McpToolError(`Could not reach accesso: ${redactUrl(url)}`, {
        hint: 'Check network connectivity; accesso ticket pages need no login.',
        cause,
      });
    }
    if (!res.ok) {
      throw new McpToolError(`accesso returned HTTP ${res.status} for ${redactUrl(url)}`, {
        hint:
          res.status === 404
            ? 'The island/merchant path in the link looks wrong — re-copy it from the email.'
            : 'Retry; if it persists the ticket link may have been revoked.',
      });
    }
    return res;
  }

  /** Fetch and parse an order page. */
  async getOrder(url: string, opts: ParseOptions = {}): Promise<AccessoOrder> {
    const res = await this.#get(url, 'text/html');
    const html = await res.text();

    const order = parseTicketPage(html, { ...opts, sourceUrl: res.url || url });
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
   * Redirects are followed manually so the chain can be capped and the final
   * host checked; the body is never read.
   */
  async resolveLink(url: string): Promise<{ url: string; hops: number }> {
    let current = url;
    for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
      if (isAccessoUrl(current)) return { url: current, hops };

      let res: Response;
      try {
        res = await this.#fetch(current, { redirect: 'manual', headers: { accept: 'text/html' } });
      } catch (cause) {
        throw new McpToolError(`Could not follow the link: ${redactUrl(current)}`, {
          hint: 'Check network connectivity.',
          cause,
        });
      }
      const next = res.headers.get('location');
      if (!next) {
        throw new McpToolError(
          `Link did not lead to an accesso ticket page (stopped at HTTP ${res.status}).`,
          { hint: 'Check you copied the whole link from the email.' },
        );
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
    const res = await this.#get(walletUrl, 'application/json');
    const body = (await res.json()) as { jwt?: unknown };
    if (typeof body.jwt !== 'string' || body.jwt === '') {
      throw new McpToolError('accesso did not return a Google Wallet pass for that ticket.', {
        hint: 'Not every merchant enables Wallet passes.',
      });
    }
    return `https://pay.google.com/gp/v/save/${body.jwt}`;
  }
}

export const client = new AccessoClient();
