import { Buffer } from 'node:buffer';
import type {
  NativeWebSocketConnectOptions,
  NativeWebSocketConnection,
  NativeWebSocketReadResult,
} from '../types';
import { getBinding } from './binding';

export async function nativeWebSocketConnect(
  options: NativeWebSocketConnectOptions
): Promise<NativeWebSocketConnection> {
  return getBinding().websocketConnect(options);
}

export async function nativeWebSocketRead(handle: number): Promise<NativeWebSocketReadResult> {
  return getBinding().websocketRead(handle);
}

export async function nativeWebSocketSendText(handle: number, text: string): Promise<void> {
  return getBinding().websocketSendText(handle, text);
}

export async function nativeWebSocketSendBinary(handle: number, data: Uint8Array): Promise<void> {
  return getBinding().websocketSendBinary(handle, Buffer.from(data));
}

export async function nativeWebSocketClose(
  handle: number,
  code?: number,
  reason?: string
): Promise<void> {
  return getBinding().websocketClose(handle, code, reason);
}
