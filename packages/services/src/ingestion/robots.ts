/**
 * Minimal robots.txt support (RFC 9309): groups by user-agent, Allow/Disallow
 * with longest-match precedence, `*` and `$` wildcards. We honour it for every
 * page the scraper requests — part of being a well-behaved aggregator.
 */

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsRules {
  isAllowed(pathWithQuery: string): boolean;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const token = userAgent.split('/')[0]!.toLowerCase();
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | undefined;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (field === 'disallow' && value === '') continue; // empty Disallow = allow everything
      current.rules.push({ allow: field === 'allow', pattern: value });
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules).map((r) => ({ ...r, regex: toRegExp(r.pattern) }));

  return {
    isAllowed(pathWithQuery: string) {
      let best: { allow: boolean; length: number } | undefined;
      for (const rule of rules) {
        if (!rule.regex.test(pathWithQuery)) continue;
        const length = rule.pattern.length;
        if (!best || length > best.length || (length === best.length && rule.allow)) {
          best = { allow: rule.allow, length };
        }
      }
      return best?.allow ?? true;
    },
  };
}

export const allowAll: RobotsRules = { isAllowed: () => true };

/** Per-origin cache of parsed robots.txt files (6 hours). */
export class RobotsCache {
  private readonly cache = new Map<string, { rules: RobotsRules; expires: number }>();

  constructor(
    private readonly load: (origin: string) => Promise<string | null>,
    private readonly userAgent: string,
    private readonly ttlMs = 6 * 3_600_000,
  ) {}

  async isAllowed(rawUrl: string): Promise<boolean> {
    const url = new URL(rawUrl);
    const cached = this.cache.get(url.origin);
    let rules = cached && cached.expires > Date.now() ? cached.rules : undefined;
    if (!rules) {
      let text: string | null = null;
      try {
        text = await this.load(url.origin);
      } catch {
        text = null; // unreachable robots.txt = no restrictions (RFC 9309 §2.3.1.3 for 4xx)
      }
      rules = text ? parseRobots(text, this.userAgent) : allowAll;
      this.cache.set(url.origin, { rules, expires: Date.now() + this.ttlMs });
    }
    return rules.isAllowed(url.pathname + url.search);
  }
}
