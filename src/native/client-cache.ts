import type { NativeRequestOptions, NativeWebSocketConnectOptions } from '../types';

type NativeClientOptions = NativeRequestOptions | NativeWebSocketConnectOptions;

/** Builds a stable-enough key for the native client-builder inputs we control. */
export function createNativeClientCacheKey(options: NativeClientOptions): string {
  return JSON.stringify({
    browser: options.browser,
    browserMode: options.browserMode,
    browserPlatform: options.browserPlatform,
    browserHttp2: options.browserHttp2,
    browserHeaders: options.browserHeaders,
    emulationJson: options.emulationJson,
    proxy: options.proxy,
    disableSystemProxy: options.disableSystemProxy,
    dns: options.dns,
    timeout: 'protocols' in options ? options.timeout : undefined,
    connectTimeout: 'connectTimeout' in options ? options.connectTimeout : undefined,
    poolIdleTimeout: options.poolIdleTimeout,
    poolMaxIdlePerHost: options.poolMaxIdlePerHost,
    poolMaxSize: options.poolMaxSize,
    tlsSessionCacheCapacity: options.tlsSessionCacheCapacity,
    http1Only: 'http1Only' in options ? options.http1Only : undefined,
    http2Only: 'http2Only' in options ? options.http2Only : undefined,
    localAddress: options.localAddress,
    localAddresses: options.localAddresses,
    interface: options.interface,
    tlsIdentity: options.tlsIdentity,
    ca: options.ca,
    tlsDebug: options.tlsDebug,
    tlsDanger: options.tlsDanger,
  });
}
