import { execSync } from 'node:child_process';
import type {
  NativeRequestOptions,
  NativeResponse,
  NativeWebSocketConnectOptions,
  NativeWebSocketConnection,
  NativeWebSocketReadResult,
} from '../types';

export type NativeBinding = {
  request: (options: NativeRequestOptions) => Promise<NativeResponse>;
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

type NativeTarget = {
  binaryName: string;
  packageName: string;
};

let nativeBinding: NativeBinding | undefined;

function isMuslRuntime(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }

  if (typeof process.report?.getReport === 'function') {
    const report = process.report.getReport() as {
      header?: {
        glibcVersionRuntime?: string;
      };
    };

    if (report.header?.glibcVersionRuntime) {
      return false;
    }
  }

  try {
    const output = execSync('ldd --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return output.toLowerCase().includes('musl');
  } catch {
    return true;
  }
}

function loadNativeBinding(): NativeBinding {
  const platform = process.platform;
  const arch = process.arch;
  const libc = platform === 'linux' ? (isMuslRuntime() ? 'musl' : 'gnu') : undefined;
  const platformArchMap: Record<string, Record<string, NativeTarget>> = {
    darwin: {
      x64: {
        binaryName: 'node-wreq.darwin-x64.node',
        packageName: '@node-wreq/darwin-x64',
      },
      arm64: {
        binaryName: 'node-wreq.darwin-arm64.node',
        packageName: '@node-wreq/darwin-arm64',
      },
    },
    linux: {
      x64:
        libc === 'musl'
          ? {
              binaryName: 'node-wreq.linux-x64-musl.node',
              packageName: '@node-wreq/linux-x64-musl',
            }
          : {
              binaryName: 'node-wreq.linux-x64-gnu.node',
              packageName: '@node-wreq/linux-x64-gnu',
            },
      arm64: {
        binaryName: 'node-wreq.linux-arm64-gnu.node',
        packageName: '@node-wreq/linux-arm64-gnu',
      },
    },
    win32: {
      x64: {
        binaryName: 'node-wreq.win32-x64-msvc.node',
        packageName: '@node-wreq/win32-x64-msvc',
      },
    },
  };

  const target = platformArchMap[platform]?.[arch];

  if (!target) {
    throw new Error(
      `Unsupported platform: ${platform}-${arch}. ` +
        `Supported platforms: darwin-x64, darwin-arm64, linux-x64-gnu, linux-x64-musl, linux-arm64-gnu, win32-x64-msvc`
    );
  }

  const attempted: string[] = [target.packageName];

  try {
    return require(target.packageName) as NativeBinding;
  } catch {
    attempted.push(`../rust/${target.binaryName}`);
  }

  try {
    return require(`../rust/${target.binaryName}`) as NativeBinding;
  } catch {
    attempted.push('../rust/node-wreq.node');
  }

  try {
    return require('../rust/node-wreq.node') as NativeBinding;
  } catch {
    throw new Error(
      `Failed to load native module for ${platform}-${arch}. ` +
        `Tried: ${attempted.join(', ')}. ` +
        `Make sure the matching @node-wreq platform package is installed or build the local native module.`
    );
  }
}

export function getBinding(): NativeBinding {
  nativeBinding ??= loadNativeBinding();

  return nativeBinding;
}
