import type { SocialLinks } from '../types';
import { assertPublicHttpUrl, readTextCapped, safeFetch } from './safe-fetch';

export interface ScrapedSource {
  source: string;
  url: string;
  title: string;
  text: string;
}

export interface ScrapeWarning {
  source: string;
  url: string;
  reason: string;
}

const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SkillforgeBot/1.0; +https://next-gen-skillforge.workers.dev)',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
};

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 1_200_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const { response } = await safeFetch(
    url,
    { ...init, headers: { ...SCRAPE_HEADERS, ...(init.headers ?? {}) } },
    { timeoutMs: FETCH_TIMEOUT_MS },
  );
  return response;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html: string, pattern: RegExp): string {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function extractTitle(html: string): string {
  return extractMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
}

export function usernameFromUrl(url: string, expectedHost?: string): string | null {
  try {
    const parsed = new URL(url);
    if (expectedHost) {
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      const target = expectedHost.toLowerCase();
      if (host !== target && host !== `www.${target}`) return null;
    }
    const segment = parsed.pathname.split('/').filter(Boolean)[0];
    return segment || null;
  } catch {
    return null;
  }
}

function assertUsername(username: string | null, pattern: RegExp, source: string): string {
  if (!username || !pattern.test(username)) {
    throw new Error(`Invalid ${source} profile URL`);
  }
  return username;
}

async function scrapeGitHub(url: string): Promise<ScrapedSource> {
  const username = assertUsername(usernameFromUrl(url, 'github.com'), /^[a-zA-Z0-9-]{1,39}$/, 'GitHub');

  const profileResp = await fetchWithTimeout(`https://api.github.com/users/${encodeURIComponent(username)}`);
  if (!profileResp.ok) throw new Error(`GitHub profile fetch failed (${profileResp.status})`);
  const profile = await profileResp.json() as Record<string, unknown>;

  const reposResp = await fetchWithTimeout(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`,
  );
  const repos = reposResp.ok
    ? ((await reposResp.json()) as Array<Record<string, unknown>>)
    : [];

  const repoParts = repos.slice(0, 40).map((repo) => {
    const topics = Array.isArray(repo.topics) ? repo.topics.join(' ') : '';
    return [
      String(repo.name ?? ''),
      String(repo.description ?? ''),
      String(repo.language ?? ''),
      topics,
      repo.fork ? '' : 'open source personal project',
    ].join(' ');
  });

  const parts = [
    String(profile.name ?? username),
    String(profile.bio ?? ''),
    String(profile.company ?? ''),
    String(profile.location ?? ''),
    String(profile.blog ?? ''),
    `Followers ${Number(profile.followers ?? 0)}, public repositories ${Number(profile.public_repos ?? repos.length)}`,
    `GitHub skills languages: ${repos
      .map((r) => String(r.language ?? ''))
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .join(', ')}`,
    ...repoParts,
  ];

  return {
    source: 'github',
    url,
    title: String(profile.name ?? username),
    text: parts.filter(Boolean).join('. '),
  };
}

async function scrapeDevTo(url: string): Promise<ScrapedSource> {
  const username = assertUsername(usernameFromUrl(url, 'dev.to'), /^[a-zA-Z0-9_-]{1,64}$/, 'Dev.to');

  const response = await fetchWithTimeout(`https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=20`);
  if (!response.ok) throw new Error(`Dev.to fetch failed (${response.status})`);
  const articles = await response.json() as Array<Record<string, unknown>>;

  const parts = articles.flatMap((article) => [
    String(article.title ?? ''),
    Array.isArray(article.tag_list) ? article.tag_list.join(' ') : '',
    String(article.description ?? ''),
  ]);

  return {
    source: 'devto',
    url,
    title: `${username} on Dev.to`,
    text: `Technical writing and articles. ${parts.join('. ')}`,
  };
}

async function scrapeGeneric(url: string, source: string): Promise<ScrapedSource> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Fetch failed (${response.status})`);

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const readable = !contentType
    || contentType.startsWith('text/')
    || contentType.includes('json')
    || contentType.includes('xml');
  if (!readable) {
    throw new Error(`Unsupported content type (${contentType || 'unknown'})`);
  }

  const html = await readTextCapped(response, MAX_HTML_BYTES);

  const title = extractTitle(html);
  const description = extractMeta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || extractMeta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const keywords = extractMeta(html, /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i)
    || extractMeta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']keywords["']/i);
  const ogTitle = extractMeta(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);

  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .slice(0, 12)
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);

  const bodyText = stripHtml(html).slice(0, 6000);

  return {
    source,
    url,
    title: title || ogTitle || url,
    text: [ogTitle, title, description, keywords, ...headings, bodyText].filter(Boolean).join('. '),
  };
}

function buildResumeSource(resumeText: string, resumeFileName?: string): ScrapedSource {
  return {
    source: 'resume',
    url: resumeFileName ? `uploaded:${resumeFileName}` : 'uploaded:resume',
    title: resumeFileName || 'Uploaded resume',
    text: resumeText,
  };
}

export async function collectSources(
  links: Partial<SocialLinks>,
  resumeText?: string,
  resumeFileName?: string,
): Promise<{ sources: ScrapedSource[]; warnings: ScrapeWarning[] }> {
  const sources: ScrapedSource[] = [];
  const warnings: ScrapeWarning[] = [];

  const tasks: Array<Promise<void>> = [];

  if (links.github) {
    tasks.push(
      scrapeGitHub(links.github)
        .then((source) => { sources.push(source); })
        .catch((error: unknown) => {
          warnings.push({ source: 'github', url: links.github!, reason: error instanceof Error ? error.message : 'Fetch failed' });
        }),
    );
  }

  if (links.devto) {
    tasks.push(
      scrapeDevTo(links.devto)
        .then((source) => { sources.push(source); })
        .catch((error: unknown) => {
          warnings.push({ source: 'devto', url: links.devto!, reason: error instanceof Error ? error.message : 'Fetch failed' });
        }),
    );
  }

  const genericLinks: Array<{ url: string; source: string }> = [];
  if (links.portfolio) genericLinks.push({ url: links.portfolio, source: 'portfolio' });
  if (links.linkedin) genericLinks.push({ url: links.linkedin, source: 'linkedin' });
  if (links.twitter) genericLinks.push({ url: links.twitter, source: 'twitter' });
  if (links.resume) genericLinks.push({ url: links.resume, source: 'resume-url' });

  for (const link of genericLinks) {
    try {
      assertPublicHttpUrl(link.url);
    } catch (error) {
      warnings.push({
        source: link.source,
        url: link.url,
        reason: error instanceof Error ? error.message : 'Unsupported URL',
      });
      continue;
    }

    tasks.push(
      scrapeGeneric(link.url, link.source)
        .then((source) => { sources.push(source); })
        .catch((error: unknown) => {
          warnings.push({
            source: link.source,
            url: link.url,
            reason: error instanceof Error ? error.message : 'Fetch failed',
          });
        }),
    );
  }

  await Promise.all(tasks);

  if (resumeText && resumeText.trim().length >= 40) {
    sources.push(buildResumeSource(resumeText.trim(), resumeFileName));
  }

  return { sources, warnings };
}

export function buildProfileText(
  links: Partial<SocialLinks>,
  sources: ScrapedSource[],
): string {
  const linkList = Object.entries(links)
    .filter(([, url]) => Boolean(url))
    .map(([key, url]) => `${key}: ${url}`);

  const sourceTexts = sources.map((source) => `[${source.source}] ${source.title}. ${source.text}`);
  return [...linkList, ...sourceTexts].join('\n\n').slice(0, 24000);
}
