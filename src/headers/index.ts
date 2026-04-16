import type { HeaderTuple, HeadersInit } from '../types';

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

/** Minimal `Headers` implementation used by the public API. */
export class Headers implements Iterable<HeaderTuple> {
  private readonly store = new Map<string, HeaderEntry>();
  private entriesList: HeaderTuple[] = [];

  constructor(init?: HeadersInit) {
    if (!init) {
      return;
    }

    if (init instanceof Headers) {
      for (const [name, value] of init.toTuples()) {
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

  /** Appends a header value without removing existing values for the same name. */
  append(name: string, value: unknown): void {
    const normalized = this.normalizeName(name);
    const entry = this.store.get(normalized.key);
    const stringValue = String(value);

    this.entriesList.push([normalized.display, stringValue]);

    if (entry) {
      entry.values.push(stringValue);

      return;
    }

    this.store.set(normalized.key, {
      name: normalized.display,
      values: [stringValue],
    });
  }

  /** Replaces all existing values for a header name. */
  set(name: string, value: unknown): void {
    const normalized = this.normalizeName(name);
    const stringValue = String(value);

    this.entriesList = this.entriesList.filter(
      ([entryName]) => entryName.trim().toLowerCase() !== normalized.key
    );

    this.store.set(normalized.key, {
      name: normalized.display,
      values: [stringValue],
    });

    this.entriesList.push([normalized.display, stringValue]);
  }

  /** Returns the combined header value for `name`, or `null` when absent. */
  get(name: string): string | null {
    const normalized = this.normalizeName(name);
    const entry = this.store.get(normalized.key);

    return entry ? entry.values.join(', ') : null;
  }

  /** Returns `true` when the header collection contains `name`. */
  has(name: string): boolean {
    const normalized = this.normalizeName(name);

    return this.store.has(normalized.key);
  }

  /** Removes all values associated with `name`. */
  delete(name: string): void {
    const normalized = this.normalizeName(name);

    this.store.delete(normalized.key);
    this.entriesList = this.entriesList.filter(
      ([entryName]) => entryName.trim().toLowerCase() !== normalized.key
    );
  }

  /** Converts the header collection into a plain object. */
  toObject(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [name, value] of this) {
      result[name] = value;
    }

    return result;
  }

  /** Returns headers as ordered `[name, value]` tuples. */
  toTuples(): HeaderTuple[] {
    return this.entriesList.map(([name, value]) => [name, value]);
  }

  /** Returns unique header names preserving their original casing. */
  toOriginalNames(): string[] {
    const names: string[] = [];
    const seen = new Set<string>();

    for (const [name] of this.entriesList) {
      const normalized = name.trim().toLowerCase();

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      names.push(name);
    }

    return names;
  }

  /** Iterates over normalized `[name, value]` header entries. */
  *entries(): IterableIterator<HeaderTuple> {
    for (const entry of this.store.values()) {
      yield [entry.name, entry.values.join(', ')];
    }
  }

  /** Iterates over normalized `[name, value]` header entries. */
  [Symbol.iterator](): IterableIterator<HeaderTuple> {
    return this.entries();
  }
}
