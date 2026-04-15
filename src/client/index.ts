import { Headers } from '../headers';
import { mergeHooks } from '../hooks';
import { fetch } from '../http/fetch';
import type {
  Client,
  ClientDefaults,
  HeaderTuple,
  HeadersInit,
  RetryOptions,
  RequestInput,
  WebSocketInit,
  WreqInit,
} from '../types';
import { websocket } from '../websocket';

function mergeHeaders(...sources: Array<HeadersInit | undefined>): HeaderTuple[] | undefined {
  const merged = new Headers();

  for (const source of sources) {
    if (!source) {
      continue;
    }

    const headers = source instanceof Headers ? source : new Headers(source);

    for (const [name, value] of headers.toTuples()) {
      merged.set(name, value);
    }
  }

  const tuples = merged.toTuples();

  return tuples.length > 0 ? tuples : undefined;
}

function mergeQuery(
  ...sources: Array<WreqInit['query'] | ClientDefaults['query'] | undefined>
): WreqInit['query'] | undefined {
  const merged: NonNullable<WreqInit['query']> = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    Object.assign(merged, source);
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeContext(
  base?: Record<string, unknown>,
  override?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...base,
    ...override,
  };
}

function normalizeRetryInput(retry?: number | RetryOptions): RetryOptions | undefined {
  if (retry === undefined) {
    return undefined;
  }

  if (typeof retry === 'number') {
    return { limit: retry };
  }

  return { ...retry };
}

function mergeRetry(
  base?: number | RetryOptions,
  override?: number | RetryOptions
): RetryOptions | undefined {
  const normalizedBase = normalizeRetryInput(base);
  const normalizedOverride = normalizeRetryInput(override);

  if (!normalizedBase && !normalizedOverride) {
    return undefined;
  }

  return {
    ...normalizedBase,
    ...normalizedOverride,
    methods: normalizedOverride?.methods ?? normalizedBase?.methods,
    statusCodes: normalizedOverride?.statusCodes ?? normalizedBase?.statusCodes,
    errorCodes: normalizedOverride?.errorCodes ?? normalizedBase?.errorCodes,
    backoff: normalizedOverride?.backoff ?? normalizedBase?.backoff,
    shouldRetry: normalizedOverride?.shouldRetry ?? normalizedBase?.shouldRetry,
  };
}

function mergeDefaults(base: ClientDefaults, override?: ClientDefaults): ClientDefaults {
  if (!override) {
    return { ...base };
  }

  return {
    ...base,
    ...override,
    headers: mergeHeaders(base.headers, override.headers),
    query: mergeQuery(base.query, override.query),
    context: mergeContext(base.context, override.context),
    hooks: mergeHooks(base.hooks, override.hooks),
    retry: mergeRetry(base.retry, override.retry),
  };
}

class WreqClient implements Client {
  readonly defaults: ClientDefaults;

  constructor(defaults: ClientDefaults = {}) {
    this.defaults = {
      ...defaults,
      headers: defaults.headers ? mergeHeaders(defaults.headers) : undefined,
      query: mergeQuery(defaults.query),
      context: mergeContext(defaults.context),
      retry: mergeRetry(defaults.retry),
    };
  }

  async fetch(input: RequestInput, init?: WreqInit) {
    const merged: WreqInit = {
      ...this.defaults,
      ...init,
      headers: mergeHeaders(this.defaults.headers, init?.headers),
      query: mergeQuery(this.defaults.query, init?.query),
      context: mergeContext(this.defaults.context, init?.context),
      hooks: mergeHooks(this.defaults.hooks, init?.hooks),
      retry: mergeRetry(this.defaults.retry, init?.retry),
    };

    return fetch(input, merged);
  }

  async websocket(input: string | URL, init?: WebSocketInit) {
    const merged: WebSocketInit = {
      ...this.defaults,
      ...init,
      headers: mergeHeaders(this.defaults.headers, init?.headers),
      query: mergeQuery(this.defaults.query, init?.query),
    };

    return websocket(input, merged);
  }

  async get(input: RequestInput, init?: Omit<WreqInit, 'method'>) {
    return this.fetch(input, { ...init, method: 'GET' });
  }

  async post(
    input: RequestInput,
    body?: WreqInit['body'],
    init?: Omit<WreqInit, 'method' | 'body'>
  ) {
    return this.fetch(input, { ...init, method: 'POST', body });
  }

  async put(
    input: RequestInput,
    body?: WreqInit['body'],
    init?: Omit<WreqInit, 'method' | 'body'>
  ) {
    return this.fetch(input, { ...init, method: 'PUT', body });
  }

  async patch(
    input: RequestInput,
    body?: WreqInit['body'],
    init?: Omit<WreqInit, 'method' | 'body'>
  ) {
    return this.fetch(input, { ...init, method: 'PATCH', body });
  }

  async delete(input: RequestInput, init?: Omit<WreqInit, 'method'>) {
    return this.fetch(input, { ...init, method: 'DELETE' });
  }

  async head(input: RequestInput, init?: Omit<WreqInit, 'method'>) {
    return this.fetch(input, { ...init, method: 'HEAD' });
  }

  async options(input: RequestInput, init?: Omit<WreqInit, 'method'>) {
    return this.fetch(input, { ...init, method: 'OPTIONS' });
  }

  extend(defaults: ClientDefaults): Client {
    return new WreqClient(mergeDefaults(this.defaults, defaults));
  }
}

export function createClient(defaults: ClientDefaults = {}): Client {
  return new WreqClient(defaults);
}
