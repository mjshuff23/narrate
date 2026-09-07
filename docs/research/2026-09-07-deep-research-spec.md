<!-- Source: GPT Deep Research, commissioned by Michael Shuff, 2026-09-07. Verbatim except for the removal of the research tool's non-resolving inline citation tokens. Decisions in this document are superseded where docs/decisions/0002 says so. -->

# Narrate — Decision-Complete Specification

**Research date:** September 7, 2026
**Target environment:** Windows 11 + WSL2, en-US, single user, TypeScript/React/Node/Vite, local-first, zero recurring cost preferred.

The central recommendation is straightforward: **build Narrate as a localhost React/Vite client plus a small Node backend, use Kokoro locally as the default TTS engine, use PyMuPDF4LLM as the default PDF extractor, and treat cloud TTS as optional provider adapters.** Do not make Web Speech or `edge-tts` the foundation. The backend is justified even for a local-first app because it gives one place for robust PDF extraction, private API-key handling, cancellation, caching, continuous audio encoding, and chaptered MP3 generation.

## Decision summary

| Decision | Recommendation | Why |
|---|---|---|
| **Default TTS** | **Kokoro-82M via `kokoro@0.9.4`, local Python helper** | Zero API cost, private/offline, Apache-licensed package/weights, 82M parameters, 24 kHz output, and the official package demonstrates American English with `af_heart`. |
| **Kokoro default voice** | **`af_heart`, en-US/American-English pipeline** | It is the official package's example American-English configuration; expose voice switching but ship this as the default. |
| **Low-resource local fallback** | **Piper**, optional | Current Piper remains fast/local, but the maintained project is now `OHF-Voice/piper1-gpl`, code is GPL-3.0, and individual voice licenses must be checked. |
| **Best supported cloud option** | **OpenAI `gpt-4o-mini-tts`** | Supported current API, streaming support, good voice quality, simple API. It has a 2,000-token input limit and current published pricing of $0.60/M input text tokens + $12/M output audio tokens. |
| **Enterprise/cloud alternative** | **Azure Speech** | Mature TTS/SSML ecosystem, standard real-time requests limited to 10 minutes of produced audio; batch synthesis supports long-form jobs. Keep optional because private text leaves the machine. |
| **Premium voice option** | **ElevenLabs**, optional | Strong long-form models and explicit cross-chunk context features, but recurring cost and remote processing make it inappropriate as the privacy-first default. |
| **Web Speech API** | **Preview-only fallback, not a conformant Narrate provider** | The standard abstracts over local/server implementations, so "browser TTS" does not guarantee offline processing, and the synthesis API does not expose the generated audio bytes needed for an MP3 export. |
| **`edge-tts`** | **Experimental opt-in only; disabled by default** | `edge-tts@7.2.8` wraps Microsoft Edge's online speech service without an Azure key, but this is not Microsoft's supported Speech developer API. There is no SLA or stable public developer contract for that consumer endpoint. |
| **PDF extraction** | **PyMuPDF4LLM `1.28.2` default; Docling `2.126.0` fallback** | PyMuPDF4LLM directly targets multi-column reading order, tables, header/footer handling and OCR while staying CPU/local. Docling is the heavier fallback for difficult/scanned/layout-rich documents. |
| **PDF licensing** | Accept PyMuPDF4LLM for this personal tool, **document the AGPL boundary prominently** | Current package is AGPL-3.0-or-commercial. Docling code is MIT, though individual model licenses can differ. |
| **Format detection** | **Magic/container evidence → extension → decoded-content heuristics**, with conflict warning | Extensions are hints, not authority. Use `file-type@22.0.2` for binary signatures plus explicit DOCX ZIP inspection; use AST/parser heuristics for Markdown/HTML; plain text is the final default. |
| **Markdown** | **`unified@11.0.5` + `remark-parse@11.0.0` + `remark-gfm@4.0.1`** | Parse into an AST; never strip Markdown with regexes. GFM support covers tables, task lists, autolinks, footnotes and strikethrough. |
| **HTML** | **`rehype-parse@9.0.1`**, converted into the same internal block representation | Preserve document order structurally; remove non-content nodes rather than regex-stripping tags. |
| **Code blocks** | **Omit by default; narrate "Code block omitted."** | Better listening experience; preserve code in source metadata and allow a future "read code" option. |
| **URLs** | **Anchor text only; bare URL becomes "link to {hostname}"** | Query strings, tracking parameters and full paths are generally hostile to narration. Preserve the original URI in metadata. |
| **Tables** | **Narrate small tables row-wise; summarize/omit large tables** | Default threshold: ≤20 rows and ≤6 columns. Larger tables become "Table, N rows by M columns, omitted." |
| **Images** | **Narrate meaningful alt text only** | "Image: {alt text}." Ignore empty/generic alt text and never invent descriptions from filenames. |
| **Chunking** | **Heading/paragraph first, sentences second; provider-specific final enforcement** | First playable chunk ≤500 characters; normal target ≈1,200–1,800 characters. Never break a paragraph unnecessarily; enforce hard provider limits afterward. |
| **Live playback** | **Server produces one continuous encoded audio stream; MediaSource when supported, chunk-buffer fallback otherwise** | A continuous encoder avoids MP3 encoder-delay seams. MediaSource is transport/playback, not the source of truth for final assembly. |
| **Final assembly** | **Normalize provider chunks to PCM; feed one continuous FFmpeg MP3 encoding pass; remux chapter metadata afterward** | Avoid concatenating independently encoded MP3 files. FFmpeg's metadata format supports per-chapter metadata. |
| **Chapter rules** | **H1–H3 become chapters; H4+ are spoken but not indexed** | Prevents a deeply nested document from producing hundreds of unusable chapter stops. |
| **Playback speed** | **0.75×–2.0×, default 1.0×; use media-element playback for pitch-preserving behavior where available** | Keep speed as a playback concern, not a TTS regeneration parameter. |
| **Resume** | **Persist position by generated-job fingerprint every five seconds and on pause/unload** | Restore provider, voice, document hash, and playback offset; do not resume one provider's timeline into another provider's output. |
| **Backend** | **Required for the conformant v1** | Browser-only is technically possible for subsets, but not the recommended solution for robust PDF extraction, cloud secrets, stable MP3 assembly, chapters and local-process TTS. |
| **Persistence** | **No database** | JSON job manifests + local artifact directory + browser `localStorage` for UI/resume settings are sufficient for one user. |
| **Privacy** | **Delete raw uploaded files immediately after successful normalization; retain normalized text/audio locally for seven days by default** | Cloud providers are opt-in and clearly marked "document text leaves this machine." Local Kokoro/Piper never need document text sent over the network after model provisioning. |

