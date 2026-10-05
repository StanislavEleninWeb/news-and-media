import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdServerConfig } from '@nm/contracts';

/**
 * Drives lib/ad-server.ts against a fake GPT / Prebid / CMP, the way a browser
 * would: scripts "load" when appended and define their globals.
 */
type Listener = (event: { slot: unknown; isEmpty: boolean }) => void;

function fakeBrowser(options: { cmp?: boolean } = {}) {
  const log: string[] = [];
  const loaded: string[] = [];
  let renderListener: Listener | null = null;
  const slots: Record<string, unknown>[] = [];
  const pubads = {
    setPrivacySettings: (s: unknown) => log.push(`privacy ${JSON.stringify(s)}`),
    disableInitialLoad: () => log.push('disableInitialLoad'),
    enableLazyLoad: () => log.push('lazy'),
    setTargeting: (k: string, v: string) => log.push(`page ${k}=${v}`),
    refresh: (s: unknown[]) => log.push(`refresh ${s.length}`),
    addEventListener: (_: string, fn: Listener) => (renderListener = fn),
  };
  const googletag = {
    cmd: { push: (fn: () => void) => fn() },
    pubads: () => pubads,
    sizeMapping: () => {
      const sizes: unknown[] = [];
      return { addSize: (v: unknown, s: unknown) => sizes.push([v, s]), build: () => sizes };
    },
    defineSlot: (path: string, sizes: unknown, div: string) => {
      const slot: Record<string, unknown> = { path, sizes, div, targeting: {} };
      Object.assign(slot, {
        setTargeting: (k: string, v: string) => (
          ((slot.targeting as Record<string, string>)[k] = v),
          slot
        ),
        defineSizeMapping: (m: unknown) => ((slot.mapping = m), slot),
        addService: () => slot,
      });
      slots.push(slot);
      return slot;
    },
    enableServices: () => log.push('enableServices'),
    display: (div: string) => log.push(`display ${div}`),
    destroySlots: () => (log.push('destroy'), true),
  };
  const pbjs = {
    que: { push: (fn: () => void) => fn() },
    setConfig: (c: unknown) => log.push(`pbjs config ${JSON.stringify(c)}`),
    addAdUnits: (u: unknown[]) => log.push(`pbjs units ${JSON.stringify(u)}`),
    removeAdUnit: () => undefined,
    requestBids: (r: { bidsBackHandler: () => void }) => (
      log.push('pbjs requestBids'),
      r.bidsBackHandler()
    ),
    setTargetingForGPTAsync: () => log.push('pbjs targeting'),
  };
  const win: Record<string, unknown> = { innerWidth: 1200 };
  const document = {
    querySelector: () => null,
    createElement: () => {
      const listeners: Record<string, () => void> = {};
      return {
        dataset: {} as Record<string, string>,
        src: '',
        async: false,
        addEventListener: (event: string, fn: () => void) => (listeners[event] = fn),
        listeners,
      };
    },
    head: {
      appendChild: (script: { src: string; listeners: Record<string, () => void> }) => {
        loaded.push(script.src);
        if (script.src.includes('fundingchoices') && options.cmp) win.__tcfapi = () => undefined;
        if (script.src.includes('gpt.js')) win.googletag = googletag;
        if (script.src.includes('prebid')) Object.assign(win.pbjs as object, pbjs);
        script.listeners.load?.();
      },
    },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', document);
  return {
    log,
    loaded,
    slots,
    emitRender: (e: { slot: unknown; isEmpty: boolean }) => renderListener?.(e),
  };
}

const gamConfig = (extra: Partial<AdServerConfig> = {}): AdServerConfig => ({
  provider: 'gam',
  gam: { networkCode: '21812345678', adUnitPrefix: 'news', cmpScriptUrl: null },
  prebid: null,
  ...extra,
});

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('Ad Manager in the browser', () => {
  it('without a CMP: limited ads from the limited-ads host, slot defined and fetched', async () => {
    const browser = fakeBrowser();
    const { displayGamSlot } = await import('@/lib/ad-server');
    const onEmpty = vi.fn();
    await displayGamSlot({
      config: gamConfig(),
      divId: 'gpt-article_inline-1',
      placement: 'article_inline',
      locale: 'bg',
      targeting: { topic: 'sport' },
      onEmpty,
    });
    expect(browser.loaded).toEqual(['https://pagead2.googlesyndication.com/tag/js/gpt.js']);
    expect(browser.log).toEqual(
      expect.arrayContaining([
        'privacy {"limitedAds":true}',
        'disableInitialLoad',
        'page locale=bg',
        'enableServices',
        'display gpt-article_inline-1',
        'refresh 1',
      ]),
    );
    const slot = browser.slots[0]!;
    expect(slot.path).toBe('/21812345678/news/article_inline');
    expect(slot.targeting).toEqual({ placement: 'article_inline', topic: 'sport' });
    expect(slot.sizes).toEqual([
      [728, 90],
      [320, 100],
      [320, 50],
    ]);
    browser.emitRender({ slot, isEmpty: false });
    expect(onEmpty).not.toHaveBeenCalled();
    browser.emitRender({ slot, isEmpty: true });
    expect(onEmpty).toHaveBeenCalledOnce();
  });

  it('with the Google CMP: full GPT (TCF decides) and Prebid header bidding before the fetch', async () => {
    const browser = fakeBrowser({ cmp: true });
    const { displayGamSlot } = await import('@/lib/ad-server');
    await displayGamSlot({
      config: gamConfig({
        gam: {
          networkCode: '21812345678',
          adUnitPrefix: 'news',
          cmpScriptUrl: 'https://fundingchoicesmessages.google.com/i/pub-1?ers=1',
        },
        prebid: {
          scriptUrl: '/media/ads/prebid.js',
          timeoutMs: 1000,
          bidders: { home_top: [{ bidder: 'appnexus', params: { placementId: 1 } }] },
        },
      }),
      divId: 'gpt-home_top-1',
      placement: 'home_top',
      locale: 'en',
      onEmpty: () => undefined,
    });
    expect(browser.loaded).toEqual([
      'https://fundingchoicesmessages.google.com/i/pub-1?ers=1',
      'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
      '/media/ads/prebid.js',
    ]);
    expect(browser.log.some((l) => l.startsWith('privacy'))).toBe(false);
    const order = ['pbjs requestBids', 'pbjs targeting', 'refresh 1'].map((step) =>
      browser.log.indexOf(step),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(browser.log.find((l) => l.startsWith('pbjs units'))).toContain('[[970,90],[728,90]]');
    expect(browser.log.find((l) => l.startsWith('pbjs config'))).toContain('"cmpApi":"iab"');
  });
});
