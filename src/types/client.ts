import type { WebSocket } from '../websocket';
import type { Hooks } from './hooks';
import type { RequestInput, WreqInit } from './http';
import type { HeadersInit } from './shared';
import type { BodyInit } from './shared';
import type { WebSocketInit } from './websocket';

/** Default options applied by a reusable client instance. */
export interface ClientDefaults extends Omit<WreqInit, 'body' | 'method' | 'signal'> {
  /** Default headers merged into every request. */
  headers?: HeadersInit;
  /** Default lifecycle hooks merged into every request. */
  hooks?: Hooks;
}

/** Reusable HTTP/WebSocket client with mergeable defaults. */
export interface Client {
  /** Immutable defaults currently applied by the client. */
  readonly defaults: ClientDefaults;
  /** Performs a request using the merged client defaults and per-call options. */
  fetch(input: RequestInput, init?: WreqInit): Promise<import('../http/response').Response>;
  /** Opens a WebSocket using the merged client defaults and per-call options. */
  websocket(input: string | URL, init?: WebSocketInit): Promise<WebSocket>;
  /** Performs a `GET` request. */
  get(
    input: RequestInput,
    init?: Omit<WreqInit, 'method'>
  ): Promise<import('../http/response').Response>;
  /** Performs a `POST` request. */
  post(
    input: RequestInput,
    body?: BodyInit | null,
    init?: Omit<WreqInit, 'method' | 'body'>
  ): Promise<import('../http/response').Response>;
  /** Performs a `PUT` request. */
  put(
    input: RequestInput,
    body?: BodyInit | null,
    init?: Omit<WreqInit, 'method' | 'body'>
  ): Promise<import('../http/response').Response>;
  /** Performs a `PATCH` request. */
  patch(
    input: RequestInput,
    body?: BodyInit | null,
    init?: Omit<WreqInit, 'method' | 'body'>
  ): Promise<import('../http/response').Response>;
  /** Performs a `DELETE` request. */
  delete(
    input: RequestInput,
    init?: Omit<WreqInit, 'method'>
  ): Promise<import('../http/response').Response>;
  /** Performs a `HEAD` request. */
  head(
    input: RequestInput,
    init?: Omit<WreqInit, 'method'>
  ): Promise<import('../http/response').Response>;
  /** Performs an `OPTIONS` request. */
  options(
    input: RequestInput,
    init?: Omit<WreqInit, 'method'>
  ): Promise<import('../http/response').Response>;
  /** Creates a new client with merged defaults. */
  extend(defaults: ClientDefaults): Client;
}
