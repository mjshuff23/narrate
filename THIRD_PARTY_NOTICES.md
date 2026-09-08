# Third-party notices

This file records the license of every runtime dependency Narrate actually
installs, with the boundary it introduces. It is updated in the same PR that
adds the dependency. Entries are facts about installed components, not
planned ones.

Convention per entry: package, version, license (SPDX where possible), how
Narrate integrates it (imported library, spawned process, downloaded model),
and any model or data artifacts it fetches with their own terms.

## Installed

Runtime dependencies of `@narrate/core` (slice 1). All permissive; imported
as libraries; no model or data artifacts.

| Package        | Version | License | Integration                                     |
| -------------- | ------- | ------- | ----------------------------------------------- |
| `unified`      | 11.0.5  | MIT     | AST pipeline for Markdown and HTML parsing.     |
| `remark-parse` | 11.0.0  | MIT     | Markdown → mdast.                               |
| `remark-gfm`   | 4.0.1   | MIT     | GFM tables, task lists, footnotes, autolinks.   |
| `rehype-parse` | 9.0.1   | MIT     | HTML → hast (parse5 underneath, MIT).           |
| `file-type`    | 22.0.2  | MIT     | Binary signature detection (PDF, DOCX, images). |

Runtime dependencies of `@narrate/server` and `@narrate/web` (slice 2):

| Package     | Version | License | Integration                                       |
| ----------- | ------- | ------- | ------------------------------------------------- |
| `express`   | 5.2.1   | MIT     | Localhost HTTP server.                            |
| `multer`    | 2.3.0   | MIT     | Multipart upload parsing, memory storage, limits. |
| `react`     | 19.2.8  | MIT     | UI.                                               |
| `react-dom` | 19.2.8  | MIT     | UI.                                               |

Dev-only tooling (TypeScript, Vitest, ESLint, Prettier, tsx, Vite, pnpm,
Testing Library, jsdom) is not shipped and not listed.

## Copyleft boundaries to review before any redistribution

Recorded here ahead of installation because they shape the design:

- **PyMuPDF / PyMuPDF Layout** — AGPL-3.0-or-later or Artifex commercial.
  Planned as the PDF extractor, run inside a local Python helper process.
- **Piper (`piper-tts`)** — GPL-3.0-or-later. Optional local TTS tier. Voice
  models carry individual licenses stated in each voice's model card.
- **phonemizer (Python)** — GPL-3.0. Pulled in by `kokoro-onnx` (MIT) for
  grapheme-to-phoneme conversion.
- **eSpeak NG** — GPL-3.0. Bundled via `espeakng-loader` for phonemization.