## TTS providers, privacy, cost, and licensing

Narrate should define **local/offline as the normal operating mode**, not merely one provider choice. That matters because Web Speech can be backed by a server, `edge-tts` explicitly talks to Microsoft's online Edge service, and every commercial API necessarily sends narration text to that provider. The Web Speech specification intentionally does not require synthesis to be local.

| Engine | Long-form voice quality | Published cost as of Sep. 7, 2026 | Offline/private | Licensing / service status | Recommendation |
|---|---|---|---|---|---|
| **Kokoro-82M** | **High for a lightweight local model; default audition target** | No per-use API charge | **Yes** after model/dependency provisioning | `kokoro@0.9.4` is Apache licensed; project describes Apache-licensed Kokoro weights. 82M parameters. | **Default** |
| **Piper** | Medium; generally more synthetic than Kokoro, but efficient and dependable for local speech | No per-use API charge | **Yes** | Current maintained repo is GPL-3.0. Current `piper-tts` package is 1.8.0; voice licenses vary and must be checked individually. | **Optional local fallback** |
| **OpenAI** | High; current TTS documentation recommends `marin` or `cedar` for best quality | `gpt-4o-mini-tts`: **$0.60/M text-input tokens + $12/M audio-output tokens** | No | Proprietary hosted API; current TTS model limit is 2,000 input tokens. OpenAI requires disclosure that the end-user voice is AI-generated. | **Preferred supported cloud adapter** |
| **Azure Speech** | High, broad voice/language portfolio | Official free tier currently includes **0.5M neural TTS characters/month**. The exact current US pay-as-you-go dollar figure could not be extracted reliably from Microsoft's dynamically rendered pricing page in this research pass; **do not hard-code an amount**. | No | Supported Microsoft Speech service/API with documented quotas and long-form batch synthesis. | **Enterprise alternative** |
| **ElevenLabs** | Very high, especially when voice character is important | Current API pricing documentation lists **$0.10/1K characters** for Eleven v3 / Multilingual v2 and **$0.05/1K characters** for Flash/Turbo. Consumer plans currently start Free $0/10K credits, Starter $6/30K, Creator $22/121K, Pro $99/600K. | No | Hosted proprietary API. ElevenLabs documentation says commercial use requires a paid plan. | **Premium optional adapter** |
| **Web Speech `speechSynthesis`** | Highly browser/OS/voice dependent | No standardized Web Speech API charge | **Not guaranteed** | Standards API, but underlying synthesis can be server-side or local. No standardized API exposes the resulting audio file/stream. | **Preview-only fallback** |
| **`edge-tts`** | Often good because it reaches Edge online neural voices | No published developer-API price because this is not a supported Azure developer product | **No** | `edge-tts@7.2.8`, LGPLv3 wrapper. Its own package describes access to "Microsoft Edge's online text-to-speech service"; supported Microsoft Speech REST usage instead requires an Azure Speech resource/authentication. | **Experimental, opt-in only** |

**Legal/stability conclusion for `edge-tts`:** do not call it "illegal," and do not claim the LGPL license grants rights to Microsoft's service. LGPLv3 governs the wrapper code. The important engineering fact is that Microsoft has not documented the Edge consumer endpoint as the supported Speech developer API, whereas Azure Speech has an authenticated documented REST API. Therefore Narrate should label it **"Unofficial Edge service — compatibility and service terms may change without notice; no SLA."** That is a stability/product-contract conclusion, not legal advice.

### Provider limits Narrate must encode

| Provider/model | Documented service limit | Narrate operational target |
|---|---|---|
| OpenAI `gpt-4o-mini-tts` | **2,000 input tokens**. | Target ≤1,500 tokens; never send >1,900. Provider adapter must measure/re-split. |
| Eleven v3 | **5,000 characters**. | 1,200–1,800 chars |
| Eleven Multilingual v2 | **10,000 characters**. | 1,200–1,800 chars |
| Eleven Flash v2.5 | **40,000 characters**. | 1,200–1,800 chars; do not exploit maximum just because it exists |
| Azure real-time | **10 minutes generated audio/request**. Long-form should use batch if submitting genuinely long requests. | 1,200–1,800 chars |
| Kokoro | No published service quota; generation is local | 1,200–1,800 chars for responsiveness/prosody |
| Piper | No hosted-service quota; local engine | 1,200–1,800 chars |
| `edge-tts` | **No supported/public endpoint limit Narrate should rely on** | Conservative 1,200 chars; adapter retries once after bisecting on endpoint failure |
| Web Speech | No portable standard utterance-size guarantee | ≤1,000 chars per utterance |

The generic target is intentionally well below commercial maximums. Longer requests make first-audio latency worse, make cancellation sluggish, magnify failure retries, and reduce Narrate's ability to align progress and chapters. The exceptions belong in provider adapters rather than contaminating the document chunker.

For ElevenLabs specifically, the adapter should pass the surrounding chunk text through its documented `previous_text`/`next_text` or request-context mechanisms when available; ElevenLabs explicitly exposes those controls to improve continuity across separately synthesized sections.

For OpenAI, use **`gpt-4o-mini-tts` rather than legacy assumptions such as making `tts-1` or `tts-1-hd` the default**. The current official speech guide centers the GPT-4o mini TTS model and supports streaming responses and multiple output formats.

## PDF extraction and reading-order strategy

