import { AbortError } from './errors';
import type {
  BrowserProfile,
  HttpMethod,
  NativeResponse,
  NativeRequestOptions,
  NativeWebSocketConnectOptions,
  NativeWebSocketConnection,
  NativeWebSocketReadResult,
} from './types';

type NativeBinding = {
  request: (options: NativeRequestOptions) => {
    handle: number;
    promise: Promise<NativeResponse>;
  };
  cancelRequest: (handle: number) => boolean;
  websocketConnect: (options: NativeWebSocketConnectOptions) => Promise<NativeWebSocketConnection>;
  websocketRead: (handle: number) => Promise<NativeWebSocketReadResult>;
  websocketSendText: (handle: number, text: string) => Promise<void>;
  websocketSendBinary: (handle: number, data: Buffer) => Promise<void>;
  websocketClose: (handle: number, code?: number, reason?: string) => Promise<void>;
  readBodyChunk: (
    handle: number,
    size?: number
  ) => Promise<{
    chunk: Buffer;
    done: boolean;
  }>;
  readBodyAll: (handle: number) => Promise<Buffer>;
  cancelBody: (handle: number) => boolean;
  getProfiles: () => string[];
};

let nativeBinding: NativeBinding | undefined;

function loadNativeBinding(): NativeBinding {
  const platform = process.platform;
  const arch = process.arch;

  const platformArchMap: Record<string, Record<string, string>> = {
    darwin: {
      x64: 'darwin-x64',
      arm64: 'darwin-arm64',
    },
    linux: {
      x64: 'linux-x64-gnu',
    },
    win32: {
      x64: 'win32-x64-msvc',
    },
  };

  const platformArch = platformArchMap[platform]?.[arch];

  if (!platformArch) {
    throw new Error(
      `Unsupported platform: ${platform}-${arch}. ` +
        `Supported platforms: darwin-x64, darwin-arm64, linux-x64, win32-x64`
    );
  }

  const binaryName = `node-wreq.${platformArch}.node`;

  try {
    return require(`../rust/${binaryName}`) as NativeBinding;
  } catch {
    try {
      return require('../rust/node-wreq.node') as NativeBinding;
    } catch {
      throw new Error(
        `Failed to load native module for ${platform}-${arch}. ` +
          `Tried: ../rust/${binaryName} and ../rust/node-wreq.node. ` +
          `Make sure the package is installed correctly and the native module is built for your platform.`
      );
    }
  }
}

function getBinding(): NativeBinding {
  nativeBinding ??= loadNativeBinding();

  return nativeBinding;
}

let cachedProfiles: BrowserProfile[] | undefined;

export function getProfiles(): BrowserProfile[] {
  cachedProfiles ??= getBinding().getProfiles() as BrowserProfile[];

  return cachedProfiles;
}

export async function nativeRequest(
  options: NativeRequestOptions,
  signal?: AbortSignal | null
): Promise<NativeResponse> {
  if (signal?.aborted) {
    throw new AbortError(undefined, { cause: signal.reason });
  }

  const task = getBinding().request(options);

  if (!signal) {
    return task.promise;
  }

  return new Promise<NativeResponse>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      getBinding().cancelRequest(task.handle);
      reject(new AbortError(undefined, { cause: signal.reason }));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    task.promise.then(
      (response) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(response);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

export async function nativeReadBodyChunk(
  handle: number,
  size?: number
): Promise<{
  chunk: Uint8Array;
  done: boolean;
}> {
  return getBinding().readBodyChunk(handle, size);
}

export async function nativeReadBodyAll(handle: number): Promise<Uint8Array> {
  return getBinding().readBodyAll(handle);
}

export function nativeCancelBody(handle: number): boolean {
  return getBinding().cancelBody(handle);
}

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

export function validateBrowserProfile(browser?: BrowserProfile): void {
  if (!browser) {
    return;
  }

  if (!getProfiles().includes(browser)) {
    throw new Error(`Invalid browser profile: ${browser}`);
  }
}

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
