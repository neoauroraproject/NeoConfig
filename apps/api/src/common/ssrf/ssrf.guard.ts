import { lookup } from 'dns/promises';
import ipaddr from 'ipaddr.js';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfError('Only http(s) URLs are allowed');
  }

  if (url.username || url.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SsrfError('Host is not allowed');
  }

  if (ipaddr.isValid(host)) {
    assertPublicIp(host);
  }

  return url;
}

export async function resolveAndAssertPublic(url: URL): Promise<string[]> {
  const host = url.hostname;
  if (ipaddr.isValid(host)) {
    assertPublicIp(host);
    return [host];
  }

  let records: { address: string; family: number }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError('DNS resolution failed');
  }

  if (!records.length) {
    throw new SsrfError('DNS resolution returned no addresses');
  }

  for (const r of records) {
    assertPublicIp(r.address);
  }
  return records.map((r) => r.address);
}

function assertPublicIp(ip: string): void {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    throw new SsrfError('Invalid IP address');
  }

  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }

  const range = addr.range();
  const blocked = new Set([
    'unspecified',
    'broadcast',
    'multicast',
    'linkLocal',
    'loopback',
    'private',
    'reserved',
    'carrierGradeNat',
    'benchmarking',
    'uniqueLocal',
  ]);

  if (blocked.has(range)) {
    throw new SsrfError(`Blocked IP range: ${range}`);
  }
}

export async function safeFetchSubscription(
  rawUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number },
): Promise<Response> {
  const url = assertPublicHttpUrl(rawUrl);
  await resolveAndAssertPublic(url);

  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'NeoConfig/1.0',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      throw new SsrfError('Redirects are not followed');
    }

    return res;
  } finally {
    clearTimeout(timer);
  }
}
