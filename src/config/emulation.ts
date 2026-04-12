import type { Http1Options, Http2Options, TlsOptions, WebSocketInit, WreqInit } from '../types';

type EmulationInput = Pick<WreqInit, 'tlsOptions' | 'http1Options' | 'http2Options'> &
  Pick<WebSocketInit, 'tlsOptions' | 'http1Options' | 'http2Options'>;

type SerializedEmulation = {
  tlsOptions?: TlsOptions;
  http1Options?: Http1Options;
  http2Options?: Http2Options;
};

function hasAnyEmulationOptions(input: EmulationInput): boolean {
  return Boolean(input.tlsOptions || input.http1Options || input.http2Options);
}

export function serializeEmulationOptions(input: EmulationInput): string | undefined {
  if (!hasAnyEmulationOptions(input)) {
    return undefined;
  }

  const payload: SerializedEmulation = {};

  if (input.tlsOptions) {
    payload.tlsOptions = input.tlsOptions;
  }

  if (input.http1Options) {
    payload.http1Options = input.http1Options;
  }

  if (input.http2Options) {
    payload.http2Options = input.http2Options;
  }

  return JSON.stringify(payload);
}
