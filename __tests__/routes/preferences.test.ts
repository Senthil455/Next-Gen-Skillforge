import { describe, it, expect } from 'vitest';
import {
  sanitizeTheme,
  sanitizeLinkValue,
  sanitizeLinks,
  sanitizeLinkUpdates,
} from '../../src/routes/preferences';

describe('sanitizeTheme', () => {
  it.each([['light'], ['dark']])('accepts %s', (input) => {
    expect(sanitizeTheme(input)).toBe(input);
  });

  it.each([[''], ['medium'], [null], [undefined], [123], ['LIGHT']])('rejects %j', (input) => {
    expect(sanitizeTheme(input)).toBeUndefined();
  });
});

describe('sanitizeLinkValue', () => {
  it('accepts valid https URLs', () => {
    expect(sanitizeLinkValue('https://github.com/user')).toBe('https://github.com/user');
  });

  it('accepts valid http URLs', () => {
    expect(sanitizeLinkValue('http://example.com')).toBe('http://example.com/');
  });

  it('strips hash fragments', () => {
    expect(sanitizeLinkValue('https://github.com/user#section')).toBe('https://github.com/user');
  });

  it('rejects non-http protocols', () => {
    expect(sanitizeLinkValue('ftp://example.com')).toBeUndefined();
    expect(sanitizeLinkValue('javascript:alert(1)')).toBeUndefined();
  });

  it('rejects empty strings', () => {
    expect(sanitizeLinkValue('')).toBeUndefined();
    expect(sanitizeLinkValue('   ')).toBeUndefined();
  });

  it('rejects invalid URLs', () => {
    expect(sanitizeLinkValue('not-a-url')).toBeUndefined();
  });
});

describe('sanitizeLinkUpdates', () => {
  it('returns empty updates for non-object input', () => {
    expect(sanitizeLinkUpdates(null)).toEqual({ set: {}, remove: [] });
    expect(sanitizeLinkUpdates('string')).toEqual({ set: {}, remove: [] });
  });

  it('marks empty and null values for removal', () => {
    const result = sanitizeLinkUpdates({ github: '', linkedin: '   ', twitter: null });
    expect(result.set).toEqual({});
    expect(result.remove).toEqual(['github', 'linkedin', 'twitter']);
  });

  it('ignores keys that were not sent', () => {
    const result = sanitizeLinkUpdates({ github: 'https://github.com/user' });
    expect(result.set).toEqual({ github: 'https://github.com/user' });
    expect(result.remove).toEqual([]);
  });

  it('drops invalid non-empty values without removing them', () => {
    const result = sanitizeLinkUpdates({ github: 'not-a-url', devto: 'https://dev.to/user' });
    expect(result.set).toEqual({ devto: 'https://dev.to/user' });
    expect(result.remove).toEqual([]);
  });

  it('sets valid links and removes cleared ones in one payload', () => {
    const result = sanitizeLinkUpdates({
      github: 'https://github.com/user',
      linkedin: '',
      portfolio: 'https://portfolio.dev',
    });
    expect(result.set).toEqual({
      portfolio: 'https://portfolio.dev/',
      github: 'https://github.com/user',
    });
    expect(result.remove).toEqual(['linkedin']);
  });
});

describe('sanitizeLinks', () => {
  it('returns empty object for non-object input', () => {
    expect(sanitizeLinks(null)).toEqual({});
    expect(sanitizeLinks(undefined)).toEqual({});
    expect(sanitizeLinks('string')).toEqual({});
    expect(sanitizeLinks(123)).toEqual({});
  });

  it('sanitizes valid links and drops invalid ones', () => {
    const result = sanitizeLinks({
      github: 'https://github.com/user',
      linkedin: 'not-a-url',
      twitter: 'https://twitter.com/user',
      resume: '',
      portfolio: 'ftp://files.com',
      devto: 'https://dev.to/user',
    });
    expect(result.github).toBe('https://github.com/user');
    expect(result.twitter).toBe('https://twitter.com/user');
    expect(result.devto).toBe('https://dev.to/user');
    expect(result.linkedin).toBeUndefined();
    expect(result.resume).toBeUndefined();
    expect(result.portfolio).toBeUndefined();
  });

  it('trims whitespace and normalizes', () => {
    const result = sanitizeLinks({
      github: '  https://github.com/user  ',
    });
    expect(result.github).toBe('https://github.com/user');
  });
});
