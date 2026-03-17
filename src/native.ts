import type { BrowserProfile, HttpMethod, NativeResponse, NativeRequestOptions } from './types';

type NativeBinding = {
  request: (options: NativeRequestOptions) => Promise<NativeResponse>;
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
        `Supported platforms: darwin-x64, darwin-arm64, linux-x64, win32-x64`,
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
          `Make sure the package is installed correctly and the native module is built for your platform.`,
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

export async function nativeRequest(options: NativeRequestOptions): Promise<NativeResponse> {
  return getBinding().request(options);
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
