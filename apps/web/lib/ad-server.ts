'use client';

/**
 * Google Ad Manager in the browser: GPT (+ optional Prebid header bidding).
 *
 * Consent (EEA): with the Google-certified CMP configured, GPT and Prebid read
 * the TCF string themselves and Google serves personalised or non-personalised
 * demand accordingly. Without a CMP, GPT runs in "limited ads" mode — no ad
 * cookies or identifiers, no personalisation, no frequency capping — and
 * Prebid is not loaded at all.
 */
import {
  adServerConfigSchema,
  adSizeMapping,
  gamAdUnitPath,
  type AdServerConfig,
} from '@nm/contracts';

type Size = [number, number];

// Minimal typings for the parts of GPT and Prebid used here.
interface GptSlot {
  setTargeting(key: string, value: string | string[]): GptSlot;
  defineSizeMapping(mapping: unknown): GptSlot;
  addService(service: unknown): GptSlot;
}
interface SlotRenderEndedEvent {
  slot: GptSlot;
  isEmpty: boolean;
}
interface PubAdsService {
  setPrivacySettings(settings: { limitedAds?: boolean; nonPersonalizedAds?: boolean }): void;
  disableInitialLoad(): void;
  enableLazyLoad(config?: {
    fetchMarginPercent: number;
    renderMarginPercent: number;
    mobileScaling: number;
  }): void;
  setTargeting(key: string, value: string | string[]): void;
  refresh(slots: GptSlot[]): void;
  addEventListener(event: 'slotRenderEnded', listener: (e: SlotRenderEndedEvent) => void): void;
}
interface Googletag {
  cmd: { push(fn: () => void): void };
  pubads(): PubAdsService;
  sizeMapping(): { addSize(viewport: Size, sizes: Size[]): unknown; build(): unknown };
  defineSlot(path: string, sizes: Size[], divId: string): GptSlot | null;
  enableServices(): void;
  display(divId: string): void;
  destroySlots(slots: GptSlot[]): boolean;
}
interface Pbjs {
  que: { push(fn: () => void): void };
  setConfig(config: unknown): void;
  addAdUnits(units: unknown[]): void;
  removeAdUnit(code: string): void;
  requestBids(request: {
    adUnitCodes: string[];
    timeout: number;
    bidsBackHandler: () => void;
  }): void;
  setTargetingForGPTAsync(codes: string[]): void;
}
declare global {
  interface Window {
    googletag?: Googletag;
    pbjs?: Pbjs;
    __tcfapi?: unknown;
  }
}

let configPromise: Promise<AdServerConfig> | null = null;

