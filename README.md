# node-wreq

[![NPM Version](https://img.shields.io/npm/v/node-wreq)](https://npmjs.com/package/node-wreq)
![ESM](https://img.shields.io/badge/ESM-supported-brightgreen)
![Platforms](https://img.shields.io/badge/platforms-linux%20%7C%20macos%20%7C%20windows-lightgrey)

`node-wreq` is a thin Node.js wrapper around 0x676e67's [`wreq`](https://github.com/0x676e67/wreq) — 
a Rust HTTP client exposing its full power to JavaScript.

Use it when you need low-level control over the network layer: TLS configuration, 
transport fingerprinting, browser impersonation, or fine-grained HTTP/WebSocket 
behavior that standard Node.js clients simply don't expose.

> [!TIP]
> ### why does this exist?
>
> Node.js ships with a built-in `https` module, and the ecosystem offers popular clients like `axios`, `got`, and `node-fetch` — but all of them are built on top of OpenSSL via Node's `tls` module, which exposes **no control over low-level TLS handshake parameters**. This makes it fundamentally impossible to emulate real browser network behavior from pure JavaScript.
>
> - **HTTP/1 over TLS**
>
>   Node.js HTTP clients normalize headers to lowercase internally, which is compliant with HTTP/2 semantics but breaks compatibility with some **WAFs** that enforce case-sensitive header validation on **HTTP/1** requests. This wrapper preserves header case exactly as specified, preventing requests from being silently rejected.
>
> - **HTTP/2 over TLS**
>
>   Fingerprints like **JA3**, **JA4**, and **Akamai HTTP/2** are derived from the specifics of the TLS handshake and HTTP/2 SETTINGS frames — cipher suite ordering, TLS extensions, ALPN values, HPACK header compression parameters, and more. Node.js exposes none of these through its `tls` or `http2` APIs. You simply cannot spoof them from JS land, no matter the library. This package solves that at the native layer, giving you fine-grained control over TLS and HTTP/2 extensions to precisely match real browser behavior.
>
> - **Device Emulation**
>
>   Because TLS and HTTP/2 fingerprints evolve slowly relative to browser release cycles, a single fingerprint profile often covers many browser versions. **100+ pre-built browser device profiles** are bundled, so you don't have to figure out the right combination of settings yourself.

TLS and HTTP/2 fingerprinting is actively used by major bot protection and WAF providers — including **Cloudflare** Bot Management, **AWS WAF** (Bot Control + CloudFront JA3 headers), **Google Cloud Armor**, **Akamai** (which maintains its own HTTP/2 fingerprint format on top of JA3/JA4), **ServicePipe** (a Russian DDoS protection and WAF provider), and various specialized anti-bot services like **DataDome** and **PerimeterX**. Correctly emulating a browser's TLS handshake and HTTP/2 SETTINGS frames is a hard requirement to get past these layers undetected.

> [!NOTE]
> This only covers the transport layer. It does not help bypass JavaScript-based challenges (Cloudflare Turnstile, Akamai sensor data, Kasada, etc.), CAPTCHA, or behavioral analysis — those require a different approach entirely

## install

```bash
npm install node-wreq
```

## contents

#### ⚡   **[quick start](#quick-start)**
#### 🌐   **[fetch](#fetch)**
#### 🧩   **[client](#client)** — shared defaults, reusable config.
#### 🎭   **[browser profiles](#browser-profiles)**
#### 🪝   **[hooks](#hooks)** — request lifecycle, dynamic auth, retries, etc.
#### 🍪   **[cookies and sessions](#cookies)**
#### 🔁   **[redirects and retries](#redirects-and-retries)**
#### 📊   **[observability](#observability)**
#### 🚨   **[error handling](#errors)**
#### 🔌   **[websockets](#websockets)**
#### 🧪   **[networking / transport knobs](#networking)** — TLS, HTTP/1, HTTP/2 options; header ordering.

## ⚡ <a id="quick-start"></a>quick start

```ts
import { fetch } from 'node-wreq';

const response = await fetch('https://httpbin.org/get', {
  browser: 'chrome_137',
});

console.log(response.status);
console.log(await response.json());
```

If you keep repeating config, move to a client:

```ts
import { createClient } from 'node-wreq';

const client = createClient({
  baseURL: 'https://httpbin.org',
  browser: 'chrome_137',
  headers: {
    'x-client': 'node-wreq',
  },
  retry: 2,
});

const response = await client.fetch('/anything', {
  query: { from: 'client' },
});

console.log(response.status);
console.log(await response.json());
```

## 🌐 <a id="fetch"></a>fetch   ·   [↑](#contents)

### simple GET

```ts
import { fetch } from 'node-wreq';

const response = await fetch('https://httpbin.org/get', {
  browser: 'firefox_139',
  query: {
    source: 'node-wreq',
    debug: true,
  },
  timeout: 15_000,
});

const body = await response.json();

console.log(response.ok);
console.log(body.args);
```

### JSON POST

```ts
import { fetch } from 'node-wreq';

const response = await fetch('https://api.example.com/items', {
  method: 'POST',
  browser: 'chrome_137',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    name: 'example',
    enabled: true,
  }),
  throwHttpErrors: true,
});

console.log(await response.json());
```

### build a `Request` first

```ts
import { Request, fetch } from 'node-wreq';

const request = new Request('https://httpbin.org/post', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify({ via: 'Request' }),
});

const response = await fetch(request, {
  browser: 'chrome_137',
});

console.log(await response.json());
```

### read extra metadata

`fetch()` returns a fetch-style `Response`, plus extra metadata under `response.wreq`.

```ts
const response = await fetch('https://example.com', {
  browser: 'chrome_137',
});

console.log(response.status);
console.log(response.headers.get('content-type'));

console.log(response.wreq.cookies);
console.log(response.wreq.setCookies);
console.log(response.wreq.timings);
console.log(response.wreq.redirectChain);
```

If you need a Node stream instead of a WHATWG stream:

```ts
const readable = response.wreq.readable();

readable.pipe(process.stdout);
```

## 🧩 <a id="client"></a>client   ·   [↑](#contents)

Use `createClient(...)` when requests share defaults:

- `baseURL`
- browser profile
- headers
- proxy
- timeout
- hooks
- retry policy
- cookie jar

### shared defaults

```ts
import { createClient } from 'node-wreq';

const client = createClient({
  baseURL: 'https://api.example.com',
  browser: 'chrome_137',
  timeout: 10_000,
  headers: {
    authorization: `Bearer ${process.env.API_TOKEN}`,
  },
  retry: {
    limit: 2,
    statusCodes: [429, 503],
  },
});

const users = await client.get('/users');

console.log(await users.json());

const created = await client.post(
  '/users',
  JSON.stringify({ email: 'user@example.com' }),
  {
    headers: {
      'content-type': 'application/json',
    },
  }
);

console.log(created.status);
```

### extend a client

```ts
const base = createClient({
  baseURL: 'https://api.example.com',
  browser: 'chrome_137',
});

const admin = base.extend({
  headers: {
    authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
  },
});

await base.get('/health');
await admin.get('/admin/stats');
```

## 🎭 <a id="browser-profiles"></a>browser profiles   ·   [↑](#contents)

Inspect the available profiles at runtime:

```ts
import { getProfiles } from 'node-wreq';

console.log(getProfiles());
```

There is also `BROWSER_PROFILES` if you want the generated list directly.

Typical profiles include browser families like:

- Chrome
- Edge
- Firefox
- Safari
- Opera
- OkHttp

## 🪝 <a id="hooks"></a>hooks   ·   [↑](#contents)

Hooks are the request pipeline.

Available phases:

- `init`
- `beforeRequest`
- `afterResponse`
- `beforeRetry`
- `beforeError`
- `beforeRedirect`

### common pattern: auth, tracing, proxy rotation

```ts
import { createClient } from 'node-wreq';

const client = createClient({
  baseURL: 'https://example.com',
  retry: {
    limit: 2,
    statusCodes: [429, 503],
    backoff: ({ attempt }) => attempt * 250,
  },
  hooks: {
    init: [
      ({ options, state }) => {
        options.query = { ...options.query, source: 'hook-init' };

        state.startedAt = Date.now();
      },
    ],
    beforeRequest: [
      ({ request, options, state }) => {
        request.headers.set('x-trace-id', crypto.randomUUID());
        request.headers.set('authorization', `Bearer ${getAccessToken()}`);

        options.proxy = pickProxy();

        state.lastProxy = options.proxy;
      },
    ],
    beforeRetry: [
      ({ options, attempt, error, state }) => {
        options.proxy = pickProxy(attempt);

        console.log('retrying', {
          attempt,
          proxy: options.proxy,
          previousProxy: state.lastProxy,
          error,
        });
      },
    ],
    beforeError: [
      ({ error, state }) => {
        error.message = `[trace=${String(state.startedAt)}] ${error.message}`;

        return error;
      },
    ],
  },
});
```

### replace a response in `afterResponse`

```ts
import { Response, fetch } from 'node-wreq';

const response = await fetch('https://example.com/account', {
  hooks: {
    afterResponse: [
      async ({ response }) => {
        if (response.status === 401) {
          return new Response(JSON.stringify({ guest: true }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
            url: response.url,
          });
        }
      },
    ],
  },
});

console.log(await response.json());
```

### mutate redirect hops

```ts
await fetch('https://example.com/login', {
  hooks: {
    beforeRedirect: [
      ({ request, nextUrl, redirectCount }) => {
        request.headers.set('x-redirect-hop', String(redirectCount));
        request.headers.set('x-next-url', nextUrl);
      },
    ],
  },
});
```

Rule of thumb:

- use hooks for dynamic behavior
- use client defaults for static behavior

## 🍪 <a id="cookies"></a>cookies and sessions   ·   [↑](#contents)

`node-wreq` does not force a built-in cookie store.

You provide a `cookieJar` with two methods:

- `getCookies(url)`
- `setCookie(cookie, url)`

That jar can be:

- in-memory
- `tough-cookie`
- Redis-backed
- DB-backed
- anything else that matches the interface

### tiny in-memory jar

```ts
import { fetch, websocket } from 'node-wreq';

const jarStore = new Map<string, string>();

const cookieJar = {
  getCookies() {
    return [...jarStore.entries()].map(([name, value]) => ({
      name,
      value,
    }));
  },
  setCookie(cookie: string) {
    const [pair] = cookie.split(';');
    const [name, value = ''] = pair.split('=');

    jarStore.set(name, value);
  },
};

await fetch('https://example.com/login', { cookieJar });
await fetch('https://example.com/profile', { cookieJar });
await websocket('wss://example.com/ws', { cookieJar });
```

### `tough-cookie`

```bash
npm install tough-cookie
```

```ts
import { CookieJar as ToughCookieJar } from 'tough-cookie';
import { createClient } from 'node-wreq';

const toughJar = new ToughCookieJar();

const cookieJar = {
  async getCookies(url: string) {
    const cookies = await toughJar.getCookies(url);

    return cookies.map((cookie) => ({
      name: cookie.key,
      value: cookie.value,
    }));
  },
  async setCookie(cookie: string, url: string) {
    await toughJar.setCookie(cookie, url);
  },
};

const client = createClient({
  browser: 'chrome_137',
  cookieJar,
});

await client.fetch('https://example.com/login');
await client.fetch('https://example.com/profile');
```

### inspect cookies on a response

```ts
import { fetch } from 'node-wreq';

const response = await fetch('https://example.com/login', { cookieJar });

console.log(response.wreq.setCookies);
console.log(response.wreq.cookies);
```

## 🔁 <a id="redirects-and-retries"></a>redirects and retries   ·   [↑](#contents)

Both are opt-in controls on top of the normal request pipeline.

### manual redirects

```ts
const response = await fetch('https://example.com/login', {
  redirect: 'manual',
});

console.log(response.status);
console.log(response.headers.get('location'));
console.log(response.redirected);
```

Modes:

- `follow` - default redirect following
- `manual` - return the redirect response as-is
- `error` - throw on the first redirect

Useful redirect facts:

- `response.wreq.redirectChain` records followed hops
- `301` / `302` rewrite `POST` to `GET`
- `303` rewrites to `GET` unless current method is `HEAD`
- `307` / `308` preserve method and body
- `authorization` is stripped on cross-origin redirect

### simple retries

```ts
const response = await fetch('https://example.com', {
  retry: 2,
});
```

### explicit retry policy

```ts
const response = await fetch('https://example.com', {
  retry: {
    limit: 3,
    statusCodes: [429, 503],
    backoff: ({ attempt }) => attempt * 500,
  },
});
```

### custom retry decision

```ts
import { TimeoutError, fetch } from 'node-wreq';

const response = await fetch('https://example.com', {
  retry: {
    limit: 5,
    shouldRetry: ({ error, response }) => {
      if (response?.status === 429) {
        return true;
      }

      return error instanceof TimeoutError;
    },
  },
});
```

Defaults:

- retry is off unless you enable it
- default retry methods are `GET` and `HEAD`
- default status codes include `408`, `425`, `429`, `500`, `502`, `503`, `504`
- default error codes include `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ERR_TIMEOUT`

## 📊 <a id="observability"></a>observability   ·   [↑](#contents)

Two main surfaces:

- `response.wreq.timings`
- `onStats(stats)`

### per-request stats callback

```ts
await fetch('https://example.com', {
  onStats: ({ attempt, timings, response, error }) => {
    console.log({
      attempt,
      wait: timings.wait,
      total: timings.total,
      status: response?.status,
      error,
    });
  },
});
```

### read timings from the final response

```ts
const response = await fetch('https://example.com', {
  browser: 'chrome_137',
});

console.log(response.wreq.timings);
```

Current timings are wrapper-level timings that are still useful in practice:

- request start
- response available
- total time when body consumption is known

## 🚨 <a id="errors"></a>error handling   ·   [↑](#contents)

Main error classes:

- `RequestError`
- `HTTPError`
- `TimeoutError`
- `AbortError`
- `WebSocketError`

Typical patterns:

```ts
import { HTTPError, TimeoutError, fetch } from 'node-wreq';

try {
  await fetch('https://example.com', {
    timeout: 1_000,
    throwHttpErrors: true,
  });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error('request timed out');
  } else if (error instanceof HTTPError) {
    console.error('bad status', error.statusCode);
  } else {
    console.error(error);
  }
}
```

## 🔌 <a id="websockets"></a>websockets   ·   [↑](#contents)

You can use either:

- `await websocket(url, init?)`
- `new WebSocket(url, init?)`

### simple helper

```ts
import { websocket } from 'node-wreq';

const socket = await websocket('wss://echo.websocket.events', {
  browser: 'chrome_137',
  protocols: ['chat'],
});

socket.addEventListener('message', (event) => {
  console.log('message:', event.data);
});

socket.send('hello');
```

### WHATWG-like constructor

```ts
import { WebSocket } from 'node-wreq';

const socket = new WebSocket('wss://example.com/ws', {
  binaryType: 'arraybuffer',
});

await socket.opened;

socket.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    console.log(new Uint8Array(event.data));
  }
};

socket.send(new Uint8Array([1, 2, 3]));
socket.close(1000, 'done');
```

### websocket from a client

Useful when you want shared defaults like browser, proxy, or cookies:

```ts
const client = createClient({
  browser: 'chrome_137',
  cookieJar: yourCookieJar,
});

const socket = await client.websocket('wss://example.com/ws');
```

Notes:

- cookies from `cookieJar` are sent during handshake
- duplicate subprotocols are rejected

## 🧪 <a id="networking"></a>networking / transport knobs   ·   [↑](#contents)

This is the "transport nerd" section.

Everything else here is for debugging request shape, fingerprint-sensitive targets, or testing transport hypotheses.

### browser profile + proxy + timeout

```ts
const response = await fetch('https://httpbin.org/anything', {
  browser: 'chrome_137',
  proxy: 'http://username:password@proxy.example.com:8080',
  timeout: 10_000,
});
```

### disable default browser-like headers

By default, `node-wreq` may apply profile-appropriate default headers.

If you want full manual control:

```ts
await fetch('https://example.com', {
  disableDefaultHeaders: true,
  headers: {
    accept: '*/*',
    'user-agent': 'custom-client',
  },
});
```

### exact header order

Use tuples when header order matters:

```ts
await fetch('https://example.com', {
  headers: [
    ['x-lower', 'one'],
    ['X-Mixed', 'two'],
  ],
});
```

### exact original header names on the wire

Use this only if you really need exact casing / spelling preservation:

```ts
await fetch('https://example.com', {
  disableDefaultHeaders: true,
  keepOriginalHeaderNames: true,
  headers: [
    ['x-lower', 'one'],
    ['X-Mixed', 'two'],
  ],
});
```

### lower-level transport tuning

If a browser preset gets you close but not all the way there:

```ts
await fetch('https://example.com', {
  browser: 'chrome_137',
  tlsOptions: {
    greaseEnabled: true,
  },
  http1Options: {
    writev: true,
  },
  http2Options: {
    adaptiveWindow: false,
    maxConcurrentStreams: 64,
  },
});
```

Use these only when:

- a target is still picky after choosing a browser profile
- you are comparing transport behavior
- you want to debug fingerprint mismatches

### compression

Compression is enabled by default.

Disable it if you need stricter control over response handling:

```ts
await fetch('https://example.com/archive', {
  compress: false,
});
```
