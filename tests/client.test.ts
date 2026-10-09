import { describe, expect, it, vi } from 'vitest';
import { McpToolError, withCallSignal } from '@chrischall/mcp-utils';
import { AccessoClient, isAccessoUrl, redactUrl } from '../src/client.js';
import * as lib from '../src/lib.js';
import { ORDER_HTML, EXPIRED_HTML, HOST, TICKET_URL, fakeFetch } from './helpers.js';

const orderRoutes = { [HOST]: { body: ORDER_HTML } };
const publicLookup = async () => ['93.184.215.14'];

describe('isAccessoUrl', () => {
  it.each([
    [`${HOST}/tickets/v1/accesso155`, true],
    ['https://accessoticketing.com/x', true],
    ['https://whitewater.secure.na3.accessoticketing.com/', true],
    // The URL carries the order token: never sent in cleartext as-is.
    [`http://media-engine.na3.accessoticketing.com/tickets/v1/accesso155`, false],
    // The guard is a security boundary: these are what an SSRF attempt looks like.
    ['https://evil.com/', false],
    ['https://accessoticketing.com.evil.com/', false],
    ['http://169.254.169.254/latest/meta-data/', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isAccessoUrl(url)).toBe(expected);
  });
});

describe('toAccessoHttps (library export)', () => {
  // isAccessoUrl is https-only since the cleartext-token fix; library callers
  // that accepted http accesso links need an http-tolerant check that still
  // never hands back a cleartext URL.
  it.each([
    [`${HOST}/tickets/v1/accesso155`, `${HOST}/tickets/v1/accesso155`],
    [
      'http://media-engine.na3.accessoticketing.com/tickets/v1/accesso155?oToken=A1:X',
      'https://media-engine.na3.accessoticketing.com/tickets/v1/accesso155?oToken=A1:X',
    ],
    ['http://accessoticketing.com/x', 'https://accessoticketing.com/x'],
    ['https://evil.com/', null],
    ['http://accessoticketing.com.evil.com/', null],
    ['http://169.254.169.254/latest/meta-data/', null],
    ['file:///etc/passwd', null],
    ['not a url', null],
  ])('%s -> %s', (url, expected) => {
    expect(lib.toAccessoHttps(url)).toBe(expected);
  });

  it('accepts exactly the URLs isAccessoUrl accepts once upgraded', () => {
    const http = 'http://media-engine.na3.accessoticketing.com/tickets/v1/accesso155';
    expect(lib.isAccessoUrl(http)).toBe(false);
    expect(lib.isAccessoUrl(lib.toAccessoHttps(http) as string)).toBe(true);
  });
});

describe('redactUrl', () => {
  it('removes the order tokens that grant the tickets', () => {
    const out = redactUrl(TICKET_URL);
    expect(out).not.toContain('A1:TOK');
    expect(out).not.toContain('A1:CTOK');
    expect(out).toContain('oToken=REDACTED');
  });

  it('still redacts token-shaped text in something that is not a URL', () => {
    expect(redactUrl('junk A1:SECRETVALUE here')).toBe('junk A1:REDACTED here');
  });
});

describe('resolveTicketUrl', () => {
  it('prefers the argument', () => {
    expect(new AccessoClient().resolveTicketUrl(TICKET_URL)).toBe(TICKET_URL);
  });

  it('falls back to ACCESSO_TICKET_URL', () => {
    vi.stubEnv('ACCESSO_TICKET_URL', TICKET_URL);
    const c = new AccessoClient();
    expect(c.hasDefaultUrl).toBe(true);
    expect(c.resolveTicketUrl()).toBe(TICKET_URL);
  });

  it('reports a missing link as configuration, not a crash', () => {
    const c = new AccessoClient();
    expect(c.hasDefaultUrl).toBe(false);
    // The actionable half lives in `hint`, which createMcpServer surfaces.
    try {
      c.resolveTicketUrl();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      expect((err as McpToolError).message).toMatch(/No accesso ticket link/);
      expect((err as McpToolError).hint).toMatch(/ACCESSO_TICKET_URL/);
    }
  });

  it('refuses a non-accesso URL', () => {
    expect(() => new AccessoClient().resolveTicketUrl('https://evil.com/x')).toThrow(/non-accesso/i);
  });

  it('upgrades a plain-http accesso link to https rather than sending the token in cleartext', () => {
    const http = TICKET_URL.replace('https:', 'http:');
    expect(new AccessoClient().resolveTicketUrl(http)).toBe(TICKET_URL);
  });
});