PDF is the part of this project most likely to make an otherwise polished application feel broken. A PDF usually does **not** contain a semantic sequence comparable to HTML or Markdown. PyMuPDF's own documentation warns that extracted text may not appear in natural reading order because the order in the PDF content stream need not match the visual layout. Basic top-left sorting helps some pages but is not a universal solution.

That is why the recommendation is **not** "use whichever JavaScript PDF parser returns strings."

| Extractor | Reading-order capability | Columns | Header/footer handling | Tables/OCR | Footprint/licensing | Decision |
|---|---|---|---|---|---|---|
| **PyMuPDF4LLM `1.28.2`** | Layout-aware reading-order reconstruction; its extracted word sequence is documented to follow the reconstructed Markdown sequence | Explicit support | Explicitly detects typical repeating header/footer elements and can omit them | Tables; current package also advertises selective OCR | CPU/local, no GPU required by package; **AGPL-3.0 or Artifex commercial license** | **Default** |
| **Docling `2.126.0`** | Advanced layout and reading-order model; unified semantic document representation | Yes | Represents body separately from document "furniture" such as headers/footers | Strong table/OCR pipeline, including scanned PDFs | Heavier ML stack; code MIT, individual models may carry separate licenses | **Fallback quality mode** |
| **PDF.js / JS wrappers such as `unpdf@1.8.1`** | Excellent raw text/rendering foundation, but not a semantic reading-order engine by itself | Requires application heuristics | Application responsibility | Application responsibility | Native JS convenience | **Do not use as Narrate's primary extraction path** |
| **Poppler `pdftotext` 26.09.0** | Useful raw/layout modes and a mature diagnostic fallback, but largely geometry/order driven rather than semantic reconstruction | Limited/layout-dependent | Application responsibility | Separate OCR required | Native CLI | **Diagnostic/fallback only** |
| **MuPDF JS `mupdf@1.28.0`** | Good low-level extraction primitives, but raw MuPDF ordering problems still require higher-level reconstruction | App responsibility | App responsibility | Low-level primitives | AGPL/commercial licensing considerations remain | **Do not substitute for PyMuPDF4LLM solely to remain all-TypeScript** |

### Default PDF pipeline

**First, validate and inspect.** Confirm `%PDF-` signature rather than trusting `.pdf`. Record page count and page geometry.

**Second, run PyMuPDF4LLM in layout-aware mode and request page-level structured output**, including ordered text/words and bounding information rather than throwing away provenance immediately. PyMuPDF4LLM explicitly documents multi-column handling and says its returned word sequence follows the reconstructed reading sequence, including table cells.

**Third, apply cross-page furniture deduplication even if the extractor already handled it.** Narrate should normalize candidate lines in the top and bottom 10% of pages by case/whitespace and replace page-number digits with a placeholder. Suppress a candidate when it appears in equivalent page positions on at least three pages and on at least 60% of eligible pages. Keep the suppressed text in extraction diagnostics. PyMuPDF4LLM itself has header/footer detection, but the deterministic second pass protects the listening experience when that classification misses.

**Fourth, treat dehyphenation conservatively.** PyMuPDF exposes a `TEXT_DEHYPHENATE` extraction/search flag, but ordinary extraction defaults do not universally enable it. Narrate must therefore:

1. Remove Unicode soft hyphens used purely for line breaking.
2. Accept extractor-provided dehyphenation when the layout engine has already resolved it.
3. **Never globally replace `"-\n"` with nothing.** A phrase such as `state-of-\nthe-art` contains a semantically real hyphen.
4. If a visible hard hyphen remains at a physical line boundary and there is no reliable extractor signal, preserve it. False preservation sounds slightly awkward; false removal silently changes words.

This is deliberately conservative. For narration, corrupting a technical term is worse than occasionally hearing a retained hyphenated compound.

### PDF confidence and fallback rules

A PDF is considered **low confidence** and offered to Docling automatically when any of the following occur:

| Signal | Default threshold/action |
|---|---|
| Little/no text layer | Median extracted alphabetic text <20 characters on content-bearing pages → run Docling/OCR |
| Major page image with little extracted text | Run Docling/OCR |
| More than 5% replacement/unknown Unicode characters | Retry via Docling and compare extraction length |
| Detected two-plus-column page but output alternates fragments implausibly between columns | Retry Docling |
| Large tables dominate pages and flatten incorrectly | Retry Docling |
| Rotated/mixed-orientation text produces unusable output | Retry Docling |

If the fallback also produces low-confidence text, **Narrate must stop and show "This PDF could not be reliably converted to reading order" rather than synthesizing garbage**.

Known hard cases remain: sidebars embedded between main-column blocks, footnotes spanning columns, formulas, unusual font encodings, overlapping invisible text/OCR layers, magazines with floating callouts, and PDFs whose creators place glyphs individually. No extractor can infer every author's intended reading order from arbitrary PDF painting commands; that limitation is inherent enough that PyMuPDF documents natural-order recovery as a distinct problem.

The **license decision is deliberate**: for this single-user personal tool, accept PyMuPDF4LLM's AGPL licensing. Put its license in `THIRD_PARTY_NOTICES.md`. If Narrate later becomes distributed or proprietary software, revisit the licensing model before release. The currently published PyMuPDF4LLM package is explicitly dual-licensed AGPL-3.0/commercial.

## Input detection and speakable-text normalization

Narrate should normalize every source into one internal semantic representation before TTS. **TTS providers must never parse Markdown, HTML, PDF, or DOCX themselves.**

The supported v1 source modes are:

| Input | v1 status | Parser |
|---|---|---|
| `.txt` | Required | UTF-decoded text |
| `.md` / Markdown paste | Required | unified/remark |
| `.html` / HTML paste | Required | rehype |
| `.pdf` | Required | PyMuPDF4LLM, Docling fallback |
| `.docx` | Nice-to-have | Route through installed Docling rather than adding a second Word-specific parser; Docling currently supports DOCX. |
| Copy/paste | Required | HTML → Markdown → plain-text content heuristic |

For multiple dropped files, Narrate creates **one narration job in the visible file-list order**. The user can reorder the files before starting. Each source file creates a top-level chapter named from its filename unless the document already begins with an H1, in which case that H1 is used. Paste mode is a separate source mode in v1; do not mix pasted content with a file batch.

