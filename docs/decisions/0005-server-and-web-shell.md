# 0005 — Server and web shell

Date: 2026-09-07. Slice 2.

## Context

Slice 1 produced a library. Slice 2 puts a browser in front of it so files
can be dropped, pasted text can be submitted, and the speakable text can be
reviewed before any audio exists. The spec requires a backend; the question
was how small the first one could be while still being the shape the later
slices need.

## Decision

- **Express 5 on 127.0.0.1 only.** One route matters: `POST /api/normalize`
  accepts multipart `files` parts in user order, or JSON `{ text }`, and
  returns the `SpeakDocument`, a per-source result list, and the rendered
  spoken segments in one body. Health check at `GET /api/health`.
- **Multer with memory storage and hard limits** (25 MB per file, 20 files,
  5 MB of pasted JSON). Over-limit requests get 413 with a code; malformed
  JSON gets 400. No file is written to disk in this slice.
- **Per-source failure never sinks the batch.** A PDF (not yet supported)
  or a PNG (never supported) is reported in `results` with a code; the other
  sources still normalize.
- **Vite dev server proxies `/api`** so the browser sees one origin and no
  CORS exists. In production the server serves `apps/web/dist` if present.
- **No UI library, no CSS framework.** Plain React 19 with hand-written CSS
  variables, `prefers-color-scheme` dark mode, and one 480 px breakpoint.
  Touch targets are 44 px. The drop zone is a keyboard-operable button.
- **Synthetic chapter headings only for multi-source batches** (see 0004).
- **Verification is two-tier.** jsdom tests cover wiring (drop handler,
  ordering, multipart body, error display). The gate is Chrome: real
  pointer clicks for reorder, submit and tab switching, a `DragEvent`
  carrying real `File` objects dispatched on the zone, keyboard submit via
  Tab and Enter, and a 390 px iframe for the phone layout because Chrome on
  Windows refuses to shrink a window below roughly 500 px.

## Why

- Loopback binding is the privacy boundary made physical. Reaching Narrate
  from a phone on the LAN is a real future feature and a deliberate decision
  about exposure, not a default.
- Returning spoken segments from the server keeps the browser free of the
  core package at runtime. The client imports only its types.
- Multer is the boring choice for Express multipart; its limits are the
  request-size gate. Streaming to disk arrives with PDFs, which are large.
- A 390 px iframe triggers the same media queries as a phone viewport. The
  first "mobile" screenshot in this slice was actually 1024 CSS px because
  of the window minimum and a 1.5 device pixel ratio; the iframe measurement
  is what caught a phantom grid column that the desktop fix had introduced.

## Consequences

- Slice 4 adds job state, so `POST /api/normalize` becomes the intake step
  of a job rather than the whole request. The response shape is designed to
  survive that: `document`, `results`, `spoken`.
- ESLint runs without a React plugin. Add `eslint-plugin-react-hooks` when a
  hooks mistake actually costs time, not before.
- Browser automation is not part of CI. The browser gate is run per PR, by
  hand or by the coding agent's browser, and the evidence goes in the PR.
