export class CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type);
    this.code = init?.code ?? 1005;
    this.reason = init?.reason ?? '';
    this.wasClean = init?.wasClean ?? false;
  }
}