### Detection pipeline

The exact precedence is:

```text
bytes / pasted string
        │
        ▼
strong binary signature?
        │
        ├── %PDF- ───────────────► PDF
        │
        ├── ZIP container
        │       └── inspect [Content_Types].xml + word/document.xml
        │             └──────────► DOCX
        │
        ▼
text decoding
        │
        ├── BOM → declared UTF encoding
        └── otherwise valid UTF-8 → UTF-8
        │
        ▼
extension hint
        │
        ▼
HTML structural score
        │
        ▼
Markdown structural score
        │
        ▼
plain text
```

Use **`file-type@22.0.2` only as a binary-signature helper**, not as the whole format classifier. The package is current as of August 2026 and identifies formats from file data, but Narrate still needs structural text heuristics for Markdown/HTML and explicit container validation for Office documents.

Conflict resolution is fixed: **strong byte/container evidence beats filename extension; extension beats a weak text heuristic; a strong parsed text structure beats an extension that merely says `.txt`.** When extension and strong content evidence conflict, Narrate proceeds with the detected format but displays a non-blocking warning such as "`notes.txt` contains HTML and was interpreted as HTML."

For pasted text, there is no extension. HTML wins only when parsing finds meaningful element structure—not merely `<`, `>`, or a code fragment. Markdown needs multiple structural signals or one high-confidence signal such as a fenced block plus normal prose, a heading/list structure, or a valid GFM table. Otherwise the default is **plain text**.

### Common speakable intermediate representation

The normalizer should emit blocks rather than one enormous string:

```text
SpeakDocument
 ├─ metadata
 ├─ source records
 └─ blocks[]
      ├─ heading
      ├─ paragraph
      ├─ list-item
      ├─ quote
      ├─ table
      ├─ image-alt
      ├─ code-omission
      └─ pause
```

Every block retains `sourceId`, source offsets/page where possible, semantic type, optional heading level, and spoken text. This provenance is what makes PDF debugging, chapter generation and future "show me what is being spoken" highlighting possible.

Markdown should use **`unified@11.0.5`, `remark-parse@11.0.0`, and `remark-gfm@4.0.1`**. GFM support currently covers tables, task lists, autolinks, footnotes and strikethrough. HTML should use **`rehype-parse@9.0.1`**. Do not implement either transform with regular-expression tag stripping.

| Element | Mandatory Narrate behavior |
|---|---|
| H1–H3 | Speak heading text; create chapter marker. Do **not** say "heading level two." |
| H4–H6 | Speak heading text with paragraph pause; no chapter marker. |
| Paragraph | Collapse intra-paragraph whitespace; preserve paragraph boundary. |
| Bold / italic / strikethrough | Speak text only. |
| Bullet list | Speak items naturally without saying "bullet." |
| Ordered list | Prefix each item with its ordinal: "One. … Two. …" |
| Task item | Prefix "Checked." / "Not checked." |
| Blockquote | "Quote. … End quote." once around the whole contiguous blockquote. |
| Inline code | Speak token text, with markup/backticks removed. |
| Fenced/indented code block | **"Code block omitted."** Preserve original in metadata. |
| Descriptive hyperlink | Speak link text only. |
| Bare URL | "Link to example dot com." Omit query/hash and usually path. |
| Email address | Speak local part, "at," and domain with dots verbalized. |
| Image with meaningful alt | "Image: {alt}." |
| Image without meaningful alt | Omit silently. Never narrate the filename as an invented description. |
| Horizontal rule | Pause only. |
| Small table | Announce "Table." Then rows as `Header: value; Header: value.` |
| Table >20 rows or >6 columns | "Table, N rows by M columns, omitted." |
| Footnote reference | "Footnote N." Move footnote content to the end of the current section. |
| HTML `script`, `style`, `noscript`, `template`, `form`, `nav` | Omit. |
| HTML `<main>` | Prefer as content root when present. |
| Single dominant `<article>` | Use it when it contains ≥70% of meaningful body text. |
| `<aside>` | Keep meaningful text, prefix once with "Aside." |
| Hidden / `aria-hidden="true"` content | Omit. |
| HTML entity | Decode before narration. |

The code-block rule is especially important. An AI coding agent may be tempted either to drop code silently or to have a TTS voice painstakingly pronounce punctuation. **The default is neither: preserve the fact that code existed while omitting its contents.**

## Chunking, streaming playback, and MP3 assembly

Chunking should happen **after** source normalization, never on raw PDF/Markdown/HTML. The chunker gets semantic blocks and chapters.

The algorithm is fixed:

```text
heading boundary
    ↓
whole paragraphs / list items / table rows
    ↓
pack blocks toward 1,200–1,800 characters
    ↓
oversized paragraph?
    └─ split with Intl.Segmenter("en-US", { granularity: "sentence" })
           ↓
oversized sentence?
           └─ punctuation/whitespace fallback
                  ↓
provider-specific limiter
```

The **first playable chunk should target no more than 500 characters** so narration begins quickly. Later chunks target roughly **1,200–1,800 speakable characters**. A heading always begins a new chunk unless doing so would create a nearly empty chunk; H1–H3 boundaries must be preserved exactly for chapter timing.

`Intl.Segmenter` is preferable to a home-grown period regex because sentence boundaries such as abbreviations and punctuation are not reliably equivalent to `text.split(".")`. The provider adapter then performs its own hard-limit pass, most importantly OpenAI's 2,000-token maximum.

### Audio normalization

Every provider adapter ultimately returns audio to the backend as a format that can be decoded into:

**24,000 Hz, mono, signed 16-bit PCM**

This matches Kokoro's demonstrated 24 kHz output and is more than adequate for spoken-word narration. Providers capable of returning PCM/WAV should request it. Providers that only return practical MP3 output at the user's plan/endpoint level are decoded to PCM once.

Do **not**:

```text
chunk-001.mp3 + chunk-002.mp3 + chunk-003.mp3
```

by simple byte concatenation and call that "seamless." Independently encoded MP3 fragments can contain encoder delay/padding and separate stream headers.

