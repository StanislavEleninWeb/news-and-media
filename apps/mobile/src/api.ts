/**
 * Typed client for /api/v1. Pure TypeScript (no React Native imports) so it
 * is unit-tested with Vitest; every response is validated with the same zod
 * contracts the server's route tests use.
 */
import { z } from 'zod';
import {
  articleDetailSchema,
  authTokenResponseSchema,
  feedResponseSchema,
  meResponseSchema,
  reactionSummarySchema,
  savedResponseSchema,
  searchResponseSchema,
  topicsResponseSchema,
  type DeviceTokenInput,
  type Reaction,
} from '@nm/contracts';

export type Locale = 'bg' | 'en';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export interface ApiOptions {
  baseUrl: string;
  /** Current session token (null when signed out). */
  getToken: () => string | null;
  /** Stable anonymous id of this install, for reactions without an account. */
  anonId: () => string | null;
  /** Internal builds only: passes the staging basic-auth gate. */
  stagingKey?: string;
  fetchImpl?: typeof fetch;
}

export function createApi(options: ApiOptions) {
  const base = options.baseUrl.replace(/\/$/, '');
  const doFetch = options.fetchImpl ?? fetch;

  async function call<T>(
    path: string,
    init: { method?: string; body?: unknown; schema?: z.ZodType<T> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = options.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const anon = options.anonId();
    if (anon) headers['X-NM-Anon-Id'] = anon;
    if (options.stagingKey) headers['X-Staging-Key'] = options.stagingKey;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await doFetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Never use the platform cookie jar: the app authenticates with a bearer token only.
      credentials: 'omit',
    });
    if (!response.ok) {
      let code = 'http_error';
      try {
        code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? code;
      } catch {
        // not JSON
      }
      throw new ApiError(response.status, code);
    }
    if (response.status === 204 || !init.schema) return undefined as T;
    return init.schema.parse(await response.json());
  }

  const q = (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== '') search.set(key, String(value));
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  return {
    /** Absolute URL for site-relative media paths ("/media/…"). */
    absolute: (url: string | null) => (url && url.startsWith('/') ? `${base}${url}` : url),
    /** Headers images need (staging gate). */
    imageHeaders: options.stagingKey ? { 'X-Staging-Key': options.stagingKey } : undefined,

    feed: (p: { locale: Locale; topic?: string; page?: number }) =>
      call(`/api/v1/feed${q(p)}`, { schema: feedResponseSchema }),
    article: (id: string, locale: Locale) =>
      call(`/api/v1/articles/${encodeURIComponent(id)}${q({ locale })}`, {
        schema: articleDetailSchema,
      }),
    topics: (locale: Locale) =>
      call(`/api/v1/topics${q({ locale })}`, { schema: topicsResponseSchema }),
    search: (p: { q: string; locale: Locale; topic?: string; page?: number }) =>
      call(`/api/v1/search${q(p)}`, { schema: searchResponseSchema }),
    recordView: (id: string) =>
      call(`/api/v1/articles/${encodeURIComponent(id)}/view`, { method: 'POST' }),

    reactions: (id: string) =>
      call(`/api/v1/articles/${encodeURIComponent(id)}/reaction`, {
        schema: reactionSummarySchema,
      }),
    react: (id: string, reaction: Reaction) =>
      call(`/api/v1/articles/${encodeURIComponent(id)}/reaction`, {
        method: 'PUT',
        body: { reaction },
        schema: reactionSummarySchema,
      }),
    unreact: (id: string) =>
      call(`/api/v1/articles/${encodeURIComponent(id)}/reaction`, {
        method: 'DELETE',
        schema: reactionSummarySchema,
      }),

    signIn: (email: string, password: string) =>
      call('/api/v1/auth/token', {
        method: 'POST',
        body: { email, password },
        schema: authTokenResponseSchema,
      }),
    signOut: () => call('/api/v1/auth/logout', { method: 'POST' }),
    me: () => call('/api/v1/me', { schema: meResponseSchema }),

    saved: (locale: Locale) =>
      call(`/api/v1/me/saved${q({ locale })}`, { schema: savedResponseSchema }),
    save: (id: string) => call(`/api/v1/me/saved/${encodeURIComponent(id)}`, { method: 'PUT' }),
    unsave: (id: string) =>
      call(`/api/v1/me/saved/${encodeURIComponent(id)}`, { method: 'DELETE' }),

    registerDevice: (input: DeviceTokenInput) =>
      call('/api/v1/push/devices', { method: 'POST', body: input }),
    unregisterDevice: (token: string) =>
      call('/api/v1/push/devices', { method: 'DELETE', body: { token } }),
  };
}

export type Api = ReturnType<typeof createApi>;
