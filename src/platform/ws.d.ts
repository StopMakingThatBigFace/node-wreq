declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';
  import { EventEmitter } from 'node:events';

  export class WebSocket extends EventEmitter {
    protocol: string;
    send(data: string | Uint8Array | Buffer, options?: { binary?: boolean }): void;
    close(code?: number, reason?: string): void;
    on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: {
      noServer?: boolean;
      perMessageDeflate?: boolean;
      handleProtocols?: (protocols: Set<string>) => string | false;
    });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket) => void
    ): void;
    close(callback?: () => void): void;
    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this;
  }
}
