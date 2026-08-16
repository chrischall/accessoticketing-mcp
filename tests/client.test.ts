import { describe, expect, it, vi } from 'vitest';
import { McpToolError } from '@chrischall/mcp-utils';
import { AccessoClient, isAccessoUrl, redactUrl } from '../src/client.js';
import { ORDER_HTML, EXPIRED_HTML, HOST, TICKET_URL, fakeFetch } from './helpers.js';

const orderRoutes = { [HOST]: { body: ORDER_HTML } };

describe('isAccessoUrl', () => {
  it.each([
    [`${HOST}/tickets/v1/accesso155`, true],
    ['https://accessoticketing.com/x', true],
    ['https://whitewater.secure.na3.accessoticketing.com/', true],
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
    // The actionable half lives in `hint`, which is what withHints surfaces.
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
    const c = new AccessoClient({ fetch: fetchSpy as unknown as typeof globalThis.fetch });
    expect(await c.resolveLink(TICKET_URL)).toEqual({ url: TICKET_URL, hops: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a tracker to the accesso link it wraps', async () => {
    const c = new AccessoClient({
      fetch: fakeFetch({
        'https://track.example.com': { status: 302, headers: { location: '/next' } },
        'https://track.example.com/next': { status: 302, headers: { location: TICKET_URL } },
      }),
    });
    expect(await c.resolveLink('https://track.example.com/a')).toEqual({ url: TICKET_URL, hops: 2 });
  });

  it('reports a chain that never reaches accesso', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({ 'https://track.example.com': { status: 200 } }) });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/did not lead/i);
  });

  it('refuses to follow a redirect to a non-HTTP scheme', async () => {
    const c = new AccessoClient({
      fetch: fakeFetch({ 'https://track.example.com': { status: 302, headers: { location: 'javascript:alert(1)' } } }),
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/non-HTTP scheme/i);
  });

  it('gives up rather than looping forever', async () => {
    const c = new AccessoClient({
      fetch: fakeFetch({ 'https://track.example.com': { status: 302, headers: { location: 'https://track.example.com/again' } } }),
    });
    await expect(c.resolveLink('https://track.example.com/a')).rejects.toThrow(/redirects/i);
  });

  it('wraps a network failure while following', async () => {
    const c = new AccessoClient({
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

  it('refuses a wallet URL off the accesso apex', async () => {
    const c = new AccessoClient({ fetch: fakeFetch({}) });
    await expect(c.getWalletSaveUrl('https://evil.com/jwt')).rejects.toThrow(/non-accesso/i);
  });
});