describe('getOrder', () => {
  it('parses a live order page', async () => {
    const c = new AccessoClient({ fetch: fakeFetch(orderRoutes) });
    const order = await c.getOrder(TICKET_URL);
    expect(order.orderNumber).toBe('90000001');
    expect(order.tickets).toHaveLength(12);
    expect(order.tickets[0]!.googleWalletUrl).toContain('/google-wallet/v1/accesso155/A1:TOK/900001');
  });

  it('calls an expired link expired, even though accesso answers 200', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { status: 200, body: EXPIRED_HTML } }) });
    await expect(c.getOrder(TICKET_URL)).rejects.toThrow(/expired or invalid/i);
  });

  it('distinguishes layout drift from an expired link', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { body: '<html><body>hi</body></html>' } }) });
    await expect(c.getOrder(TICKET_URL)).rejects.toThrow(/No tickets found/i);
    await expect(c.getOrder(TICKET_URL)).rejects.toMatchObject({
      hint: expect.stringMatching(/layout may have changed/i),
    });
  });

  it('surfaces an HTTP error with the tokens stripped', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { status: 404 } }) });
    await expect(c.getOrder(TICKET_URL)).rejects.toThrow(/HTTP 404/);
    await expect(c.getOrder(TICKET_URL)).rejects.not.toThrow(/A1:TOK/);
  });

  it('gives a different hint for a server error than a bad path', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { status: 500 } }) });
    await expect(c.getOrder(TICKET_URL)).rejects.toMatchObject({
      hint: expect.stringMatching(/revoked/i),
    });
  });

  it('fetches a plain-http accesso link over https', async () => {
    const seen: string[] = [];
    const inner = fakeFetch(orderRoutes);
    const c = new AccessoClient({
      fetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(String(u));
        return inner(u, init);
      }) as typeof globalThis.fetch,
    });
    const order = await c.getOrder(TICKET_URL.replace('https:', 'http:'));
    expect(seen).toEqual([TICKET_URL]);
    expect(order.tickets[0]!.googleWalletUrl).toMatch(/^https:/);
  });

  describe('redirects (each hop must stay on the accesso apex)', () => {
    const OTHER = 'https://media-engine.eu1.accessoticketing.com';
    const MOVED = `${OTHER}/tickets/v1/accesso155?oToken=A1:TOK&cToken=A1:CTOK`;

    function recording(routes: Parameters<typeof fakeFetch>[0]) {
      const seen: { url: string; redirect?: RequestRedirect }[] = [];
      const inner = fakeFetch(routes);
      const fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: String(u), redirect: init?.redirect });
        return inner(u, init);
      }) as typeof globalThis.fetch;
      return { seen, fetch };
    }

    it('never lets fetch follow a redirect on its own', async () => {
      const { seen, fetch } = recording(orderRoutes);
      await new AccessoClient({ fetch }).getOrder(TICKET_URL);
      expect(seen).toEqual([{ url: TICKET_URL, redirect: 'manual' }]);
    });

    it('follows a redirect that stays on accesso, and parses against the final URL', async () => {
      const { seen, fetch } = recording({
        [HOST]: { status: 302, headers: { location: MOVED } },
        [OTHER]: { body: ORDER_HTML },
      });
      const order = await new AccessoClient({ fetch }).getOrder(TICKET_URL);
      expect(seen.map((s) => s.url)).toEqual([TICKET_URL, MOVED]);
      expect(order.tickets[0]!.googleWalletUrl!.startsWith(`${OTHER}/google-wallet/`)).toBe(true);
    });

    it('refuses a redirect off the accesso apex before fetching it', async () => {
      const { seen, fetch } = recording({
        [HOST]: { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
      });
      await expect(new AccessoClient({ fetch }).getOrder(TICKET_URL)).rejects.toThrow(/non-accesso/i);
      expect(seen.map((s) => s.url)).toEqual([TICKET_URL]);
    });

    it('upgrades a redirect to plain-http accesso to https', async () => {
      const { seen, fetch } = recording({
        [HOST]: { status: 301, headers: { location: MOVED.replace('https:', 'http:') } },
        [OTHER]: { body: ORDER_HTML },
      });
      await new AccessoClient({ fetch }).getOrder(TICKET_URL);
      expect(seen.map((s) => s.url)).toEqual([TICKET_URL, MOVED]);
    });

    it('treats a redirect with no location as an HTTP error', async () => {
      const { fetch } = recording({ [HOST]: { status: 302 } });
      await expect(new AccessoClient({ fetch }).getOrder(TICKET_URL)).rejects.toThrow(/HTTP 302/);
    });

    it('gives up rather than looping forever', async () => {
      const { fetch } = recording({ [HOST]: { status: 302, headers: { location: TICKET_URL } } });
      await expect(new AccessoClient({ fetch }).getOrder(TICKET_URL)).rejects.toThrow(/redirects/i);
    });

    it('makes at most 10 requests (MAX_REDIRECTS) before giving up', async () => {
      const { seen, fetch } = recording({ [HOST]: { status: 302, headers: { location: TICKET_URL } } });
      await expect(new AccessoClient({ fetch }).getOrder(TICKET_URL)).rejects.toThrow(/exceeded 10 redirects/i);
      expect(seen).toHaveLength(10);
    });

    it('cancels a redirect hop\'s body instead of leaving it open', async () => {
      const hop = new Response('moved', { status: 302, headers: { location: MOVED } });
      const fetch = (async (u: RequestInfo | URL) =>
        String(u) === TICKET_URL ? hop : new Response(ORDER_HTML)) as typeof globalThis.fetch;
      await new AccessoClient({ fetch }).getOrder(TICKET_URL);
      expect(hop.bodyUsed).toBe(true);
    });
  });

  it('falls back to the requested URL when the response reports none', async () => {
    const fetchNoUrl = (async () =>
      ({
        ok: true,
        status: 200,
        url: '',
        headers: new Headers(),
        text: async () => ORDER_HTML,
        json: async () => ({}),
      }) as unknown as Response) as typeof globalThis.fetch;
    const c = new AccessoClient({ fetch: fetchNoUrl });
    const order = await c.getOrder(TICKET_URL);
    expect(order.tickets[0]!.googleWalletUrl).toContain('A1:TOK');
  });

  it('wraps a network failure', async () => {
    const c = new AccessoClient({
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(c.getOrder(TICKET_URL)).rejects.toThrow(/Could not reach accesso/);
  });
});