/** The environment's ad server settings (fetched once per page load). */
export function loadAdConfig(): Promise<AdServerConfig> {
  configPromise ??= fetch('/api/v1/ads/config')
    .then((r) => r.json())
    .then((body) => adServerConfigSchema.parse(body))
    .catch(() => ({ provider: 'direct' as const, gam: null, prebid: null }));
  return configPromise;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else existing.addEventListener('load', () => resolve());
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = '1';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error(`failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

let ready: Promise<{ googletag: Googletag; prebid: boolean }> | null = null;
const emptyHandlers = new Map<GptSlot, () => void>();

/** Loads the CMP (if any), GPT and Prebid once, and configures the page. */
function initialise(config: AdServerConfig, locale: string) {
  ready ??= (async () => {
    const gam = config.gam!;
    let tcf = false;
    if (gam.cmpScriptUrl) {
      await loadScript(gam.cmpScriptUrl).catch(() => undefined);
      tcf = typeof window.__tcfapi === 'function';
    }
    // Limited ads must load GPT from the limited-ads host.
    await loadScript(
      tcf
        ? 'https://securepubads.g.doubleclick.net/tag/js/gpt.js'
        : 'https://pagead2.googlesyndication.com/tag/js/gpt.js',
    );
    const googletag = window.googletag!;
    let prebid = false;
    if (tcf && config.prebid) {
      try {
        window.pbjs = window.pbjs ?? ({ que: [] } as unknown as Pbjs);
        await loadScript(config.prebid.scriptUrl);
        window.pbjs!.que.push(() =>
          window.pbjs!.setConfig({
            consentManagement: { gdpr: { cmpApi: 'iab', timeout: 8_000, defaultGdprScope: true } },
            priceGranularity: 'medium',
          }),
        );
        prebid = true;
      } catch {
        prebid = false; // GPT alone still serves direct and AdX demand
      }
    }
    await new Promise<void>((resolve) =>
      googletag.cmd.push(() => {
        const pubads = googletag.pubads();
        if (!tcf) pubads.setPrivacySettings({ limitedAds: true });
        // Slots are fetched explicitly (after header bidding, when enabled).
        pubads.disableInitialLoad();
        pubads.enableLazyLoad({
          fetchMarginPercent: 100,
          renderMarginPercent: 50,
          mobileScaling: 2,
        });
        pubads.setTargeting('locale', locale);
        pubads.addEventListener('slotRenderEnded', (event) => {
          if (event.isEmpty) emptyHandlers.get(event.slot)?.();
        });
        googletag.enableServices();
        resolve();
      }),
    );
    return { googletag, prebid };
  })();
  return ready;
}

/**
 * Shows an Ad Manager slot in `divId`. `onEmpty` runs when nothing filled it
 * (the caller then shows a built-in house ad). Returns a cleanup function.
 */
export async function displayGamSlot(options: {
  config: AdServerConfig;
  divId: string;
  placement: keyof typeof adSizeMapping;
  locale: string;
  targeting?: Record<string, string>;
  onEmpty: () => void;
}): Promise<() => void> {
  const { config, divId, placement } = options;
  const { googletag, prebid } = await initialise(config, options.locale);
  const mappingSpec = adSizeMapping[placement];
  const allSizes = [
    ...new Map(mappingSpec.flatMap(([, sizes]) => sizes).map((s) => [s.join('x'), s])).values(),
  ];
  let slot: GptSlot | null = null;

  googletag.cmd.push(() => {
    const mapping = googletag.sizeMapping();
    for (const [minWidth, sizes] of mappingSpec) mapping.addSize([minWidth, 0], sizes);
    slot = googletag.defineSlot(gamAdUnitPath(config.gam!, placement), allSizes, divId);
    if (!slot) return;
    slot
      .defineSizeMapping(mapping.build())
      .setTargeting('placement', placement)
      .addService(googletag.pubads());
    for (const [key, value] of Object.entries(options.targeting ?? {}))
      slot.setTargeting(key, value);
    emptyHandlers.set(slot, options.onEmpty);
    googletag.display(divId);

    const bidders = config.prebid?.bidders[placement] ?? [];
    if (prebid && bidders.length && window.pbjs) {
      const pbjs = window.pbjs;
      const width = window.innerWidth;
      const sizes = mappingSpec.find(([min]) => width >= min)?.[1] ?? allSizes;
      pbjs.que.push(() => {
        pbjs.addAdUnits([{ code: divId, mediaTypes: { banner: { sizes } }, bids: bidders }]);
        pbjs.requestBids({
          adUnitCodes: [divId],
          timeout: config.prebid!.timeoutMs,
          bidsBackHandler: () => {
            pbjs.setTargetingForGPTAsync([divId]);
            googletag.cmd.push(() => slot && googletag.pubads().refresh([slot]));
          },
        });
      });
    } else {
      googletag.pubads().refresh([slot]);
    }
  });

  return () => {
    googletag.cmd.push(() => {
      if (!slot) return;
      emptyHandlers.delete(slot);
      googletag.destroySlots([slot]);
    });
    window.pbjs?.que.push(() => window.pbjs!.removeAdUnit(divId));
  };
}