Instead:

```text
TTS chunk
   ↓
decode / normalize
   ↓
PCM chunk
   ↓
ordered PCM queue
   ↓
one long-running FFmpeg encoder
   ↓
continuous MP3 stream
   ├────────► live playback transport
   └────────► temporary complete MP3
                     ↓
              chapter metadata remux
                     ↓
                final .mp3
```

That single encoder is the canonical stitch. It gives the final output one continuous codec timeline.

### MediaSource versus server concatenation

They solve different problems.

**Server-side PCM stitching is mandatory and authoritative.** It produces the downloadable artifact and makes output independent of browser MediaSource support.

**MediaSource is recommended only for progressive in-app consumption of the already continuous encoded stream.** At runtime, feature-test the desired MIME type. If the installed browser does not support it, fall back to playing decoded completed chunks from the client buffer. Do not make correctness of the final MP3 depend on MediaSource.

This also lets the normal `<audio>` playback path own speed changes where possible, instead of regenerating TTS at a different synthesis speed.

### Chapters

Maintain chapter start times from cumulative **post-normalization audio duration**, not estimated text duration.

The final MP3 receives chapter metadata derived from H1–H3. FFmpeg's documented `ffmetadata` format supports per-chapter metadata sections. The final build acceptance test is not "VLC happens to show chapters"; it is:

```text
ffprobe final.mp3
→ returns all expected chapters
→ chapter titles equal normalized H1–H3 titles
→ timestamps are monotonic
→ final chapter end <= media duration
```

Also save chapter information in the Narrate job manifest so in-app chapter navigation never depends on whether a particular player displays MP3 chapter metadata.

### Playback and progress

Playback controls must be:

**play/pause · seek · ±15 seconds · previous/next chapter · 0.75×/1.0×/1.25×/1.5×/1.75×/2.0× · download MP3 · cancel generation**

Progress is **text-weighted rather than chunk-count-weighted**:

```text
synthesisProgress =
  completedSpeakableCharacters / totalSpeakableCharacters
```

A 70-character heading chunk and a 1,700-character paragraph chunk must not each count as "one chunk = one percent unit."

Expose stages separately:

```text
Reading document…
Preparing narration…
Synthesizing 43%…
Finalizing MP3…
Ready
```

Cancellation uses one job-level `AbortController` conceptually. A cancel action must stop new provider requests, abort active requests where the provider supports it, terminate active FFmpeg/helper processes, and leave the job in `cancelled`. Completed local chunks can remain in the job cache for the seven-day retention window so "Resume generation" does not repeat cloud charges.

Default synthesis concurrency is **one chunk at a time**. This is intentionally conservative: it minimizes local RAM/CPU spikes, respects providers that use previous-request context, keeps cancellation simple and reduces cross-chunk voice/prosody variation. Optimization to concurrency two can be added later behind a provider capability flag.

Resume position is saved every **five seconds**, on pause, on chapter jump, and on page unload. The key is:

```text
documentContentHash
+ normalizationVersion
+ providerId
+ providerModel
+ voiceId
+ synthesisSettings
```

Changing voice/provider therefore creates a new playback timeline rather than restoring a timestamp into unrelated audio.

## Architecture and implementation contract

A **backend is required for the complete v1**.

A pure browser implementation could parse Markdown, invoke Web Speech, or even run browser-local Kokoro variants, but Web Speech cannot provide the required downloadable synthesis artifact, browser TTS is not guaranteed offline, cloud API keys must not be embedded in a client, and robust PDF/OCR plus chaptered MP3 assembly is materially cleaner as local processes. The Web Speech specification leaves synthesis implementation local-versus-remote open, and proposals have been needed precisely because standard synthesis output is not available as a capturable media track.

The baseline frontend stack should remain the user's existing stack. **React 19.2.7** was the current React release surfaced in official documentation during this research, and **Vite's current site reports 8.2.2**. Vite 8 moved to Rolldown rather than the older Rollup/esbuild build architecture. For the local HTTP service, **Express 5.2.1** is current in the registry result checked for this report.

### Data flow

```text
┌──────────────────────────────────────────────────────────────────────┐
│ React / Vite UI                                                      │
│                                                                      │
│ Drop files / paste text                                              │
│        │                                                             │
│        ▼                                                             │
│ POST source to localhost                                             │
└────────┬─────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────── Node localhost backend ──────────────────────────┐
│                                                                     │
│ Source intake                                                       │
│   │                                                                 │
│   ├─ content hash                                                   │
│   ├─ format detector                                                │
│   └─ source safety/size checks                                      │
│         │                                                           │
│         ▼                                                           │
│ Extractor adapter                                                   │
│   ├─ txt                                                            │
│   ├─ Markdown AST                                                   │
│   ├─ HTML AST                                                       │
│   ├─ PDF → Python PyMuPDF4LLM helper                                │
│   └─ difficult PDF/DOCX → optional Docling helper                   │
│         │                                                           │
│         ▼                                                           │
│ SpeakDocument semantic IR                                           │
│         │                                                           │
│         ├─ cleanup / boilerplate suppression                        │
│         ├─ chapter creation                                         │
│         └─ speakable-text transform                                 │
│                │                                                    │
│                ▼                                                    │
│ Semantic chunker                                                    │
│                │                                                    │
│                ▼                                                    │
│ TtsProvider                                                         │
│   ├─ Kokoro local ────────────┐                                     │
│   ├─ Piper local              │                                     │
│   ├─ OpenAI cloud            │                                     │
│   ├─ Azure cloud             ├──► normalize to PCM                  │
│   ├─ ElevenLabs cloud        │           │                          │
│   └─ edge-tts experimental ──┘           ▼                          │
│                                     ordered PCM queue               │
│                                           │                         │
│                              ┌────────────┴────────────┐            │
│                              ▼                         ▼            │
│                    continuous live encode       duration/chapter     │
│                              │                   accounting          │
│                              ▼                         │             │
│                       live audio stream                │             │
│                              │                         │             │
│                              └────────────┬────────────┘             │
│                                           ▼                         │
│                                 final MP3 + chapters                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
          │                                      │
          ▼                                      ▼
  MediaSource/audio player                 Download final.mp3
```

