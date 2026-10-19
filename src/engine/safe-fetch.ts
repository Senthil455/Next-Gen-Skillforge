const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.goog']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

export function isPrivateIpv4(host: string): boolean {
  const octets = parseIpv4(host);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;

  return false;
}

export function isPrivateIpv6(host: string): boolean {
  const value = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = value.toLowerCase();

  if (lower === '::' || lower === '::1') return true;
  if (/^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(lower)) return true;

  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  const firstGroup = parseInt(lower.split(':')[0] || '0', 16);
  if (Number.isFinite(firstGroup)) {
    if ((firstGroup & 0xfe00) === 0xfc00) return true;
    if ((firstGroup & 0xffc0) === 0xfe80) return true;
    if ((firstGroup & 0xff00) === 0xff00) return true;
  }

  return false;
}

export function isPublicFetchUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) return false;
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;

  if (hostname.startsWith('[') || hostname.includes(':')) {
    return !isPrivateIpv6(hostname);
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return !isPrivateIpv4(hostname);

  return hostname.includes('.') && !hostname.startsWith('.') && !hostname.endsWith('.');
}

export function assertPublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Not a valid absolute URL');
  }

  if (!isPublicFetchUrl(url)) {
    throw new Error('Refusing to fetch a private, local, or unsupported URL');
  }

  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
}

export interface SafeFetchResult {
  response: Response;
  finalUrl: string;
}

export async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = assertPublicHttpUrl(input);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current.toString(), { ...init, redirect: 'manual', signal });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: current.toString() };
      current = assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    return { response, finalUrl: current.toString() };
  }

  throw new Error('Too many redirects while fetching the source');
}

export async function readTextCapped(response: Response, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      if (total + value.byteLength > maxBytes) {
        chunks.push(value.slice(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    if (truncated) {
      await reader.cancel().catch(() => undefined);
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return new TextDecoder().decode(combined);
}
