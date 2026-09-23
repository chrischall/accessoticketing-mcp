import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPrivateAddress, systemLookup } from '../src/netguard.js';

const publicLookup = async () => ['93.184.215.14'];

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['::', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['not-an-ip', true],
    ['93.184.215.14', false],
    ['2606:2800:220:1:248:1893:25c8:1946', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('assertPublicHost', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/', // decimal form of 127.0.0.1
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://8.8.8.8/', // IP literals are refused outright, public or not
    'http://localhost:8080/',
    'http://intranet/',
    'http://printer.local/',
    'http://db.internal/',
    'http://foo.localhost/',
  ])('refuses %s without resolving it', async (url) => {
    let looked = false;
    const lookup = async () => {
      looked = true;
      return ['93.184.215.14'];
    };
    await expect(assertPublicHost(new URL(url), lookup)).rejects.toThrow(/private, local or IP-address/i);
    expect(looked).toBe(false);
  });

  it('refuses a public-looking name that resolves to a private address', async () => {
    await expect(
      assertPublicHost(new URL('https://rebind.example.com/'), async () => ['93.184.215.14', '10.0.0.5']),
    ).rejects.toThrow(/private, local or IP-address/i);
  });

  it('refuses a name that resolves to nothing', async () => {
    await expect(assertPublicHost(new URL('https://empty.example.com/'), async () => [])).rejects.toThrow(
      /private, local or IP-address/i,
    );
  });

  it('wraps a DNS failure', async () => {
    await expect(
      assertPublicHost(new URL('https://nx.example.com/'), async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow(/Could not resolve/);
  });

  it('allows a public host, including a fully-qualified trailing dot', async () => {
    await expect(assertPublicHost(new URL('https://track.example.com/a'), publicLookup)).resolves.toBeUndefined();
    await expect(assertPublicHost(new URL('https://track.example.com./a'), publicLookup)).resolves.toBeUndefined();
  });
});

describe('systemLookup', () => {
  it('resolves through the OS resolver (localhost needs no network)', async () => {
    const addrs = await systemLookup('localhost');
    expect(addrs.length).toBeGreaterThan(0);
    expect(addrs.every((a) => isPrivateAddress(a))).toBe(true);
  });
});
