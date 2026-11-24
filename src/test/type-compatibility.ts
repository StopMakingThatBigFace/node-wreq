import type {
  fetch as wreqFetch,
  Headers as WreqHeaders,
  Request as WreqRequest,
  Response as WreqResponse,
  CloseEvent as WreqCloseEvent,
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

const onClose = (event: WreqCloseEvent): void => void event.code;

/** Compile-time check that WebSocket listeners receive the event type for their event name. */
export function assertWebSocketListenerTypes(socket: WreqWebSocket): void {
  socket.addEventListener('message', (event) => void event.data);
  socket.addEventListener('close', (event) => void [event.code, event.reason, event.wasClean]);
  socket.addEventListener('custom', (event) => void event.type);

  socket.addEventListener('close', onClose);
  socket.removeEventListener('close', onClose);
}
