/** WebSocket close event compatible with the browser API shape. */
export class CloseEvent extends Event {
  /** Close code reported by the peer or transport. */
  readonly code: number;
  /** Close reason reported by the peer. */
  readonly reason: string;
  /** Whether the close handshake completed cleanly. */
  readonly wasClean: boolean;

  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type);
    this.code = init?.code ?? 1005;
    this.reason = init?.reason ?? '';
    this.wasClean = init?.wasClean ?? false;
  }
}
