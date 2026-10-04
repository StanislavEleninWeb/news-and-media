/**
 * Minimal Typesense REST client (only what we use). Talking to the HTTP API
 * directly keeps the dependency surface small and the behaviour explicit.
 */
export interface TypesenseField {
  name: string;
  type: 'string' | 'string[]' | 'int64' | 'bool' | 'string*';
  facet?: boolean;
  optional?: boolean;
  index?: boolean;
  sort?: boolean;
}

export interface CollectionSchema {
  name: string;
  fields: TypesenseField[];
  default_sorting_field?: string;
}

export interface TypesenseSearchParams {
  q: string;
  query_by: string;
  query_by_weights?: string;
  filter_by?: string;
  sort_by?: string;
  facet_by?: string;
  page?: number;
  per_page?: number;
  highlight_fields?: string;
  num_typos?: string | number;
}

export interface TypesenseSearchResponse<T> {
  found: number;
  page: number;
  hits: { document: T; highlight?: Record<string, { snippet?: string }> }[];
  facet_counts?: { field_name: string; counts: { value: string; count: number }[] }[];
}

export class TypesenseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TypesenseError';
  }
}

export class TypesenseClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async request(
    method: string,
    path: string,
    body?: string,
    contentType = 'application/json',
  ) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'X-TYPESENSE-API-KEY': this.apiKey,
        ...(body ? { 'Content-Type': contentType } : {}),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok)
      throw new TypesenseError(
        `Typesense ${method} ${path}: ${response.status} ${text.slice(0, 300)}`,
        response.status,
      );
    return text;
  }

  async health(): Promise<boolean> {
    try {
      return JSON.parse(await this.request('GET', '/health')).ok === true;
    } catch {
      return false;
    }
  }

  async collectionExists(name: string): Promise<boolean> {
    try {
      await this.request('GET', `/collections/${encodeURIComponent(name)}`);
      return true;
    } catch (error) {
      if (error instanceof TypesenseError && error.status === 404) return false;
      throw error;
    }
  }

  async createCollection(schema: CollectionSchema): Promise<void> {
    await this.request('POST', '/collections', JSON.stringify(schema));
  }

  async dropCollection(name: string): Promise<void> {
    try {
      await this.request('DELETE', `/collections/${encodeURIComponent(name)}`);
    } catch (error) {
      if (!(error instanceof TypesenseError && error.status === 404)) throw error;
    }
  }

  /** Bulk upsert (JSONL import). Throws if any document is rejected. */
  async upsert(collection: string, documents: object[]): Promise<void> {
    if (documents.length === 0) return;
    const jsonl = documents.map((d) => JSON.stringify(d)).join('\n');
    const text = await this.request(
      'POST',
      `/collections/${encodeURIComponent(collection)}/documents/import?action=upsert`,
      jsonl,
      'text/plain',
    );
    const failures = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { success: boolean; error?: string })
      .filter((r) => !r.success);
    if (failures.length)
      throw new Error(`Typesense rejected ${failures.length} document(s): ${failures[0]?.error}`);
  }

  async deleteByFilter(collection: string, filter: string): Promise<void> {
    await this.request(
      'DELETE',
      `/collections/${encodeURIComponent(collection)}/documents?filter_by=${encodeURIComponent(filter)}`,
    );
  }

  async search<T>(
    collection: string,
    params: TypesenseSearchParams,
  ): Promise<TypesenseSearchResponse<T>> {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    return JSON.parse(
      await this.request(
        'GET',
        `/collections/${encodeURIComponent(collection)}/documents/search?${query}`,
      ),
    ) as TypesenseSearchResponse<T>;
  }
}
