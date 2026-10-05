import { describe, expect, it } from 'vitest';
import { routeForPath } from './links';

describe('routeForPath (notification taps)', () => {
  const id = '3f1c2a4e-9b7d-4c1e-8a2f-0b6d5e4c3a21';
  it('opens articles natively in the story language', () => {
    expect(routeForPath(`/en/a/${id}/major-outage`)).toBe(`/article/${id}?locale=en`);
    expect(routeForPath(`https://news.example.com/bg/a/${id}/srive`)).toBe(
      `/article/${id}?locale=bg`,
    );
  });
  it('opens topics', () => {
    expect(routeForPath('/bg/t/politics')).toBe('/topic/politics?locale=bg');
  });
  it('falls back to the feed for anything else', () => {
    for (const path of [
      null,
      '',
      '/bg',
      '/en/account',
      '/xx/a/not-a-uuid/x',
      'javascript:alert(1)',
    ])
      expect(routeForPath(path)).toBe('/');
  });
});
