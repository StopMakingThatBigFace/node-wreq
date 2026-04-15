import type { HttpMethod } from '../types';

export function normalizeMethod(method?: string): HttpMethod {
  const normalized = (method ?? 'GET').toUpperCase();

  if (normalized.length === 0) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }

  return normalized;
}
