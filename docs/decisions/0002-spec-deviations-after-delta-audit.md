# 0002 — Spec deviations after the delta audit

Date: 2026-09-07. Before slice 1 code was written.

## Context

The blueprint is the Deep Research report in `docs/research/`. A second
reviewer (Claude, this repo's coding agent) verified its package names,
versions, licenses and claims against the registries and by running commands,
then challenged nine seams in a follow-up prompt. GPT's delta audit answered.
This record fixes which of the original decisions are now overturned and
which reviewer findings stand, so the build follows one spec, not three.

## Decisions

**Overturned from the original report (accepted from the delta audit):**

1. **Local TTS default is `kokoro-onnx` (INT8 first), not the PyTorch
   `kokoro` package.** Verified from source: 510-phoneme ceiling, 24 kHz
   output, eSpeak NG loaded from the bundled `espeakng-loader`, so no system
   eSpeak install. Repo is MIT. The PyTorch package (torch + transformers,
   ~1 GB CPU install) becomes the quality reference for the bake-off only,
   installed in a throwaway environment, never in the project one.
   **The choice is provisional until measured on this machine**: warm
   realtime factor, first-sentence latency, peak RSS, blind listening
   against ONNX FP32 and the PyTorch reference. If INT8 loses audibly, move
   to ONNX FP32 before retreating to PyTorch. `kokoro-js` in Node is the
   second candidate in the bake-off, not a browser-only curiosity.
2. **Docling is opt-in, not an automatic fallback.** Ladder: PyMuPDF4LLM
   Layout → heuristic quality check → optional RapidOCR (Apache-2.0, ONNX)
   → explicit "enhanced extraction" install of `docling-slim` extras. Full
   `docling` pulls PyTorch and is never part of the default environment.
   The reviewer's premise that both OCR routes need Tesseract was wrong;
   RapidOCR needs no system binary.
3. **Live playback is a plain `<audio src>` over a progressively streamed
   MP3, not MediaSource.** Firefox is believed to reject `audio/mpeg` under
   MSE (the delta audit's citation for this is a webcompat site report, not
   a platform document, so this is believed rather than verified). The
   decision stands regardless on simplicity: no codec negotiation at all.
   Seeking during generation is limited to `audio.seekable`; the finished
   `final.mp3` is served with `Content-Length` and byte ranges.
4. **Kokoro chunks are bounded in phonemes, not characters.** First
   playable chunk 150–250 phonemes, normal 350–450, hard app max 500,
   engine ceiling 510. The generic 1,200–1,800 character target stays for
   cloud adapters. Consequence for the provider interface: `measureInput`
   becomes async, because phoneme counting happens in the Python helper.

**Tightened, not overturned:**

- PyMuPDF4LLM 1.28.2 hard-depends on `pymupdf_layout` (ONNX, CPU-only,
  ~215 MB across wheels, same AGPL/commercial dual license, PyPI classifier
  says "Other/Proprietary" — read the model terms at slice 3). Canonical
  call: `use_layout(True)` explicitly, `page_chunks=True`, `header=False`,
  `footer=False`, `use_ocr=False` for the text-PDF pass. `extract_words`
  requires Layout off, so word coordinates are a separate diagnostic pass.
  Dehyphenation: no parameter exists on `to_markdown`; the conservative
  post-layout pass from the original report stands and is validated on the
  fixture corpus, not assumed.
- MP3 stays the download format; no M4B in v1. Pocket Casts (iOS and
  Android) and Apple Podcasts read MP3 ID3 chapters; Pocket Casts Android
  does not read the Apple M4A chapter format. In-app navigation from the
  job manifest remains authoritative; MP3 chapter frames are a bonus.
- OpenAI `gpt-4o-mini-tts` stays the preferred cloud adapter with **two**
  limits enforced: 2,000 input tokens and 4,096 input characters, whichever
  binds first (for English, the character limit).
- Azure PAYG price stays deliberately unresolved. Resolve against the Retail
  Prices API for the chosen region at implementation time; never hard-code.

**Findings both reports missed (reviewer):**

- `phonemizer` (Python) is GPL-3.0 and eSpeak NG is GPL-3.0. The "MIT"
  `kokoro-onnx` default is MIT code over two GPL components. Recorded in
  `THIRD_PARTY_NOTICES.md`.
- FFmpeg cannot back-patch the Xing/Info header when writing MP3 to a pipe,
  so the live stream has no duration. The final file must be a separate
  write (or remux) so its header is correct, and the player must tolerate
  unknown duration during generation.
- FFmpeg 6.1 on this machine **does** write MP3 chapters (ID3v2.3 and 2.4)
  and ffprobe reads them back. The original report's open item is closed.

## Consequences

- Slice 3 (PDF) and slice 4 (local TTS) each open with a measurement, not an
  install: the fixture corpus for PDF, the engine bake-off for TTS.
- The provider interface sketch changes in one place (`measureInput` async)
  before any adapter is written.
- Cloud pricing is re-verified in the cloud-adapter slice, not before.
