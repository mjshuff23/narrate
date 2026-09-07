# Narrate

A local-first web tool that turns documents into listenable audio.

Drop a file (`.md`, `.txt`, `.pdf`, `.html`) or paste text. Narrate detects the
format, normalizes it into clean speakable text with reading order preserved,
and produces streamed in-app playback plus a downloadable, chaptered MP3.

Single user. Runs on your own machine. The default path never sends document
text over the network.

## Status

Pre-alpha. Nothing runs yet. The spec is decided; the build is proceeding in
small, independently verified slices, one branch and PR each.

## Design in one paragraph

Every input is parsed into a semantic intermediate representation (blocks:
headings, paragraphs, lists, quotes, tables, image alt text, code omissions),
never regex-stripped. That representation is chunked on heading and paragraph
boundaries, synthesized one chunk at a time by a swappable TTS provider, and
normalized to PCM. One continuous encoder turns the PCM into a single MP3 with
chapter markers derived from headings. Reading-order recovery for PDFs and
seamless long-document stitching are where the real work is; the form is
trivial.

## Stack

TypeScript, React, Vite, Node (ESM, pinned to the active LTS via `.nvmrc`),
with a small local Python helper for PDF extraction and local text-to-speech.
Cloud TTS engines are optional adapters behind the same provider interface and
are clearly labeled when document text would leave the machine.

## Principles

- **Local by default.** Offline synthesis is a requirement, not a tier.
- **Never narrate garbage.** If a PDF cannot be reliably read in order, say so.
- **Provider swapping is one file.** No engine parses documents; engines get
  speakable text.
- **Real verification.** Drag-and-drop is tested with an actual file drop.
  Generated audio gets listened to.

## License

Narrate's own code is MIT (see `LICENSE`). That license covers the source in
this repository and nothing else.

Several planned dependencies carry their own terms, which apply to those
components regardless of this file: PyMuPDF and PyMuPDF Layout are dual-licensed
AGPL-3.0 or Artifex commercial; Piper, phonemizer, and eSpeak NG are GPL-3.0.
Whether and how those terms reach code that calls them depends on how the
components are integrated and on how the software is used or distributed, which
this README does not attempt to settle. `THIRD_PARTY_NOTICES.md` records each
dependency's license as it is actually added, so the boundary can be reviewed
before any redistribution or network-served deployment.
