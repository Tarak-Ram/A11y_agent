import { describe, expect, it } from 'vitest';
import { safeNext } from '../lib/api';
import { scoreLabel } from '../lib/utils';

describe('safeNext (no open redirects)', () => {
  it('allows same-site paths', () => {
    expect(safeNext('/projects/new?url=https%3A%2F%2Fa.com')).toBe('/projects/new?url=https%3A%2F%2Fa.com');
    expect(safeNext('/runs/abc/report')).toBe('/runs/abc/report');
  });
  it('rejects external and protocol-relative targets', () => {
    for (const bad of ['https://evil.com', '//evil.com', 'javascript:alert(1)', String.raw`/\evil.com`, null, undefined, '']) {
      expect(safeNext(bad as string)).toBe('/dashboard');
    }
  });
});

describe('scoreLabel', () => {
  it('maps scores to words (never colour only)', () => {
    expect(scoreLabel(95)).toBe('Good');
    expect(scoreLabel(75)).toBe('Needs work');
    expect(scoreLabel(50)).toBe('Poor');
    expect(scoreLabel(10)).toBe('Failing');
    expect(scoreLabel(null)).toBe('Not scored');
  });
});