The privacy boundary is deliberately obvious: **everything above the provider adapter remains local.** Only a selected cloud provider receives speakable chunks, and the UI must display a persistent cloud badge reading, for example, **"OpenAI — document text will be sent to OpenAI for speech generation."**

### Components

| Component | Responsibility |
|---|---|
| `SourcePicker` | Drag/drop, paste-mode switch, ordering, validation |
| `FormatDetector` | Signature/container/extension/text classification |
| `ExtractorRegistry` | Selects TXT/MD/HTML/PDF/DOCX extractor |
| `PdfExtractor` | PyMuPDF4LLM helper + confidence scoring + Docling retry |
| `SpeakNormalizer` | Produces semantic `SpeakDocument` |
| `ChapterBuilder` | H1–H3/source-file chapter hierarchy |
| `ChunkPlanner` | Semantic chunking independent of providers |
| `ProviderRegistry` | Provider discovery/configuration |
| `TtsProvider` adapters | Model/voice constraints + synthesis |
| `AudioNormalizer` | Provider audio → common PCM |
| `GenerationQueue` | Sequential synthesis, progress, cancellation |
| `LiveEncoder` | Single continuous encoded stream for playback |
| `Mp3Finalizer` | Final artifact + chapter metadata |
| `JobStore` | JSON manifests and local artifacts; no database |
| `Player` | Progressive playback, speed, chapters, resume |
| `PrivacyIndicator` | Local/cloud state visible before synthesis |
| `DiagnosticsPanel` | Detected format, PDF confidence, omitted blocks, provider errors |

### Provider interface sketch — types only

```ts
type ProviderLocality =
  | "offline"
  | "cloud"
  | "browser-implementation"
  | "unofficial-online";

type LimitUnit = "characters" | "tokens" | "audio-duration";

type AudioEncoding =
  | "pcm_s16le"
  | "wav"
  | "mp3"
  | "opus";

interface ProviderInputLimit {
  unit: LimitUnit;
  hardLimit?: number;
  targetLimit: number;
}

interface TtsVoice {
  id: string;
  name: string;
  locale: string;
  gender?: string;
  isLocal?: boolean;
}

interface TtsProviderCapabilities {
  locality: ProviderLocality;
  needsNetwork: boolean;
  needsSecret: boolean;
  nativeStreaming: boolean;
  supportsContext: boolean;
  supportsRateAtSynthesis: boolean;
  outputEncodings: readonly AudioEncoding[];
  inputLimit: ProviderInputLimit;
}

interface SynthesisContext {
  previousText?: string;
  nextText?: string;
  previousRequestId?: string;
}

interface SynthesisRequest {
  text: string;
  locale: "en-US";
  voiceId: string;
  modelId?: string;
  context?: SynthesisContext;
}

interface SynthesizedAudio {
  bytes: Uint8Array;
  encoding: AudioEncoding;
  sampleRate?: number;
  channels?: number;
  providerRequestId?: string;
}

interface TtsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: TtsProviderCapabilities;

  listVoices(signal: AbortSignal): Promise<readonly TtsVoice[]>;

  measureInput(text: string): number;

  synthesize(
    request: SynthesisRequest,
    signal: AbortSignal
  ): Promise<SynthesizedAudio>;
}
```

One architectural rule is particularly important: **`TtsProvider` does not receive files, Markdown or HTML. It receives already normalized speakable text.** That keeps provider swapping genuinely possible.

Web Speech does not fully implement this contract because it does not return exportable audio bytes through the standardized synthesis API. Therefore define it separately as a `PlaybackOnlyProvider`, or explicitly mark `exportableAudio: false`; do **not** fake conformity by recording system output.

### Local storage layout

```text
~/.narrate/
  config.json
  jobs/
    <job-id>/
      manifest.json
      normalized.json
      chapters.json
      chunks/
        0001.pcm
        0002.pcm
      live.mp3
      final.mp3
```

Raw uploads go to a temporary path and are deleted immediately after successful extraction. `normalized.json`, chunks and final audio remain local and expire after **seven days since last access**, unless the user explicitly pins the job. "Clear document" deletes the entire directory immediately.

Credentials belong exclusively to the local backend process environment/configuration. The browser receives only boolean configuration state such as `openaiConfigured: true`, never the secret itself.

### Architecture by provider tier

| Tier | Minimal possible architecture | **Narrate recommendation** |
|---|---|---|
| Web Speech only | Browser-only | Preview fallback only; cannot satisfy full MP3-export contract. |
| Browser Kokoro variant | Browser-only for synthesis/playback | Do not make this v1 default; backend already solves PDF, MP3, chapters and lifecycle more cleanly. `kokoro-js@1.2.1` exists and can run local/browser inference, so it remains a plausible later portability mode. |
| Kokoro Python | Browser + Node + local Python helper | **Default** |
| Piper | Browser + Node + Piper local process/web server | Optional |
| OpenAI/Azure/ElevenLabs | Browser + local backend | Required to protect API credentials and normalize output |
| `edge-tts` | Browser + local backend/Python helper | Experimental only |

## Build plan

The coding agent should receive these as **five independent slices**, in order. A slice is not complete because "the UI looks right"; each has observable acceptance tests.

