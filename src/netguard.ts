import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { McpToolError } from '@chrischall/mcp-utils';

/**
 * SSRF guard for the one tool that must fetch a non-accesso URL: following an
 * email click-tracker. The URL (and every redirect it issues) is chosen by
 * someone other than the user, so before each hop the host must be a public
 * DNS name that resolves only to public addresses.
 *
 * Known limit: `fetch` resolves the name again itself, so a DNS-rebinding host
 * could still answer differently between the check and the request. Closing
 * that needs a pinned-address dispatcher; this guard removes the direct routes
 * (IP literals, local names, names that plainly resolve inward).
 */

/** Resolves a hostname to its addresses. Injectable so tests never touch DNS. */
export type Lookup = (hostname: string) => Promise<string[]>;

export const systemLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

// Two lists, not one: a BlockList matches IPv4 addresses against IPv6 rules via
// their mapped form, so the ::ffff:0:0/96 rule would otherwise block all IPv4.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked4.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 127], // unspecified + loopback
  ['::ffff:0:0', 96], // IPv4-mapped: never a legitimate public DNS answer
  ['64:ff9b::', 96], // NAT64 can wrap any IPv4, including private ones
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked6.addSubnet(net, prefix, 'ipv6');
}

/** True for any address a click-tracker has no business pointing at. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked4.check(ip, 'ipv4');
  if (family === 6) return blocked6.check(ip, 'ipv6');
  return true;
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.arpa'];

function refuse(): never {
  throw new McpToolError('Refusing to follow a link to a private, local or IP-address host.', {
    hint: 'accesso_resolve_link only follows public email click-tracking links.',
  });
}

/** Throws unless `url` names a public host that resolves only to public addresses. */
export async function assertPublicHost(url: URL, lookup: Lookup): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  // IP literals are refused outright: a real tracker uses a name. (WHATWG URL
  // has already normalised decimal/octal/hex IPv4 forms to dotted quads.)
  if (isIP(host) !== 0) refuse();
  // Single-label names (localhost, intranet hosts) resolve via local search
  // domains, never the public DNS.
  if (!host.includes('.') || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) refuse();

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch (cause) {
    throw new McpToolError(`Could not resolve the link's host: ${host}`, {
      hint: 'Check you copied the whole link from the email, and network connectivity.',
      cause,
    });
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) refuse();
}
