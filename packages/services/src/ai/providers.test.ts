import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '@nm/core/config';
import {
  AnthropicProvider,
  createProvider,
  FallbackProvider,
  OpenAiCompatibleProvider,
  ProviderError,
} from './providers';

interface Captured {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

let base = '';
const captured: Captured[] = [];
let anthropicFailuresLeft = 0;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    captured.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') });
    if (req.url === '/v1/messages') {
      if (anthropicFailuresLeft > 0) {
        anthropicFailuresLeft -= 1;
        res
          .writeHead(529, { 'content-type': 'application/json' })
          .end('{"type":"error","error":{"type":"overloaded_error"}}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          content: [
            { type: 'text', text: '{"ok":' },
            { type: 'text', text: 'true}' },
          ],
          usage: {
            input_tokens: 120,
            output_tokens: 40,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 10,
          },
          stop_reason: 'end_turn',
        }),
      );
      return;
    }
    if (req.url === '/bad/v1/messages') {
      res.writeHead(401).end('{"error":"invalid x-api-key"}');
      return;
    }
    if (req.url === '/oa/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 60 },
          },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const prices = { input: 1, output: 5, cacheRead: 0.1 };
const request = { system: 'You are an editor.', user: 'Rewrite this.', maxTokens: 500 };

describe('AnthropicProvider', () => {
  it('sends a cacheable system prompt and reads usage', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5-20251001',
      baseUrl: base,
      prices,
    });
    const result = await provider.complete(request);
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage).toEqual({ inputTokens: 130, outputTokens: 40, cacheReadTokens: 900 });
    const call = captured.at(-1)!;
    expect(call.headers['x-api-key']).toBe('sk-test');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.body).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: [{ type: 'text', text: 'You are an editor.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Rewrite this.' }],
    });
  });

  it('retries when the API is overloaded', async () => {
    anthropicFailuresLeft = 2;
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: base,
      prices,
      retryBaseDelayMs: 1,
    });
    await expect(provider.complete(request)).resolves.toMatchObject({ text: '{"ok":true}' });
  });

  it('does not retry authentication errors', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: `${base}/bad`,
      prices,
      retryBaseDelayMs: 1,
    });
    const before = captured.length;
    await expect(provider.complete(request)).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
    expect(captured.length - before).toBe(1);
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('uses the chat completions format and separates cached tokens', async () => {
    const provider = new OpenAiCompatibleProvider({
      apiKey: 'k',
      model: 'deepseek-chat',
      baseUrl: `${base}/oa`,
      prices,
    });
    const result = await provider.complete(request);
    expect(result.text).toBe('hello');
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 20, cacheReadTokens: 60 });
    expect(captured.at(-1)!.headers.authorization).toBe('Bearer k');
    expect(captured.at(-1)!.body.messages).toEqual([
      { role: 'system', content: 'You are an editor.' },
      { role: 'user', content: 'Rewrite this.' },
    ]);
  });
});

describe('FallbackProvider', () => {
  it('switches provider when the primary is unavailable', async () => {
    const primary = new AnthropicProvider({
      apiKey: 'k',
      model: 'm',
      baseUrl: `${base}/bad`,
      prices,
      retryBaseDelayMs: 1,
    });
    const secondary = new OpenAiCompatibleProvider({
      apiKey: 'k',
      model: 'x',
      baseUrl: `${base}/oa`,
      prices,
    });
    const fallbacks: unknown[] = [];
    const provider = new FallbackProvider(primary, secondary, (e) => fallbacks.push(e));
    await expect(provider.complete(request)).resolves.toMatchObject({
      provider: 'openai',
      text: 'hello',
    });
    expect(fallbacks[0]).toBeInstanceOf(ProviderError);
  });
});

describe('createProvider', () => {
  it('defaults to Claude Haiku and needs an API key', () => {
    expect(() => createProvider(parseConfig({}))).toThrow(/ANTHROPIC_API_KEY/);
    const provider = createProvider(parseConfig({ ANTHROPIC_API_KEY: 'k' }));
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.model).toBe('claude-haiku-4-5-20251001');
  });
  it('builds a fallback chain from environment variables only', () => {
    const provider = createProvider(
      parseConfig({
        ANTHROPIC_API_KEY: 'k',
        LLM_FALLBACK_PROVIDER: 'openai',
        OPENAI_COMPAT_BASE_URL: 'https://api.deepseek.com',
        OPENAI_COMPAT_API_KEY: 'k2',
        OPENAI_COMPAT_MODEL: 'deepseek-chat',
      }),
    );
    expect(provider).toBeInstanceOf(FallbackProvider);
  });
});
