import { describe, expect, it } from 'vitest';
import { parseRobots, RobotsCache } from './robots';

const robots = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/public-note
Disallow: /*.pdf$

User-agent: NewsmediaBot
User-agent: OtherBot
Disallow: /no-bots/
`;

describe('parseRobots', () => {
  it('applies the wildcard group to unknown agents', () => {
    const rules = parseRobots(robots, 'SomeCrawler/1.0');
    expect(rules.isAllowed('/news/1')).toBe(true);
    expect(rules.isAllowed('/private/x')).toBe(false);
    expect(rules.isAllowed('/private/public-note')).toBe(true); // longer Allow wins
    expect(rules.isAllowed('/files/report.pdf')).toBe(false);
    expect(rules.isAllowed('/files/report.pdf?x=1')).toBe(true); // $ anchors the end
  });

  it('uses the most specific group for our own agent', () => {
    const rules = parseRobots(robots, 'NewsmediaBot/1.0 (+https://x)');
    expect(rules.isAllowed('/private/x')).toBe(true);
    expect(rules.isAllowed('/no-bots/a')).toBe(false);
  });

  it('treats an empty Disallow as allow-all', () => {
    expect(parseRobots('User-agent: *\nDisallow:', 'Bot').isAllowed('/anything')).toBe(true);
  });
});

describe('RobotsCache', () => {
  it('loads robots.txt once per origin and allows when it is missing', async () => {
    let loads = 0;
    const cache = new RobotsCache(async (origin) => {
      loads += 1;
      return origin.includes('strict') ? 'User-agent: *\nDisallow: /' : null;
    }, 'Bot/1');
    expect(await cache.isAllowed('https://strict.example/a')).toBe(false);
    expect(await cache.isAllowed('https://strict.example/b')).toBe(false);
    expect(await cache.isAllowed('https://open.example/a')).toBe(true);
    expect(loads).toBe(2);
  });
});
