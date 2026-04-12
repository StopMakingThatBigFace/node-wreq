# Architecture Overview

## Request Flow

```
┌─────────────────────────────────────┐
│  JavaScript/TypeScript Code         │
│  fetch(url, init) / createClient()  │
└──────────────┬──────────────────────┘
               ↓
┌──────────────────────────────────────┐
│  TypeScript Wrapper (index.ts)       │
│  - Validate inputs                   │
│  - Convert to options object         │
└──────────────┬───────────────────────┘
               ↓ (Neon N-API)
┌──────────────────────────────────────┐
│  Rust Native Module (lib.rs)         │
│  - Parse JS objects                  │
│  - Call Rust client                  │
│  - Convert response back to JS       │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│  Browser Client (client.rs)          │
│  - Select browser profile            │
│  - Build HTTP request                │
│  - Apply headers & options           │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│  wreq HTTP Client                    │
│  - Impersonate browser               │
│  - Custom TLS handshake              │
│  - HTTP/2 frame ordering             │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│  BoringSSL (TLS)                     │
│  - Chrome-like cipher suites         │
│  - Exact TLS extensions              │
│  - JA3/JA4 fingerprint matching      │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│  HTTP/2 Implementation               │
│  - SETTINGS frame (browser-specific) │
│  - PRIORITY streams                  │
│  - Header ordering                   │
└──────────────────────────────────────┘
```

## Performance Tuning

### Connection Reuse

The client automatically reuses connections (HTTP/2 keep-alive).

### Parallel Requests

```ts
// Good: parallel requests
const [res1, res2, res3] = await Promise.all([
  fetch(url1),
  fetch(url2),
  fetch(url3),
]);

// Slower: sequential requests
const res1 = await fetch(url1);
const res2 = await fetch(url2);
const res3 = await fetch(url3);
```

## References

- [wreq GitHub](https://github.com/0x676e67/wreq)
- [BoringSSL](https://boringssl.googlesource.com/boringssl/)
- [JA3 Fingerprinting](https://github.com/salesforce/ja3)
- [HTTP/2 RFC](https://httpwg.org/specs/rfc7540.html)
- [Neon Bindings](https://neon-bindings.com/)
