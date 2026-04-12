import { Buffer } from 'node:buffer';
import { WebSocketError } from '../errors';
import { Headers } from '../headers';
import type { HeadersInit, WebSocketInit } from '../types';

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
  const url = init?.baseURL ? new URL(String(rawUrl), init.baseURL) : new URL(String(rawUrl));

  appendQuery(url, init?.query);

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new WebSocketError(`Invalid WebSocket URL protocol: ${url.protocol}`);
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
      throw new SyntaxError(`Invalid WebSocket subprotocol: ${value}`);
    }

    if (seen.has(value)) {
      throw new SyntaxError(`Duplicate WebSocket subprotocol: ${value}`);
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
