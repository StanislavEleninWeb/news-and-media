import type { AppConfig } from '@nm/core/config';

export interface CompletionRequest {
  /** Stable instructions shared by every call of a kind — marked cacheable for the provider. */
  system: string;
  user: string;
  /** Earlier turns of a conversation, oldest first (sent before `user`). */
  history?: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  temperature?: number;
  /** Request-time calls (reader chat) fail fast instead of retrying for minutes. */
  timeoutMs?: number;
  retries?: number;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: CompletionUsage;
  provider: string;
  model: string;
  /** Prices for this provider, USD per million tokens. */
  prices: { input: number; output: number; cacheRead: number };
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POSTs JSON with retries for rate limits, overload and transient server errors. */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: { timeoutMs: number; retries: number; baseDelayMs: number },
): Promise<unknown> {
  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    if (attempt > 0) await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      lastError = new ProviderError(`Network error: ${(error as Error).message}`, undefined, true);
      continue;
    }
    if (response.ok) return response.json();
    const text = (await response.text()).slice(0, 500);
    const retryable = response.status === 429 || response.status === 529 || response.status >= 500;
    lastError = new ProviderError(`HTTP ${response.status}: ${text}`, response.status, retryable);
    if (!retryable) throw lastError;
    const retryAfter = Number(response.headers.get('retry-after'));
    if (retryAfter > 0 && retryAfter < 60) await sleep(retryAfter * 1000);
  }
  throw lastError ?? new ProviderError('Request failed', undefined, true);
}

interface ProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  prices: CompletionResult['prices'];
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
}

/** Anthropic Messages API (Claude). The system prompt is sent with prompt caching enabled. */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(private readonly options: ProviderOptions) {}

  get model() {
    return this.options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const data = (await postJson(
      `${this.options.baseUrl.replace(/\/$/, '')}/v1/messages`,
      { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.options.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.4,
        // Caching only takes effect once the shared prefix exceeds the model's minimum length.
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [...(request.history ?? []), { role: 'user', content: request.user }],
      },
      {
        timeoutMs: request.timeoutMs ?? this.options.timeoutMs ?? 120_000,
        retries: request.retries ?? this.options.retries ?? 3,
        baseDelayMs: this.options.retryBaseDelayMs ?? 2_000,
      },
    )) as {
      content?: { type: string; text?: string }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      stop_reason?: string;
    };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (data.stop_reason === 'max_tokens') {
      throw new ProviderError('Response truncated (max_tokens)', undefined, false);
    }
    return {
      text,
      usage: {
        inputTokens:
          (data.usage?.input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
      },
      provider: this.name,
      model: this.options.model,
      prices: this.options.prices,
    };
  }
}

