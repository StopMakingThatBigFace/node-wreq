import type { HeaderTuple, HeadersInit } from './types';

type HeaderEntry = {
  name: string;
  values: string[];
};

function isIterable<T>(value: unknown): value is Iterable<T> {
  return Boolean(value) && typeof (value as Iterable<T>)[Symbol.iterator] === 'function';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

export class Headers implements Iterable<HeaderTuple> {
  private readonly store = new Map<string, HeaderEntry>();

  constructor(init?: HeadersInit) {
    if (!init) {
      return;
    }

    if (init instanceof Headers) {
      for (const [name, value] of init) {
        this.append(name, value);
      }

      return;
    }

    if (Array.isArray(init) || isIterable<HeaderTuple>(init)) {
      for (const [name, value] of init as Iterable<HeaderTuple>) {
        this.append(name, value);
      }

      return;
    }

    if (isPlainObject(init)) {
      for (const [name, value] of Object.entries(init)) {
        if (value === undefined || value === null) {
          continue;
        }

        this.set(name, String(value));
      }
    }
  }

  private normalizeName(name: string): { key: string; display: string } {
    if (typeof name !== 'string') {
      throw new TypeError('Header name must be a string');
    }

    const trimmed = name.trim();

    if (!trimmed) {
      throw new TypeError('Header name must not be empty');
    }

    return { key: trimmed.toLowerCase(), display: trimmed };
  }

  append(name: string, value: unknown): void {
    const normalized = this.normalizeName(name);
    const entry = this.store.get(normalized.key);
    const stringValue = String(value);

    if (entry) {
      entry.values.push(stringValue);

      return;
    }

    this.store.set(normalized.key, {
      name: normalized.display,
      values: [stringValue],
    });
  }

  set(name: string, value: unknown): void {
    const normalized = this.normalizeName(name);

    this.store.set(normalized.key, {
      name: normalized.display,
      values: [String(value)],
    });
  }

  get(name: string): string | null {
    const normalized = this.normalizeName(name);
    const entry = this.store.get(normalized.key);

    return entry ? entry.values.join(', ') : null;
  }

  has(name: string): boolean {
    const normalized = this.normalizeName(name);

    return this.store.has(normalized.key);
  }

  delete(name: string): void {
    const normalized = this.normalizeName(name);

    this.store.delete(normalized.key);
  }

  toObject(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [name, value] of this) {
      result[name] = value;
    }

    return result;
  }

  toTuples(): HeaderTuple[] {
    return [...this];
  }

  *entries(): IterableIterator<HeaderTuple> {
    for (const entry of this.store.values()) {
      yield [entry.name, entry.values.join(', ')];
    }
  }

  [Symbol.iterator](): IterableIterator<HeaderTuple> {
    return this.entries();
  }
}
