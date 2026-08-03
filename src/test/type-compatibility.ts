import type {
  fetch as wreqFetch,
  Headers as WreqHeaders,
  Request as WreqRequest,
  Response as WreqResponse,
  WebSocket as WreqWebSocket,
} from '../node-wreq';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

export type WhatwgTypeCompatibility = [
  Assert<IsAssignable<typeof wreqFetch, typeof globalThis.fetch>>,
  Assert<IsAssignable<WreqHeaders, globalThis.Headers>>,
  Assert<IsAssignable<WreqRequest, globalThis.Request>>,
  Assert<IsAssignable<WreqResponse, globalThis.Response>>,
  Assert<IsAssignable<WreqWebSocket, globalThis.WebSocket>>,
];