describe('resolveLink', () => {
  it('returns an accesso URL unchanged, without a request', async () => {
    const fetchSpy = vi.fn();
    const c = new AccessoClient({ lookup: publicLookup, fetch: fetchSpy as unknown as typeof globalThis.fetch });
    expect(await c.resolveLink(TICKET_URL)).toEqual({ url: TICKET_URL, hops: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a tracker to the accesso link it wraps', async () => {
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: fakeFetch({
        'https://track.example.com': { status: 302, headers: { location: '/next' } },
        'https://track.example.com/next': { status: 302, headers: { location: TICKET_URL } },
      }),
    });
    expect(await c.resolveLink('https://track.example.com/a')).toEqual({ url: TICKET_URL, hops: 2 });
  });

  it('returns a plain-http accesso link as https, without fetching it in cleartext', async () => {
    const seen: string[] = [];
    const inner = fakeFetch({
      'https://track.example.com': { status: 302, headers: { location: TICKET_URL.replace('https:', 'http:') } },
    });
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(String(u));
        return inner(u, init);
      }) as typeof globalThis.fetch,
    });
    expect(await c.resolveLink('https://track.example.com/a')).toEqual({ url: TICKET_URL, hops: 1 });
    expect(seen).toEqual(['https://track.example.com/a']);
  });

  it('reports a chain that never reaches accesso', async () => {
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: fakeFetch({ 'https://track.example.com': { status: 418 } }),
    });
    const err = await c.resolveLink('https://track.example.com/a').catch((e: Error) => e);
    expect(String(err)).toMatch(/did not lead/i);
    // The upstream status is not echoed: it would turn the tool into a port/host probe.
    expect(String(err)).not.toMatch(/418/);
  });

  it('refuses to follow a redirect to a non-HTTP scheme', async () => {
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: fakeFetch({ 'https://track.example.com': { status: 302, headers: { location: 'javascript:alert(1)' } } }),
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/non-HTTP scheme/i);
  });

  it('gives up rather than looping forever', async () => {
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: fakeFetch({ 'https://track.example.com': { status: 302, headers: { location: 'https://track.example.com/again' } } }),
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/redirects/i);
  });

  it('makes at most 10 non-accesso requests (MAX_REDIRECTS) before giving up', async () => {
    const seen: string[] = [];
    const inner = fakeFetch({ 'https://track.example.com': { status: 302, headers: { location: 'https://track.example.com/again' } } });
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(String(u));
        return inner(u, init);
      }) as typeof globalThis.fetch,
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/exceeded 10 redirects/i);
    expect(seen).toHaveLength(10);
  });

  it('refuses to fetch a private or local first hop (SSRF guard)', async () => {
    const fetchSpy = vi.fn();
    const c = new AccessoClient({ lookup: publicLookup, fetch: fetchSpy as unknown as typeof globalThis.fetch });
    for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/', 'http://10.0.0.1/']) {
      await expect(c.resolveLink(url)).rejects.toThrow(/private, local or IP-address/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a tracker that resolves to a private address', async () => {
    const fetchSpy = vi.fn();
    const c = new AccessoClient({
      lookup: async () => ['127.0.0.1'],
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/private, local or IP-address/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a tracker that rebinds to a private address between the check and the connect', async () => {
    // No fetch injected: the production path. The guard's own lookup sees a
    // public address; the connection's lookup sees loopback. The pinned
    // dispatcher must refuse at connect instead of resolving a second time.
    let calls = 0;
    const c = new AccessoClient({
      lookup: async () => (calls++ === 0 ? ['93.184.215.14'] : ['127.0.0.1']),
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/private, local or IP-address/i);
    expect(calls).toBe(2);
  });

  it('refuses a redirect into the internal network before fetching it', async () => {
    const seen: string[] = [];
    const inner = fakeFetch({
      'https://track.example.com': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
    });
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(String(u));
        return inner(u, init);
      }) as typeof globalThis.fetch,
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/private, local or IP-address/i);
    expect(seen).toEqual(['https://track.example.com/a']);
  });

  it('cancels each hop\'s body instead of leaving it open', async () => {
    const res = new Response('tracker page', { status: 302, headers: { location: TICKET_URL } });
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: (async () => res) as unknown as typeof globalThis.fetch,
    });
    await c.resolveLink('https://track.example.com/a');
    expect(res.bodyUsed).toBe(true);
  });

  it('wraps a network failure while following', async () => {
    const c = new AccessoClient({
      lookup: publicLookup,
      fetch: (async () => {
        throw new Error('dns');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/Could not follow/);
  });
});

describe('getWalletSaveUrl', () => {
  const wallet = `${HOST}/google-wallet/v1/accesso155/A1:TOK/900001`;

  it('turns the pass endpoint into a Google save link', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { json: { jwt: 'JWT123' } } }) });
    expect(await c.getWalletSaveUrl(wallet)).toBe('https://pay.google.com/gp/v/save/JWT123');
  });

  it.each([[{}], [{ jwt: '' }]])('reports a merchant with no pass (%j)', async (json) => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { json } }) });
    await expect(c.getWalletSaveUrl(wallet)).rejects.toThrow(/did not return a Google Wallet pass/);
  });

  it.each([
    ['an HTML page', '<html><body>Something went wrong</body></html>'],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON array', '["JWT123"]'],
  ])('reports %s at HTTP 200 as no pass, not a raw parse error', async (_label, body) => {
    const c = new AccessoClient({ fetch: fakeFetch({ [HOST]: { body } }) });
    const err = await c.getWalletSaveUrl(wallet).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpToolError);
    expect(String(err)).toMatch(/did not return a Google Wallet pass/);
  });

  it('refuses a wallet URL off the accesso apex', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({}) });
    await expect(c.getWalletSaveUrl('https://evil.com/jwt')).rejects.toThrow(/non-accesso/i);
  });
});

