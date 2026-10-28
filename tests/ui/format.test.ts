import { hostOf, plural, timeAgo } from '../../src/ui/format';

describe('format', () => {
  it('formats relative times', () => {
    expect(timeAgo(1000, 1000)).toBe('just now');
    expect(timeAgo(0, 3 * 86_400_000)).toMatch(/3 days ago/);
    expect(timeAgo(0, 2 * 3_600_000)).toMatch(/2 hours ago/);
  });

  it('pluralizes', () => {
    expect(plural(1, 'tab')).toBe('1 tab');
    expect(plural(2, 'tab')).toBe('2 tabs');
  });

  it('extracts hosts and falls back to the input', () => {
    expect(hostOf('https://jisho.org/search')).toBe('jisho.org');
    expect(hostOf('about:blank')).toBe('about:blank');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
