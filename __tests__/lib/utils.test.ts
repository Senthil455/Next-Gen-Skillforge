import { describe, it, expect } from 'vitest';
import { cn, hasAnalyzableInput } from '../../lib/utils';

describe('cn', () => {
  it('merges class names and resolves conflicts', () => {
    expect(cn('px-2', 'px-4', 'text-sm')).toBe('px-4 text-sm');
  });

  it('drops falsy values', () => {
    expect(cn('base', false, undefined, null, '')).toBe('base');
  });
});

describe('hasAnalyzableInput', () => {
  it('is false when there are no links and no resume', () => {
    expect(hasAnalyzableInput({}, '')).toBe(false);
    expect(hasAnalyzableInput({}, null)).toBe(false);
    expect(hasAnalyzableInput({}, undefined)).toBe(false);
  });

  it('ignores blank link values', () => {
    expect(hasAnalyzableInput({ github: '   ', portfolio: '' }, '')).toBe(false);
  });

  it('is true when at least one link is present', () => {
    expect(hasAnalyzableInput({ github: 'https://github.com/octocat' })).toBe(true);
  });

  it('is true when only a resume file is present', () => {
    expect(hasAnalyzableInput({}, 'resume.txt')).toBe(true);
  });
});