| Slice | Scope | Definition of done |
|---|---|---|
| **Ingest and normalize text formats** | Drag/drop + paste; detection; TXT/Markdown/HTML; semantic IR; chapter preview; no TTS | Tests prove `.txt` containing HTML is detected as HTML when structural evidence is strong; renamed PDF wins over extension; pasted Markdown headings become chapters; scripts/styles/nav vanish; code becomes "Code block omitted"; descriptive URLs narrate anchor only; bare URLs narrate hostname; image alt rules and table thresholds match this spec. A normalized-text preview lets the user inspect exactly what will be spoken. |
| **PDF quality pipeline** | PyMuPDF4LLM helper, reading-order output, page provenance, furniture suppression, low-confidence detection, Docling retry | Fixture corpus contains at minimum: single column, two columns, repeating headers/page numbers, line-wrap hyphenation, footnotes, table, rotated page and scanned/image-only PDF. Golden tests prove two-column text does not alternate line-by-line between columns; recurring furniture is removed; genuine hyphenated words are not blindly destroyed; scanned PDFs either produce OCR text via fallback or an explicit extraction-quality error. |
| **Offline Kokoro playback** | Provider contract, Kokoro adapter, semantic chunker, first-chunk playback, sequential generation, progress, cancel | With external network disabled **after required model assets are present**, a TXT/MD/PDF can play with `af_heart`; first playback begins before the full document has been synthesized; progress is weighted by speakable characters; Cancel prevents later chunks from being generated; no network request contains document text. Kokoro's package/weights and 24 kHz output are consistent with current project documentation. |
| **Continuous MP3, chapters and resume** | PCM normalization, one continuous encoder, progressive playback transport, final MP3, chapter metadata, playback speed, resume | A 30+ minute fixture generates without audible transport gaps at artificial chunk boundaries. Final file plays independently of Narrate. `ffprobe` reports every expected H1–H3 chapter with monotonic timestamps. Playback speed controls work from 0.75×–2×. Reloading the browser restores the same provider/job and position within ±5 seconds. Cancelling/finalizing never leaves a file labeled `final.mp3` unless it is complete. |
| **Optional provider adapters** | OpenAI, Azure, ElevenLabs, Piper, experimental `edge-tts`, Web Speech preview fallback | Contract tests mock each cloud API and verify limits are enforced before network transmission. Secrets never enter frontend configuration. Cloud providers show an explicit privacy warning before first synthesis. OpenAI rejects/splits >2,000-token input; Eleven limits vary by selected model; Azure never relies on >10-minute real-time output. `edge-tts` is labeled unofficial/experimental and is disabled by default. Web Speech disables Download MP3 rather than pretending it can export synthesis. |

The agent should maintain a fixed **golden narration corpus** throughout all five slices. PDF extraction and speakable-text normalization should be regression-tested independently of TTS so a provider change cannot conceal a document-order regression.

## Package and version baseline

These are the package versions I was able to verify against current official project/registry material during this September 7, 2026 research pass.

| Package/tool | Verified current version/status | Role | Source / note |
|---|---:|---|---|
| `react` | **19.2.7** | UI | Current official React version result checked for this report. |
| `vite` | **8.2.2** | Frontend/build | Current Vite site reports v8.2.2; Vite 8 uses Rolldown. |
| `express` | **5.2.1** | Local HTTP backend | Registry result checked. |
| `file-type` | **22.0.2** | Binary signature helper | Published Aug. 15, 2026. |
| `unified` | **11.0.5** | Markdown AST pipeline | Current npm result. |
| `remark-parse` | **11.0.0** | Markdown parser | Current npm result. |
| `remark-gfm` | **4.0.1** | GFM extensions | Current npm result; compatible with remark-parse 11+. |
| `rehype-parse` | **9.0.1** | HTML parser | Current npm result. |
| `pymupdf4llm` | **1.28.2** | Default PDF extractor | Released Aug. 6, 2026; AGPL-3.0/commercial. |
| `docling` | **2.126.0** | Difficult-PDF/OCR/DOCX fallback | Released Sep. 4, 2026; MIT code, model licenses separate. |
| `kokoro` | **0.9.4** | Default local TTS | Still current release on PyPI; Apache license; Python 3.10–<3.13. |
| `kokoro-js` | **1.2.1** | Possible future browser-local mode | Current npm result checked; not the recommended v1 backend. |
| `piper-tts` | **1.8.0** | Optional local fallback | Current Sep. 4, 2026 PyPI release found in this research; maintained codebase is OHF-Voice `piper1-gpl`. |
| `edge-tts` | **7.2.8** | Experimental provider | Released Mar. 22, 2026; LGPLv3. |
| `unpdf` | **1.8.1** | Evaluated JS PDF alternative, not default | Released Aug. 13, 2026. |
| `mupdf` npm | **1.28.0** | Evaluated JS PDF alternative, not default | Released June 29, 2026. |
| Poppler | **26.09.0** | Diagnostic PDF CLI fallback | Released Sep. 3, 2026. |
| FFmpeg | **Exact latest release not verified** | Continuous MP3 encode/chapter remux | Current official format docs were verified and support per-chapter `ffmetadata`, but this crawl did not yield a trustworthy exact current binary release number. **Capability-test `ffmpeg`/`ffprobe`; do not copy an unverified version pin from this report.** |

Two version decisions deserve explanation.

First, **Kokoro's Python package being "only" 0.9.4 and dated April 2025 is not a typo**; PyPI still reports that as its current official release as of this research date. Do not let an agent invent a newer `kokoro` version because the calendar says 2026.

Second, do not pin Node to an exact patch from this report. I verified Vite's current requirements and version but did **not** obtain a sufficiently reliable current Node patch result in the final source pass. Vite 8's documented baseline is Node 20.19+ or 22.12+, and Narrate should use a currently supported even-numbered Node release satisfying that requirement rather than an invented patch number.

The exact current **Azure US pay-as-you-go standard-neural price** is the other item I could not verify to the standard requested. Microsoft's current official pricing page is dynamically populated; the crawl reliably exposed the 0.5M-character free allowance and high-volume commitment information but not a trustworthy current base PAYG number. Therefore the app must not display a hard-coded Azure cost estimate until runtime/configuration data is verified against Microsoft's current calculator.

## Traps an AI coding agent is likely to get wrong

**Building around Web Speech because "the browser already has TTS."** That misses the output requirement. `speechSynthesis.speak()` plays a voice but the standard API does not give Narrate an audio artifact it can simply save as MP3, and the standard explicitly permits server-backed implementations. It is neither a guaranteed-private TTS engine nor a downloadable-audio pipeline.

**Treating `edge-tts` as "free Azure Speech."** It is not the Azure developer API. The package explicitly describes itself as accessing Edge's online TTS service, while supported Microsoft Speech REST uses Azure authentication/resources. Make it experimental and do not promise commercial-service stability merely because the wrapper is LGPL.

