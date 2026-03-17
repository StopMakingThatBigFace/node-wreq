import type { Response } from './response';
import type { NormalizedRequest } from './types';

type RequestErrorOptions = {
  code?: string;
  cause?: unknown;
  request?: NormalizedRequest;
  response?: Response;
  attempt?: number;
};

export class RequestError extends Error {
  code?: string;
  cause?: unknown;
  request?: NormalizedRequest;
  response?: Response;
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

export class HTTPError extends RequestError {
  status: number;

  constructor(message: string, status: number, options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_HTTP_STATUS' });
    this.name = 'HTTPError';
    this.status = status;
  }
}

export class TimeoutError extends RequestError {
  constructor(message = 'Request timed out', options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_TIMEOUT' });
    this.name = 'TimeoutError';
  }
}

export class AbortError extends RequestError {
  constructor(message = 'The operation was aborted', options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_ABORTED' });
    this.name = 'AbortError';
  }
}

export class WebSocketError extends RequestError {
  constructor(message = 'WebSocket operation failed', options?: RequestErrorOptions) {
    super(message, { ...options, code: 'ERR_WEBSOCKET' });
    this.name = 'WebSocketError';
  }
}
