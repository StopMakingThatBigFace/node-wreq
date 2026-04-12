import type { HttpMethod } from '../types';

export function normalizeMethod(method?: string): HttpMethod {
  const normalized = (method ?? 'GET').toUpperCase();

  switch (normalized) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'DELETE':
    case 'PATCH':
    case 'HEAD':
      return normalized;
    default:
      throw new Error(`Unsupported HTTP method: ${method}`);
  }
}
