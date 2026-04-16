import type { Request } from '../http/request';
import type { Response } from '../http/response';

type RequestErrorOptions = {
  code?: string;
  cause?: unknown;
  request?: Request;
  response?: Response;
  attempt?: number;
};

/** Base error type used by HTTP and WebSocket operations. */
export class RequestError extends Error {
  /** Machine-readable error code when one is available. */
  code?: string;
  /** Original error that caused this failure. */
  cause?: unknown;
  /** Request associated with the failure, when available. */
  request?: Request;
  /** Response associated with the failure, when available. */
  response?: Response;
  /** Attempt number associated with the failure, when available. */
  attempt?: number;

  constructor(message: string, options?: RequestErrorOptions) {
    super(message);
    this.name = 'RequestError';
    this.code = options?.code;
    this.cause = options?.cause;
    this.request = options?.request;
    this.response = options?.response;
    this.attempt = options?.attempt;
  }
}

/** Error raised for disallowed HTTP status codes. */
export class HTTPError extends RequestError {
  /** HTTP status code returned by the server. */
  status: number;

  constructor(message: string, status: number, options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_HTTP_STATUS' });
    this.name = 'HTTPError';
    this.status = status;
  }
}

/** Error raised when a request exceeds its configured timeout. */
export class TimeoutError extends RequestError {
  constructor(message = 'Request timed out', options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_TIMEOUT' });
    this.name = 'TimeoutError';
  }
}

/** Error raised when an operation is aborted. */
export class AbortError extends RequestError {
  constructor(message = 'The operation was aborted', options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_ABORTED' });
    this.name = 'AbortError';
  }
}

/** Error raised for WebSocket connection and I/O failures. */
export class WebSocketError extends RequestError {
  constructor(message = 'WebSocket operation failed', options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_WEBSOCKET' });
    this.name = 'WebSocketError';
  }
}
