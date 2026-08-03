import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const IPV4_BLOCKS: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0000200, 24], // 192.0.2.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xc6336400, 24], // 198.51.100.0/24
  [0xcb007100, 24], // 203.0.113.0/24
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4
];

const IPV6_BLOCKS: Array<[bigint, number]> = [
  [0n, 128], // ::/128
  [1n, 128], // ::1/128
  [0xfc00n << 112n, 7], // fc00::/7
  [0xfe80n << 112n, 10], // fe80::/10
  [0xff00n << 112n, 8], // ff00::/8
];

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function inIpv4Block(ipInt: number, block: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (block & mask);
}

function parseIpv6(ip: string): bigint | null {
  let normalized = normalizeHostname(ip);
  if (normalized.includes('.')) {
    const colon = normalized.lastIndexOf(':');
    const v4 = colon >= 0 ? normalized.slice(colon + 1) : '';
    const v4Int = ipv4ToInt(v4);
    if (v4Int === null) return null;
    normalized = `${normalized.slice(0, colon)}:${((v4Int >>> 16) & 0xffff).toString(16)}:${(v4Int & 0xffff).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const gap = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = halves.length === 2 ? [...left, ...Array(gap).fill('0'), ...right] : left;
  if (groups.length !== 8 || gap < 0) return null;

  let out = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    out = (out << 16n) | BigInt(parseInt(group, 16));
  }
  return out;
}

function ipv4FromMappedIpv6(ipv6: bigint): string | null {
  if ((ipv6 >> 32n) !== 0xffffn) return null;
  const v4 = Number(ipv6 & 0xffffffffn);
  return [(v4 >>> 24) & 255, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join('.');
}

function inIpv6Block(ipInt: bigint, block: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return (ipInt >> shift) === (block >> shift);
}

export function isBlockedIp(ip: string): boolean {
  const normalized = normalizeHostname(ip);

  if (isIP(normalized) === 4) {
    const ipInt = ipv4ToInt(normalized);
    return ipInt === null || IPV4_BLOCKS.some(([block, prefix]) => inIpv4Block(ipInt, block, prefix));
  }

  if (isIP(normalized) === 6) {
    const ipInt = parseIpv6(normalized);
    if (ipInt === null) return true;

    const mapped = ipv4FromMappedIpv6(ipInt);
    if (mapped) return isBlockedIp(mapped);

    return IPV6_BLOCKS.some(([block, prefix]) => inIpv6Block(ipInt, block, prefix));
  }

  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  );
}

export async function assertOutboundAllowed(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SSRF blocked: invalid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SSRF blocked: unsupported URL scheme ${parsed.protocol}`);
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(hostname)) {
    throw new Error(`SSRF blocked: ${hostname} is a private/reserved hostname`);
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`SSRF blocked: ${hostname} is a private/reserved address`);
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.some(({ address }) => isBlockedIp(address))) {
    throw new Error(`SSRF blocked: ${hostname} resolves to a private/reserved address`);
  }
}
