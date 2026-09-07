# 0003 — Workspace layout and the core package

Date: 2026-09-07. Slice 1.

## Context

The working rule is colocation by default and extraction only on
demonstrated reuse. Slice 1 needed a home for the semantic intermediate
representation and the normalizers before a server or a web client exists.

## Decision

pnpm workspace:

```text
packages/core     @narrate/core — pure library: types, detector, normalizers, renderer.
apps/server       (slice 2) Express + Python helper orchestration.
apps/web          (slice 2) React/Vite client.
```

`@narrate/core` exports TypeScript source directly (`"exports": "./src/index.ts"`);
no build step inside the workspace. Node-only APIs it uses today:
`node:crypto` for content hashes and `TextDecoder` encodings that need full
ICU (Node ships it).

## Why

The core package earns extraction on day one because it has two consumers by
design: the server runs it, and the web client imports its types for the
document and manifest shapes. That is the "second use". Putting it in the
server package would force the client to import from a server package for
types, which is the wrong dependency direction.

It contains no I/O beyond hashing so it can be tested in isolation, which is
what makes slice 1 independently verifiable: 61 tests, no UI, no TTS.

## Consequences

- Provider adapters, the chunker and the job store do **not** automatically
  belong in core. Each goes in the server until something else needs it.
- If the web client ever needs to run detection or normalization in the
  browser (e.g. paste preview without a round trip), the `node:crypto` and
  `file-type` dependencies would need browser-safe alternatives. Not planned.
