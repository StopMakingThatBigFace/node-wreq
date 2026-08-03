import type { HttpMethod } from '../types';

const METHOD_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);

export function normalizeMethod(method?: string): HttpMethod {
  const value = String(method === undefined ? 'GET' : method);

  if (!METHOD_PATTERN.test(value)) {
    throw new TypeError(`Invalid HTTP method: ${value}`);
  }

  const upper = value.toUpperCase();

  if (FORBIDDEN_METHODS.has(upper)) {
    throw new TypeError(`Forbidden HTTP method: ${value}`);
  }

  return NORMALIZED_METHODS.has(upper) ? upper : value;
}
