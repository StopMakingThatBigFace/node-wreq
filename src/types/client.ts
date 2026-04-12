import type { WebSocket } from '../websocket';
import type { Hooks } from './hooks';
import type { RequestInput, WreqInit } from './http';
import type { HeadersInit } from './shared';
import type { BodyInit } from './shared';
import type { WebSocketInit } from './websocket';

export interface ClientDefaults extends Omit<WreqInit, 'body' | 'method' | 'signal'> {
  headers?: HeadersInit;
  hooks?: Hooks;
}

export interface Client {
  readonly defaults: ClientDefaults;
  fetch(input: RequestInput, init?: WreqInit): Promise<import('../http/response').Response>;
  websocket(input: string | URL, init?: WebSocketInit): Promise<WebSocket>;
  get(
    input: RequestInput,
    init?: Omit<WreqInit, 'method'>
  ): Promise<import('../http/response').Response>;
  post(
    input: RequestInput,
    body?: BodyInit | null,
    init?: Omit<WreqInit, 'method' | 'body'>
  ): Promise<import('../http/response').Response>;
  extend(defaults: ClientDefaults): Client;
}
