# Third-party notices

This file records the license of every runtime dependency Narrate actually
installs, with the boundary it introduces. It is updated in the same PR that
adds the dependency. Entries are facts about installed components, not
planned ones.

Convention per entry: package, version, license (SPDX where possible), how
Narrate integrates it (imported library, spawned process, downloaded model),
and any model or data artifacts it fetches with their own terms.

## Installed

_No runtime dependencies have been added yet._

## Copyleft boundaries to review before any redistribution

Recorded here ahead of installation because they shape the design:

- **PyMuPDF / PyMuPDF Layout** — AGPL-3.0-or-later or Artifex commercial.
  Planned as the PDF extractor, run inside a local Python helper process.
- **Piper (`piper-tts`)** — GPL-3.0-or-later. Optional local TTS tier. Voice
  models carry individual licenses stated in each voice's model card.
- **phonemizer (Python)** — GPL-3.0. Pulled in by `kokoro-onnx` (MIT) for
  grapheme-to-phoneme conversion.
- **eSpeak NG** — GPL-3.0. Bundled via `espeakng-loader` for phonemization.
