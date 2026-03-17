import { Headers } from './headers';
import { fetch } from './fetch';
import { mergeHooks } from './hooks';
import type {
  Client,
  ClientDefaults,
  HeaderTuple,
  HeadersInit,
  RequestInput,
  WreqInit,
} from './types';

function mergeHeaders(...sources: Array<HeadersInit | undefined>): HeaderTuple[] | undefined {
  const merged = new Headers();

  for (const source of sources) {
    if (!source) {
      continue;
    }

    const headers = source instanceof Headers ? source : new Headers(source);
    for (const [name, value] of headers) {
      merged.set(name, value);
    }
  }

  const tuples = merged.toTuples();
  return tuples.length > 0 ? tuples : undefined;
}

function mergeDefaults(base: ClientDefaults, override?: ClientDefaults): ClientDefaults {
  if (!override) {
    return { ...base };
  }

  return {
    ...base,
    ...override,
    headers: mergeHeaders(base.headers, override.headers),
    hooks: mergeHooks(base.hooks, override.hooks),
  };
}

class WreqClient implements Client {
  readonly defaults: ClientDefaults;

  constructor(defaults: ClientDefaults = {}) {
    this.defaults = {
      ...defaults,
      headers: defaults.headers ? mergeHeaders(defaults.headers) : undefined,
    };
  }

  async fetch(input: RequestInput, init?: WreqInit) {
    const merged: WreqInit = {
      ...this.defaults,
      ...init,
      headers: mergeHeaders(this.defaults.headers, init?.headers),
      hooks: mergeHooks(this.defaults.hooks, init?.hooks),
    };
    return fetch(input, merged);
  }

  async get(input: RequestInput, init?: Omit<WreqInit, 'method'>) {
    return this.fetch(input, { ...init, method: 'GET' });
  }

  async post(
    input: RequestInput,
    body?: WreqInit['body'],
    init?: Omit<WreqInit, 'method' | 'body'>,
  ) {
    return this.fetch(input, { ...init, method: 'POST', body });
  }

  extend(defaults: ClientDefaults): Client {
    return new WreqClient(mergeDefaults(this.defaults, defaults));
  }
}

export function createClient(defaults: ClientDefaults = {}): Client {
  return new WreqClient(defaults);
}