describe('timeouts and cancellation', () => {
  /** A fetch that never answers until its signal fires, recording each init. */
  function stalled() {
    const inits: (RequestInit | undefined)[] = [];
    const fetch = ((_u: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as typeof globalThis.fetch;
    return { inits, fetch };
  }

  it('gives up on a stalled accesso fetch after the timeout', async () => {
    const { inits, fetch } = stalled();
    const c = new AccessoClient({ fetch, timeoutMs: 20 });
    const err = await c.getOrder(TICKET_URL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpToolError);
    expect(String(err)).toMatch(/Could not reach accesso/);
    expect((err as McpToolError).hint).toMatch(/in time|cancelled/i);
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on a stalled click-tracker after the timeout', async () => {
    const { fetch } = stalled();
    const c = new AccessoClient({ fetch, lookup: publicLookup, timeoutMs: 20 });
    const err = await c.resolveLink('https://track.example.com/a').catch((e: unknown) => e);
    expect(String(err)).toMatch(/Could not follow/);
    expect((err as McpToolError).hint).toMatch(/in time|cancelled/i);
  });

  it("stops fetching when the caller cancels the tool call", async () => {
    const { inits, fetch } = stalled();
    const c = new AccessoClient({ fetch });
    const caller = new AbortController();
    const pending = withCallSignal(caller.signal, () => c.getOrder(TICKET_URL)).catch((e: unknown) => e);
    await vi.waitFor(() => expect(inits).toHaveLength(1));
    caller.abort();
    expect(String(await pending)).toMatch(/Could not reach accesso/);
    expect(inits[0]!.signal!.aborted).toBe(true);
  });

  it('defaults to a bounded timeout', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const inner = fakeFetch(orderRoutes);
    const c = new AccessoClient({
      fetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init?.signal);
        return inner(u, init);
      }) as typeof globalThis.fetch,
    });
    await c.getOrder(TICKET_URL);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });
});
