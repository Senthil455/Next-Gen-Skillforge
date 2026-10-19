import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  assertPublicHttpUrl,
  isPublicFetchUrl,
  readTextCapped,
  safeFetch,
} from '../../src/engine/safe-fetch';
import { collectSources, usernameFromUrl } from '../../src/engine/scrape';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPublicFetchUrl', () => {
  it.each([
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://172.16.5.5/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.100.100.100/',
    'http://198.18.0.1/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://service.internal/',
    'http://printer.local/',
    'https://user:pass@example.com/',
    'javascript:alert(1)',
    'ftp://example.com/file',
    'https://2130706433/',
  ])('blocks %s', (raw) => {
    expect(isPublicFetchUrl(new URL(raw))).toBe(false);
  });

  it.each([
    'https://github.com/octocat',
    'https://example.com/',
    'http://example.com:8080/page',
    'https://sub.domain.co.uk/path?q=1',
    'https://1.1.1.1/',
    'http://[2606:4700:4700::1111]/',
  ])('allows %s', (raw) => {
    expect(isPublicFetchUrl(new URL(raw))).toBe(true);
  });
});

describe('assertPublicHttpUrl', () => {
  it('throws a readable error for private targets', () => {
    expect(() => assertPublicHttpUrl('http://169.254.169.254/')).toThrow(/private, local, or unsupported/);
  });

  it('throws for relative values', () => {
    expect(() => assertPublicHttpUrl('/profile')).toThrow(/valid absolute URL/);
  });
});

describe('safeFetch', () => {
  it('follows public redirects', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { response, finalUrl } = await safeFetch('https://example.com/start');
    expect(response.status).toBe(200);
    expect(finalUrl).toBe('https://example.com/final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect that points at a private address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/' },
    })));

    await expect(safeFetch('https://example.com/start')).rejects.toThrow(/private, local, or unsupported/);
  });

  it('rejects a private URL before calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(safeFetch('http://127.0.0.1/')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('readTextCapped', () => {
  it('truncates responses past the byte cap', async () => {
    const response = new Response('abcdefghij'.repeat(100), { status: 200 });
    const text = await readTextCapped(response, 100);
    expect(text).toHaveLength(100);
  });

  it('returns the full body when under the cap', async () => {
    const response = new Response('hello world', { status: 200 });
    expect(await readTextCapped(response, 1000)).toBe('hello world');
  });
});

describe('usernameFromUrl host matching', () => {
  it('accepts exact and www hosts', () => {
    expect(usernameFromUrl('https://github.com/octocat', 'github.com')).toBe('octocat');
    expect(usernameFromUrl('https://www.github.com/octocat', 'github.com')).toBe('octocat');
  });

  it('rejects lookalike domains', () => {
    expect(usernameFromUrl('https://evilgithub.com/octocat', 'github.com')).toBeNull();
    expect(usernameFromUrl('https://github.com.evil.com/octocat', 'github.com')).toBeNull();
    expect(usernameFromUrl('https://notdev.to/foo', 'dev.to')).toBeNull();
  });
});

describe('collectSources URL filtering', () => {
  it('warns about a private portfolio link without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { sources, warnings } = await collectSources({ portfolio: 'http://169.254.169.254/' });
    expect(sources).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].source).toBe('portfolio');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