**Using stale `edge-tts` package versions.** Current verified release is **7.2.8**, not the commonly cached 6.x or 7.2.3 values an older coding model may remember.

**Defaulting OpenAI to old TTS assumptions.** The current official TTS path is `gpt-4o-mini-tts`; its model page specifies a 2,000-token context/input limit and current TTS pricing. An agent trained on 2024-era examples may automatically choose `tts-1` or `tts-1-hd`. Do not let stale snippets set the architecture.

**Assuming ElevenLabs has one universal character limit.** It does not. Current docs list 5,000 for Eleven v3, 10,000 for Multilingual v2 and 40,000 for Flash v2.5, among other variants. Limits belong in model/provider capabilities.

**Sending a whole book to Azure's real-time TTS endpoint.** Current Azure documentation sets a 10-minute produced-audio limit per real-time request and recommends batch synthesis for longer material. Narrate's own small semantic chunks stay comfortably away from this boundary.

**Using the archived/old Piper identity.** The current project to track is **`OHF-Voice/piper1-gpl`**, not blindly wiring against old `rhasspy/piper` assumptions. The current code is GPL-3.0 and the project explicitly points users to `pip install piper-tts`.

**Assuming Piper's code license covers every voice.** Piper's model documentation requires checking individual voice model cards because licenses can differ. A provider installer must record a selected voice's license metadata rather than declaring "Piper voices are GPL."

**Assuming PyMuPDF4LLM is MIT because many Python extraction tools are permissively licensed.** Current package metadata says **AGPL-3.0 or Artifex commercial license**. That is acceptable for the stated personal use case, but it is a real future distribution decision.

**Assuming Docling's MIT code makes all of its models MIT.** Docling explicitly says individual model licenses must be checked separately.

**Using raw PDF text order.** PDF content-stream order and intended reading order are not equivalent. A plain `getTextContent()`/raw-word extraction can read a two-column paper across both columns line by line, inject running headers every page, or place text added later by an editor at the end. PyMuPDF itself documents the natural-order problem; that is why the higher-level layout extractor is part of the spec.

**Solving PDF columns with a single global `sort(y, x)`.** That works only on simple layouts. Use PyMuPDF4LLM's multi-column reconstruction and retain coordinates/provenance so failures can be detected. Its API specifically says extracted word ordering follows reconstructed multi-column/table order.

**Blindly replacing every `-\n`.** MuPDF has explicit dehyphenation machinery precisely because line-break hyphenation is not equivalent to every visible hyphen. Preserve genuine compounds unless the extractor can establish a soft/discretionary break.

**Regex-stripping Markdown or HTML.** This destroys semantic information required for chapters, tables, links, image alternatives, blockquotes and code. Parse into ASTs with the verified remark/rehype packages, then transform nodes deliberately.

**Narrating source code by default.** TTS engines are poor code readers and punctuation-heavy code destroys listening flow. The required default is "Code block omitted," with source retained for an optional future read-code mode.

**Speaking complete URLs.** Query strings, UUIDs and tracking parameters can turn one hyperlink into a minute of nonsense. Speak descriptive anchors; for bare links speak the hostname and retain the original URL only in metadata.

**Flattening every table into prose.** A 40×12 table can consume enormous TTS time while conveying almost no navigable meaning. Enforce the explicit small-table threshold and summarize larger structures.

**Concatenating independently encoded MP3 byte arrays.** Treat the generated material as PCM first, then run one continuous encoder. Otherwise transport seams, encoder padding and inconsistent headers can appear at every chunk boundary.

**Using MediaSource as the final assembly format.** MediaSource is a browser delivery mechanism, not the durable artifact builder. Final correctness belongs to server-side PCM ordering + continuous encode. Runtime MIME capability should be feature-tested rather than assumed.

**Estimating chapter timestamps from character count.** Different punctuation, voices and TTS engines speak at different rates. Chapter timestamps must come from actual accumulated synthesized audio durations.

**Counting chunks for progress.** Chunks are intentionally unequal. Progress must be based on completed speakable text weight, not `completedChunks / totalChunks`.

**Launching all TTS chunks in parallel because it looks faster.** That complicates cancellation, burns local memory, can hit service rate limits, and defeats providers such as ElevenLabs that expose context between adjacent requests. Start with concurrency one.

**Leaking provider keys into the frontend.** Cloud provider calls belong behind the localhost Node service. The browser should never need OpenAI, Azure or ElevenLabs credentials.

**Assuming "local-first" means "browser-only."** A localhost Node/Python pipeline is still fully local. For Narrate, a local backend materially improves privacy control because files, normalized text, credentials, extraction and audio assembly remain on the user's machine unless a cloud TTS provider is deliberately selected.

**Forgetting that models may download on first use.** "Offline" means synthesis works without network **after assets are provisioned**. The UI should have an explicit "Install local voice/model" state rather than discovering a multi-hundred-megabyte download only after the user presses Play.

**Letting OCR failure silently become TTS.** Low-confidence PDF extraction must surface as an extraction error/fallback event. A confident voice reading words in the wrong order is worse than a visible "could not reliably extract this PDF."

**Using Vite-era build assumptions from 2024/2025.** Current Vite is 8.2.2 and Vite 8 moved its build stack to Rolldown; old instructions around Vite's prior esbuild/Rollup internals can be stale. Vite's migration documentation also identifies older `optimizeDeps.esbuildOptions` configuration as deprecated in favor of Rolldown equivalents.

**Inventing newer package versions because the verified package seems "too old."** `kokoro@0.9.4` really is the current PyPI release found on September 7, 2026, while fast-moving Docling is already `2.126.0` and PyMuPDF4LLM is `1.28.2`. The coding agent should use registry-verified versions, not infer version numbers from calendar age.

The resulting v1 should therefore have a very specific character: **a boring localhost web application whose normal path is fully private—document → robust semantic extraction → Kokoro → continuous MP3—with cloud voices available only as explicit interchangeable upgrades.** The sophisticated work belongs in document normalization, reading-order recovery, provider boundaries and audio continuity, not in a large application framework.