/** Any OpenAI-compatible chat completions API (DeepSeek, Groq, Together, OpenAI, ...). */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai';
  constructor(private readonly options: ProviderOptions) {}

  get model() {
    return this.options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const data = (await postJson(
      `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
      { authorization: `Bearer ${this.options.apiKey}` },
      {
        model: this.options.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.4,
        messages: [
          { role: 'system', content: request.system },
          ...(request.history ?? []),
          { role: 'user', content: request.user },
        ],
      },
      {
        timeoutMs: request.timeoutMs ?? this.options.timeoutMs ?? 120_000,
        retries: request.retries ?? this.options.retries ?? 3,
        baseDelayMs: this.options.retryBaseDelayMs ?? 2_000,
      },
    )) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new ProviderError('Response truncated (length)', undefined, false);
    }
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: choice?.message?.content ?? '',
      usage: {
        inputTokens: (data.usage?.prompt_tokens ?? 0) - cached,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
      },
      provider: this.name,
      model: this.options.model,
      prices: this.options.prices,
    };
  }
}

/** Tries the primary provider, then the fallback when the primary is unavailable. */
export class FallbackProvider implements LlmProvider {
  constructor(
    private readonly primary: LlmProvider,
    private readonly fallback: LlmProvider,
    private readonly onFallback?: (error: unknown) => void,
  ) {}

  get name() {
    return this.primary.name;
  }
  get model() {
    return this.primary.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      return await this.primary.complete(request);
    } catch (error) {
      const unavailable =
        error instanceof ProviderError &&
        (error.retryable || error.status === 401 || error.status === 403);
      if (!unavailable) throw error;
      this.onFallback?.(error);
      return this.fallback.complete(request);
    }
  }
}

const HAIKU_PRICES = { input: 1, output: 5, cacheRead: 0.1 };

function buildProvider(
  kind: 'anthropic' | 'openai',
  config: AppConfig,
  isPrimary: boolean,
): LlmProvider {
  // LLM_*_PRICE_PER_MTOK describe the primary model; a fallback uses its own prices.
  const primaryPrices = {
    input: config.LLM_INPUT_PRICE_PER_MTOK,
    output: config.LLM_OUTPUT_PRICE_PER_MTOK,
    cacheRead: config.LLM_CACHE_READ_PRICE_PER_MTOK,
  };
  if (kind === 'anthropic') {
    if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    return new AnthropicProvider({
      apiKey: config.ANTHROPIC_API_KEY,
      baseUrl: config.ANTHROPIC_BASE_URL,
      model: isPrimary ? config.LLM_MODEL : 'claude-haiku-4-5-20251001',
      prices: isPrimary ? primaryPrices : HAIKU_PRICES,
    });
  }
  if (!config.OPENAI_COMPAT_BASE_URL || !config.OPENAI_COMPAT_API_KEY) {
    throw new Error('OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_API_KEY must be set');
  }
  const model = config.OPENAI_COMPAT_MODEL ?? (isPrimary ? config.LLM_MODEL : undefined);
  if (!model) throw new Error('OPENAI_COMPAT_MODEL must be set for the fallback provider');
  return new OpenAiCompatibleProvider({
    apiKey: config.OPENAI_COMPAT_API_KEY,
    baseUrl: config.OPENAI_COMPAT_BASE_URL,
    model,
    prices: isPrimary
      ? primaryPrices
      : {
          input: config.OPENAI_COMPAT_INPUT_PRICE_PER_MTOK,
          output: config.OPENAI_COMPAT_OUTPUT_PRICE_PER_MTOK,
          cacheRead: config.OPENAI_COMPAT_INPUT_PRICE_PER_MTOK / 10,
        },
  });
}

/**
 * Provider from configuration. Switching provider or model is an environment
 * change only (LLM_PROVIDER, LLM_MODEL, LLM_FALLBACK_PROVIDER) — no code change.
 */
export function createProvider(
  config: AppConfig,
  onFallback?: (error: unknown) => void,
): LlmProvider {
  const primary = buildProvider(config.LLM_PROVIDER, config, true);
  if (!config.LLM_FALLBACK_PROVIDER || config.LLM_FALLBACK_PROVIDER === config.LLM_PROVIDER)
    return primary;
  return new FallbackProvider(
    primary,
    buildProvider(config.LLM_FALLBACK_PROVIDER, config, false),
    onFallback,
  );
}

/**
 * Provider for the reader-facing "ask this article" chat. Deliberately uses its
 * own key (CHAT_ANTHROPIC_API_KEY / CHAT_OPENAI_COMPAT_API_KEY) and never falls
 * back to the pipeline key, so chat spend is metered and capped on its own.
 * Returns null when chat is not configured.
 */
export function createChatProvider(config: AppConfig): LlmProvider | null {
  const prices = {
    input: config.CHAT_INPUT_PRICE_PER_MTOK,
    output: config.CHAT_OUTPUT_PRICE_PER_MTOK,
    cacheRead: config.CHAT_INPUT_PRICE_PER_MTOK / 10,
  };
  if (config.CHAT_LLM_PROVIDER === 'anthropic') {
    if (!config.CHAT_ANTHROPIC_API_KEY) return null;
    return new AnthropicProvider({
      apiKey: config.CHAT_ANTHROPIC_API_KEY,
      baseUrl: config.ANTHROPIC_BASE_URL,
      model: config.CHAT_LLM_MODEL,
      prices,
    });
  }
  if (!config.CHAT_OPENAI_COMPAT_API_KEY || !config.OPENAI_COMPAT_BASE_URL) return null;
  return new OpenAiCompatibleProvider({
    apiKey: config.CHAT_OPENAI_COMPAT_API_KEY,
    baseUrl: config.OPENAI_COMPAT_BASE_URL,
    model: config.CHAT_LLM_MODEL,
    prices,
  });
}
