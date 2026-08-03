import type { HeadersInit, WebSocketInit } from '../types';
import { Buffer } from 'node:buffer';
import { Headers } from '../headers';

const SUBPROTOCOL_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_WEBSOCKET_HEADERS = new Set([
  'connection',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'upgrade',
]);

function appendQuery(url: URL, query: WebSocketInit['query']): void {
  if (!query) {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

export function resolveWebSocketUrl(rawUrl: string | URL, init?: WebSocketInit): string {
  let url: URL;

  try {
    url = init?.baseURL ? new URL(String(rawUrl), init.baseURL) : new URL(String(rawUrl));
  } catch (error) {
    throw new DOMException(
      error instanceof Error ? error.message : 'Invalid WebSocket URL',
      'SyntaxError'
    );
  }

  appendQuery(url, init?.query);

  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new DOMException(`Invalid WebSocket URL protocol: ${url.protocol}`, 'SyntaxError');
  }

  if (url.hash) {
    throw new DOMException('WebSocket URL must not include a fragment', 'SyntaxError');
  }

  return url.toString();
}

export function normalizeHeaders(headers?: HeadersInit): Headers {
  const normalized = headers instanceof Headers ? new Headers(headers) : new Headers(headers);

  for (const [name] of normalized) {
    if (FORBIDDEN_WEBSOCKET_HEADERS.has(name.toLowerCase())) {
      throw new DOMException(`Forbidden WebSocket header: ${name}`, 'SyntaxError');
    }
  }

  return normalized;
}

export function normalizeProtocols(protocols?: string | string[]): string[] {
  if (!protocols) {
    return [];
  }

  const values = Array.isArray(protocols) ? protocols : [protocols];
  const seen = new Set<string>();

  for (const value of values) {
    if (!SUBPROTOCOL_PATTERN.test(value)) {
      throw new DOMException(`Invalid WebSocket subprotocol: ${value}`, 'SyntaxError');
    }

    if (seen.has(value)) {
      throw new DOMException(`Duplicate WebSocket subprotocol: ${value}`, 'SyntaxError');
    }

    seen.add(value);
  }

  return values;
}

export function validateCloseCode(code: number): void {
  if (code === 1000) {
    return;
  }

  if (code >= 3000 && code <= 4999) {
    return;
  }

  throw new DOMException(`Invalid WebSocket close code: ${code}`, 'InvalidAccessError');
}

export function validateCloseReason(reason: string): void {
  if (Buffer.byteLength(reason) > 123) {
    throw new DOMException('WebSocket close reason must be 123 bytes or fewer', 'SyntaxError');
  }
}
