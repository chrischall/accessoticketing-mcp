import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const fixtures = join(here, 'fixtures');

export const ORDER_HTML = readFileSync(join(fixtures, 'order.html'), 'utf8');
export const EXPIRED_HTML = readFileSync(join(fixtures, 'expired.html'), 'utf8');

export const HOST = 'https://media-engine.na3.accessoticketing.com';
export const TICKET_URL = `${HOST}/tickets/v1/accesso155?oToken=A1:TOK&cToken=A1:CTOK`;

/** A `fetch` stand-in that answers from a path→response map. */
export function fakeFetch(
  routes: Record<string, { status?: number; body?: string; json?: unknown; headers?: Record<string, string> }>,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Longest prefix wins, so a route for `/a/b` is not shadowed by one for `/a`.
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url === k || url.startsWith(k));
    if (key === undefined) throw new Error(`unrouted fetch: ${url}`);
    const route = routes[key]!;
    const status = route.status ?? 200;
    const body = route.json !== undefined ? JSON.stringify(route.json) : (route.body ?? '');
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      headers: new Headers(route.headers ?? {}),
      text: async () => body,
      json: async () => JSON.parse(body),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}
