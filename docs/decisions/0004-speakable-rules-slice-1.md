# 0004 — Speakable-text rules the spec left open

Date: 2026-09-07. Slice 1.

## Context

The element table in the research report decides most of what is spoken.
Implementing it surfaced cases it did not cover and two places where the
literal wording would sound wrong. These are the calls made, so they can be
reviewed as decisions rather than discovered as behavior.

## Decisions

| Case                                               | Rule                                                                                          | Why                                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Footnote reference in running text                 | `…claim footnote one and more…` (lowercase, no period)                                        | The spec's "Footnote N." mid-sentence produces a hard stop inside the sentence. The body still opens with "Footnote one." at the section end, so the pairing is audible.                                           |
| Footnotes never referenced                         | Spoken at the very end of the document, numbered after the referenced ones                    | Better than losing them; they were written to be read.                                                                                                                                                             |
| Heading text                                       | Terminal punctuation added if missing (`Lists.`)                                              | Voices run a bare heading straight into the next sentence. Chapter titles in the manifest use the raw text, not this.                                                                                              |
| Inline image with meaningful alt inside a sentence | `Image: {alt}.` inserted inline                                                               | Same rule as standalone images; the alternative (silently dropping mid-sentence images) hides content.                                                                                                             |
| Plain-text line of only `-`, `=`, `*` or `_` (3+)  | Pause                                                                                         | Plain text has no other way to mark a section break.                                                                                                                                                               |
| Plain text                                         | Bare URLs and emails get the same spoken forms as in Markdown                                 | Consistency; a pasted email address should never be spelled out.                                                                                                                                                   |
| HTML `<header>` / `<footer>`                       | Kept (transparent containers)                                                                 | The spec lists only `nav`, `form`, `script`, `style`, `noscript`, `template` as drops. Site chrome usually sits outside `<main>` anyway, which is preferred as the root. Revisit if real pages read footers aloud. |
| HTML content root                                  | `<main>` → single `<article>` with ≥70% of body text → `<body>`                               | Per spec.                                                                                                                                                                                                          |
| HTML drop diagnostics                              | Counted across the whole document, not just the content root                                  | The user should learn that a `<script>` in `<head>` was dropped even though it never would have been read.                                                                                                         |
| Document title                                     | First H1, else HTML `<title>`                                                                 | The manifest needs a name; the H1 is what a reader would call it.                                                                                                                                                  |
| Markdown indented code (4 spaces)                  | Treated as code (omitted) inside a `.md` file; **not** counted as a Markdown detection signal | It is code by the CommonMark spec, but pasted plain text with indentation must not be misdetected as Markdown because of it. Only fenced blocks count for detection.                                               |
| `.md` extension                                    | Always Markdown, even with no markup                                                          | Markdown is a superset of plain text; nothing is lost.                                                                                                                                                             |
| Table with no header row                           | Rows spoken as `cell; cell.` without labels                                                   | HTML tables often lack `<thead>`.                                                                                                                                                                                  |
| Table threshold                                    | >20 body rows or >6 columns → `Table, N rows by M columns, omitted.`                          | Per spec; header row excluded from the count.                                                                                                                                                                      |
| Ordinals and footnote numbers                      | Words up to 999 (`forty-two`), digits beyond                                                  | Avoids "1." being read as a decimal by some voices.                                                                                                                                                                |
| Space before punctuation after inline substitution | Removed (`Link to x dot io.` not `… io .`)                                                    | Substitutions are padded with spaces to avoid gluing to neighbours; the collapse pass cleans the seam.                                                                                                             |
| Synthetic per-file chapter headings                | Only when a batch has more than one source                                                    | A lone pasted text or file would otherwise open with a spoken "Pasted text one." that names nothing the listener needs. (Added in slice 2.)                                                                        |
| `.txt` claiming `.pdf` / `.docx`                   | Text is interpreted; warning recorded                                                         | Extension is a hint, never authority.                                                                                                                                                                              |

## Consequences

- `NORMALIZATION_VERSION` is 1. Any change to these rules that alters spoken
  output bumps it, because it is part of the resume key.
- The golden snapshots in `packages/core/test/__snapshots__` are the
  executable form of this table. A snapshot change in a PR is a rule change
  and should be called out as one.
