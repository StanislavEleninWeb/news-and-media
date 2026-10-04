import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Listener = (event: {
  request?: Request;
  data?: unknown;
  respondWith?: (r: Promise<Response>) => void;
  waitUntil: (p: Promise<unknown>) => void;
}) => void;

/** Loads public/sw.js in a sandbox with a fake Cache Storage and network. */
function loadServiceWorker(network: (request: Request) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: Request | string) =>
    typeof r === 'string' ? new URL(r, 'https://news.test').toString() : r.url;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (r: Request | string, response: Response) => void store.set(keyOf(r), response),
      add: async (url: string) =>
        void store.set(keyOf(url), await network(new Request(keyOf(url)))),
      addAll: async (urls: string[]) => {
        for (const url of urls) store.set(keyOf(url), new Response(`cached ${url}`));
      },
      delete: async (r: Request | string) => store.delete(keyOf(r)),
      keys: async () => [...store.keys()].map((k) => new Request(k)),
      match: async (r: Request | string) => store.get(keyOf(r))?.clone(),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: Request | string, options?: { cacheName?: string }) => {
      const names = options?.cacheName ? [options.cacheName] : [...stores.keys()];
      for (const name of names) {
        const hit = stores.get(name)?.get(keyOf(r));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: 'https://news.test' },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  } as Record<string, unknown>;
  runInNewContext(readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8'), {
    self,
    caches,
    fetch: network,
    URL,
    Request,
    Response,
    setTimeout,
    clearTimeout,
  });
  const dispatch = async (type: string, init: Partial<Parameters<Listener>[0]>) => {
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners[type]!({
      ...init,
      respondWith: (r) => (responded = r),
      waitUntil: (p) => void waits.push(p),
    });
    await Promise.all(waits);
    return responded;
  };
  return { self, stores, dispatch };
}

const navigate = (url: string) => {
  const request = new Request(`https://news.test${url}`);
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  return request;
};

describe('service worker', () => {
  it('routes requests to the right strategy', () => {
    const { self } = loadServiceWorker(async () => new Response('ok'));
    const strategy = self.strategyFor as (r: Request) => string;
    expect(strategy(navigate('/bg'))).toBe('page');
    expect(strategy(new Request('https://news.test/_next/static/chunks/a.js'))).toBe('static');
    expect(strategy(new Request('https://news.test/media/img/ab/x-480.webp'))).toBe('media');
    expect(strategy(new Request('https://news.test/api/v1/feed'))).toBe('bypass');
    expect(strategy(new Request('https://news.test/api/v1/feed', { method: 'POST' }))).toBe(
      'bypass',
    );
    expect(strategy(new Request('https://cdn.other.test/x.js'))).toBe('bypass');
  });

  it('serves a saved article offline after the reader saved it', async () => {
    let online = true;
    const network = async (request: Request) => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(`<html>${new URL(request.url).pathname}</html>`, { status: 200 });
    };
    const sw = loadServiceWorker(network);
    await sw.dispatch('install', {});
    await sw.dispatch('message', { data: { type: 'cache-article', url: '/bg/a/1/slug' } });

    online = false;
    const offlineArticle = await sw.dispatch('fetch', { request: navigate('/bg/a/1/slug') });
    expect(await offlineArticle!.text()).toBe('<html>/bg/a/1/slug</html>');

    const unknownPage = await sw.dispatch('fetch', { request: navigate('/bg/t/sport') });
    expect(await unknownPage!.text()).toBe('cached /offline.html');

    await sw.dispatch('message', { data: { type: 'uncache-article', url: '/bg/a/1/slug' } });
    const afterUnsave = await sw.dispatch('fetch', { request: navigate('/bg/a/1/slug') });
    expect(await afterUnsave!.text()).toBe('cached /offline.html');
  });

  it('ignores messages for other origins', async () => {
    const sw = loadServiceWorker(async () => new Response('x'));
    await sw.dispatch('message', { data: { type: 'cache-article', url: 'https://evil.test/' } });
    expect(sw.stores.get('saved-articles')).toBeUndefined();
  });
});
