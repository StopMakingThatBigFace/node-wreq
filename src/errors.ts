export class RequestError extends Error {
  code?: string;
  cause?: unknown;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message);
    this.name = 'RequestError';
    this.code = options?.code;
    this.cause = options?.cause;
  }
}

export class HTTPError extends RequestError {
  status: number;

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, { code: 'ERR_HTTP_STATUS', cause: options?.cause });
    this.name = 'HTTPError';
    this.status = status;
  }
}

export class TimeoutError extends RequestError {
  constructor(message = 'Request timed out', options?: { cause?: unknown }) {
    super(message, { code: 'ERR_TIMEOUT', cause: options?.cause });
    this.name = 'TimeoutError';
  }
}

export class AbortError extends RequestError {
  constructor(message = 'The operation was aborted', options?: { cause?: unknown }) {
    super(message, { code: 'ERR_ABORTED', cause: options?.cause });
    this.name = 'AbortError';
  }
}
