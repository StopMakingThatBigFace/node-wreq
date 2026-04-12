import { Buffer } from 'node:buffer';
import type { NativeWebSocketReadResult, WebSocketBinaryType } from '../types';

export function getSendByteLength(data: string | Blob | ArrayBuffer | ArrayBufferView): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data);
  }

  if (data instanceof Blob) {
    return data.size;
  }

  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }

  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  return 0;
}

export async function normalizeSendData(
  data: string | Blob | ArrayBuffer | ArrayBufferView
): Promise<
  | {
      type: 'text';
      data: string;
    }
  | {
      type: 'binary';
      data: Uint8Array;
    }
> {
  if (typeof data === 'string') {
    return {
      type: 'text',
      data,
    };
  }

  if (data instanceof Blob) {
    return {
      type: 'binary',
      data: new Uint8Array(await data.arrayBuffer()),
    };
  }

  if (ArrayBuffer.isView(data)) {
    return {
      type: 'binary',
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    };
  }

  if (data instanceof ArrayBuffer) {
    return {
      type: 'binary',
      data: new Uint8Array(data),
    };
  }

  throw new TypeError('Unsupported WebSocket message type');
}

export function toMessageEventData(
  result: NativeWebSocketReadResult,
  binaryType: WebSocketBinaryType
): unknown {
  switch (result.type) {
    case 'text': {
      return result.data;
    }
    case 'binary': {
      if (binaryType === 'arraybuffer') {
        const bytes = result.data;

        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }

      return new Blob([result.data]);
    }
    case 'close': {
      throw new TypeError('Close frames cannot be converted to message events');
    }
  }
}
