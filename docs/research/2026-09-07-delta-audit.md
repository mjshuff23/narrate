<!-- Source: GPT (non-deep-research follow-up), commissioned by Michael Shuff, 2026-09-07, answering the reviewer prompt that challenged nine seams of the Deep Research spec. Verbatim; reference URLs stripped of tracking parameters. The reviewer's assessment of this audit, including the two pins it overrules (TypeScript 7, Vitest 5) and a weak citation (item 6, Firefox), is in docs/decisions/0001 and 0002. -->

# Narrate follow-up: decision delta audit

I treated the prior report as the baseline and only re-opened the challenged seams. The largest changes are: **switch the default local TTS from PyTorch Kokoro to `kokoro-onnx`, stop auto-installing Docling, replace MP3 MediaSource playback with ordinary progressive `<audio>`, and shrink Kokoro-specific chunks based on phonemes rather than characters.**

## 1. Local TTS engine choice

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **`kokoro` 0.9.4 / PyTorch:** highest-confidence reference implementation, but too fat for the default Narrate runtime. Its dependency tree includes `torch`, `transformers`, and `misaki[en]`; the English stack also brings NLP/phonemization dependencies. Your reviewer's roughly 1 GB CPU environment measurement is believable, but **upstream does not publish an authoritative installed-size figure**. The model pipeline's effective phoneme ceiling is ~510 and it segments arbitrary input. Exact i9-9900K CPU RTF is **not published, so I will not invent one**. ([GitHub][1]) | PyPI/upstream package and pipeline. ([PyPI][2]) | **Do not use as v1 default. Keep it as the quality-reference adapter and fallback for A/B testing.** |
| **`kokoro-onnx` 0.6.1:** strongest fit for Narrate. Current project supplies roughly **310 MB FP32, 169 MB FP16, and 88 MB INT8** model variants. It has a hard `MAX_PHONEME_LENGTH = 510`; its splitter prefers sentence, then clause, then word boundaries before falling back to harder splits. It can asynchronously yield audio as internal batches complete. ([GitHub][3]) | Current repo/package is active, with 0.6.1 released August 2026. PyPI's missing license field is misleading: the repository itself carries MIT licensing, while the Kokoro model is Apache-2.0. ([PyPI][4]) | **New default: `kokoro-onnx@0.6.1`, initially with the INT8 model.** It gives the best boring-engineering ratio: Python is already present for PDF work, no Torch stack, much smaller model, streaming batches, explicit long-input behavior. |
| **Phonemization for `kokoro-onnx`:** it imports `espeakng_loader` and uses the bundled eSpeak NG library/data; it falls back to a system eSpeak installation only if bundled loading fails. So your current lack of system `espeak-ng` is **not a blocker**. ([GitHub][5]) | Current tokenizer implementation. ([GitHub][5]) | **Do not add an OS-level eSpeak dependency for v1.** Treat bundled loading failure as a diagnostics error. |
| **`kokoro-js` 1.2.1 in Node:** viable, and much more interesting than the original report gave it credit for. It supports FP32, FP16, Q8 and smaller quantized variants through Transformers.js, plus streamed text splitting/audio generation. The related `phonemizer` package is self-contained and uses eSpeak NG without requiring a separately installed binary. ([npm][6]) | npm/upstream. Available model files are roughly 326 MB FP32, 163 MB FP16 and ~92 MB Q8. ([Hugging Face][7]) | **Keep as the second local implementation to benchmark, not the default.** All-Node is architecturally attractive, but it buys little because Narrate already needs Python for PyMuPDF4LLM. |
| **Quantization quality:** I found qualitative claims that Kokoro tolerates quantization well, but **no current official MOS, ABX, pronunciation-error, or prosody benchmark comparing FP32/PyTorch vs FP16/Q8** for these particular exports. Any exact audible-quality claim would be invented. | The repositories expose the model variants, not a quantitative listening study. ([GitHub][8]) | **Start INT8, but make the choice empirical.** Blind-test INT8 against ONNX FP32 and PyTorch before locking it. |
| **CPU RTF on i9-9900K:** exact values for all three implementations are **unverified**. `kokoro-onnx` reports near-real-time behavior on Apple M1, which is not a valid conversion into a Coffee Lake RTF number. ([GitHub][3]) | No authoritative Coffee Lake benchmark found. | **Benchmark on the actual box before Slice 3 is accepted.** No synthetic performance number goes into the spec. |

### The measurement that can overturn `kokoro-onnx`

Use the same 20 to 30 passage corpus across PyTorch FP32, ONNX FP32, ONNX INT8, and Node Q8. Measure:

* cold model load
* first sentence latency
* steady-state RTF
* peak RSS
* total environment + model disk footprint
* pronunciation errors
* seam/prosody quality
* blind preference

My **project acceptance target**, not an upstream fact:

> Keep ONNX INT8 as default if warm RTF is ≤0.8, first playable sentence ≤1 second, peak RSS <1 GB, and blind listening does not prefer the PyTorch reference by more than about 10 percentage points.

If INT8 loses audibly, **move to ONNX FP32 before retreating to PyTorch**.

**Confidence: 🟢 architecture and dependency choice; 🟡 performance until measured.**

---

## 2. PyMuPDF4LLM 1.28.2 exact PDF API

The current signature is:

```text
to_markdown(
  doc,
  *,
  detect_bg_color=True,
  dpi=150,
  embed_images=False,
  extract_words=False,
  filename=None,
  fontsize_limit=3,
  footer=True,
  force_ocr=False,
  force_text=True,
  graphics_limit=None,
  hdr_info=None,
  header=True,
  ignore_alpha=False,
  ignore_code=False,
  ignore_graphics=False,
  ignore_images=False,
  image_format="png",
  image_path="",
  image_size_limit=.05,
  margins=0,
  ocr_dpi=300,
  ocr_function=None,
  ocr_language="eng",
  page_chunks=False,
  page_height=None,
  page_separators=False,
  page_width=612,
  pages=None,
  show_progress=False,
  table_strategy="lines_strict",
  use_glyphs=False,
  use_ocr=True,
  write_images=False
)
```

The documentation itself currently has an inconsistency: the **signature says `ocr_dpi=300`**, while descriptive prose on the same page says the default is 400. That is a docs defect worth pinning in a regression test instead of assuming. ([PyMuPDF][9])

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Multi-column reading order:** there is no `multi_column=true` switch. `pymupdf4llm.use_layout(True)` is the current default, and the docs describe Layout as the optimal page-analysis path. ([PyMuPDF][9]) | Official PyMuPDF4LLM API. | **Call `use_layout(True)` explicitly at process initialization**, even though it defaults on, so a future default change cannot silently alter Narrate. |
| **Header/footer suppression:** `header` and `footer` both default to `True`, meaning include them. | Official signature/docs. ([PyMuPDF][9]) | **Pass `header=False, footer=False` for narration extraction.** Keep your separate cross-page furniture heuristic as diagnostics, not as the primary suppression system. |
| **Per-page provenance:** `page_chunks=True` returns structured page objects with `page_boxes`; box classes include `text`, `picture`, `table`, `title`, `section-header`, `page-header`, `page-footer`, `list-item`, `footnote`, `formula`, etc. ([PyMuPDF][9]) | Official API. | **Use `page_chunks=True` in the canonical pass and retain `page_boxes`.** |
| **Word-level output:** `extract_words=True` forces page chunks and gives words in the same order as the extracted text, **but the current docs require Layout to be disabled for this option**. ([PyMuPDF][9]) | Official API. | **Do not sacrifice Layout just to get words.** Canonical narration uses Layout. If debugging needs word coordinates, perform a second Layout-off diagnostic pass with `extract_words=True`. |
| **Dehyphenation:** current `to_markdown()` exposes **no dehyphenation parameter**. Low-level PyMuPDF has `TEXT_DEHYPHENATE`, but that does not establish that today's Layout path honors it. | Current public signature plus low-level PyMuPDF text flags. ([PyMuPDF][9]) | **Keep Narrate's conservative post-layout dehyphenation pass.** Do not wire `TEXT_DEHYPHENATE` into the spec as though it controlled Layout. |
| **Tables:** with Layout active, Layout handles table reconstruction. `table_strategy` is primarily relevant to the older/Layout-off path. ([PyMuPDF][9]) | Official API. | **Leave Layout table detection alone for the normal path.** Don't cargo-cult `table_strategy="lines_strict"` and assume it affects the current Layout result. |
| **OCR:** current API gives `use_ocr`, `force_ocr`, `ocr_dpi`, `ocr_language`, and `ocr_function`. It supports OCR plugins, including **Tesseract and RapidOCR**. `use_ocr=False` guarantees pages without selectable text remain empty. ([PyMuPDF][10]) | Official PyMuPDF docs. | **v1 text-PDF pass: `use_ocr=False`. OCR becomes a separately installed fallback. Prefer RapidOCR first.** |
| **Tesseract requirements:** if Tesseract is selected, Narrate needs Tesseract itself plus the appropriate `.traineddata` language files; PyMuPDF4LLM accepts codes such as `eng`, `fra`, or combinations such as `eng+fra+deu`. ([PyMuPDF][11]) | Official current language-pack docs. | Since your machine has no Tesseract, **do not add it just to satisfy v1**. If added later, explicitly configure the tessdata location / `TESSDATA_PREFIX` rather than trusting machine-global discovery. |
| **Extraction confidence:** PyMuPDF4LLM exposes OCR-decision information, but I found **no documented numeric whole-document reading-order confidence or extraction-quality score** suitable for Narrate's go/no-go decision. | Current API/docs. ([PyMuPDF][9]) | **Original heuristic confidence system stands.** Compute it from text density, Unicode corruption, layout anomalies, image/text ratio, furniture residue, table anomalies, etc. |

### Canonical v1 PDF call

Conceptually, the spec should require:

```text
use_layout(True)

to_markdown(
  document,
  page_chunks=True,
  header=False,
  footer=False,
  use_ocr=False,
  ...
)
```

That is a meaningful tightening of the original PDF section.

---

## 3. Docling as a lazy fallback

There is one **false premise** in the pushback worth correcting: PyMuPDF OCR and Docling do **not both require Tesseract as a system dependency**. PyMuPDF4LLM can use RapidOCR, and Docling also supports non-Tesseract OCR stacks. This is not a logical fallacy, just an incorrect dependency assumption.

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Standard `docling` does pull the ML/PyTorch stack.** Official installation guidance provides a special CPU-only PyTorch index specifically for machines without accelerators. ([Docling][12]) | Docling official installation docs. | **Do not include full `docling` in the default Narrate environment.** |
| **There is now a proper minimal route:** `docling-slim` carries no default heavy features and lets you select granular capabilities such as PDF parsing, Office formats and RapidOCR. | Current Docling packaging/docs. ([GitHub][13]) | For DOCX nice-to-have, prefer **`docling-slim[format-office]`** rather than pulling the full ML package. |
| **Models download separately.** The official tool defaults its artifact cache to `$HOME/.cache/docling/models`; it can download individual repos or the full model set. ([GitHub][14]) | `docling-tools models download` docs. | If enhanced extraction is installed, **pin/download artifacts deliberately during setup**, not unexpectedly when the user presses Play. |
| **Model licensing is not one blanket MIT statement.** The main code is MIT, but model artifacts have their own licensing. The core `docling-models` repository exposes CDLA-Permissive-2.0 and Apache-2.0 material. ([Hugging Face][15]) | Current project/model repository. | Persist artifact IDs, versions and licenses in `THIRD_PARTY_NOTICES`. |
| **Exact full CPU disk footprint:** I could not find an official stable number for the complete 2.126.0 environment. Project materials suggest the ML/model route is multi-gigabyte, but that is not a sufficiently stable contract to give you a fake precise size. | Current installation/model docs define components, not a promised aggregate footprint. | Measure with `uv` if/when the feature is installed. **Do not budget it into v1.** |

### Default

**Remove automatic Docling fallback from v1.**

Use this ladder:

```text
PyMuPDF4LLM Layout
        ↓
quality heuristic fails
        ↓
PyMuPDF4LLM + optional RapidOCR
        ↓
still fails
        ↓
show "Enhanced extraction available"
        ↓
optional Docling install/use
```

That is substantially cleaner for a personal tool.

**Docling becomes an opt-in difficult-document mode, not a hidden dependency dragon.**

---

## 4. ESM-only/toolchain trap

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Unified/remark/rehype are ESM-first/ESM-only in the versions chosen.** `unified@11`, `remark-parse@11`, and current rehype packages document ESM usage. ([npm][16]) | Official package repos/registry. | **Narrate is ESM from day one:** root/package `"type": "module"`. Do not fight the ecosystem with CommonJS shims. |
| **`file-type` is ESM.** The settled v22 baseline also requires modern Node, which Node 24 comfortably satisfies. ([npm][17]) | Current package metadata. | Import it natively from ESM. |
| **Node 24 does run `.ts` directly with type stripping unflagged**, but that feature only strips erasable TypeScript syntax and deliberately ignores much of `tsconfig` behavior. Node's own docs recommend third-party runners such as `tsx` when full TS developer ergonomics are needed. ([Node.js][18]) | Node 24 docs. | **Use `tsx` for the Express development/runtime command.** Native Node TS is fine for tiny scripts, not the primary server contract. |
| Current versions verified in this pass: **`tsx@4.23.13`, `typescript@7.0.2`, `vitest@5.0.0`.** ([npm][19]) | npm/current project docs. | Pin those exact majors/current versions when implementation begins. |
| **Vitest handles TypeScript configuration itself.** You do not need to wrap `vitest.config.ts` in `tsx`. | Vitest's native config system supports TS configuration. | Use `vitest.config.ts`; run Vitest normally. |

### Toolchain decision

```text
Node 24 LTS
pnpm workspace
"type": "module"

development:
  tsx server/src/index.ts

type safety:
  tsc --noEmit

tests:
  vitest
  vitest.config.ts
```

For a distributed product later, I would compile the server to JavaScript. For this local personal tool, **running the server via `tsx` is simpler than pretending Node's built-in stripping is a complete TS runtime**.

---

## 5. MP3 chapter player support

This is murkier than codec support because many players can play MP3 perfectly while not exposing ID3 `CHAP`/`CTOC` in their UI.

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Pocket Casts iOS:** verified to support **AAC and MP3 chapters**. | Official Pocket Casts support. ([Pocket Casts Support][20]) | MP3 is fine. |
| **Pocket Casts Android:** supports MP3 chapters; notably, Pocket Casts says Android does **not** support Apple's proprietary M4A chapter format. ([Pocket Casts Support][20]) | Official Pocket Casts support. | This is evidence **against** treating M4B/M4A as a universal portability upgrade. |
| **Apple Podcasts:** supports user-provided chapter information from MP3 ID3 metadata as well as MP4/AAC chapter metadata. ([Apple Podcasts][21]) | Apple Podcasts for Creators docs. | MP3 is acceptable for Apple Podcasts too. |
| **AntennaPod:** MP3/ID3 chapter support exists in project history and fixes. I could not verify a fresh 2026 document promising every current chapter format/UI behavior. ([AntennaPod Forum][22]) | Official project history, weaker than a current support matrix. | Treat MP3 chapters as supported, but **do not make Narrate depend on AntennaPod UI behavior**. |
| **VLC desktop/mobile:** I could not find current official VLC documentation explicitly guaranteeing display/navigation of ID3 `CHAP`/`CTOC`. | **Unverified.** | Do not claim it in Narrate docs merely because test files may work. |
| **Windows Media Player / new Media Player:** official documentation verifies MP3 playback, but I found no current authoritative Microsoft chapter-display contract for ID3 `CHAP`/`CTOC`. | **Unverified.** | Same: no marketing claim. |
| **foobar2000:** I did not find an authoritative current document guaranteeing these chapter frames. | **Unverified.** | Test opportunistically, but not a spec requirement. |
| **Apple Music:** I found current chapter support documentation for **Apple Podcasts**, not a matching guarantee for the Apple Music app. | **Unverified.** | Do not conflate Podcasts and Music. |
| **Browser `<audio>`:** there is no standard UI/API that converts ID3 `CHAP` frames into chapter controls. Browser chapters are normally expressed separately, e.g. via WebVTT chapter tracks/application UI. | HTML media/WebVTT behavior, not ID3 metadata UI. ([MDN Web Docs][23]) | **Narrate's manifest remains authoritative for in-app chapter navigation.** |

### M4B decision

**Do not add M4B/AAC to v1.**

MP3 chapters are already verified on Apple Podcasts and Pocket Casts, while Pocket Casts Android specifically makes the Apple chapter format *less* portable. ([Pocket Casts Support][20])

If later added, M4B should be:

> **Optional Apple/audiobook export**, not "the chapter-compatible format."

---

## 6. Live playback transport

This one **does overturn the original spec**.

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Chrome:** current compatibility testing reports MSE `audio/mpeg` support. | Recent Mozilla compatibility analysis. ([Bugzilla][24]) | It works, but that does not make it portable enough for the default. |
| **Firefox:** current Firefox reports **`MediaSource.isTypeSupported("audio/mpeg") === false`**, while ordinary MP3 playback works. ([Bugzilla][24]) | Mozilla compatibility analysis. | **This kills raw-MP3 MediaSource as Narrate's cross-browser v1 transport.** |
| **Edge:** Chromium ancestry makes support likely, but I did not find a current Edge-specific official support guarantee I am willing to cite as fact. | **Not independently verified.** | Runtime-test rather than assuming. |
| **MSE generally:** the browser itself provides `MediaSource.isTypeSupported()` precisely because container/codec combinations are runtime-dependent. ([MDN Web Docs][25]) | MDN/current API docs. | Feature detection only if MSE is added later. |
| **Plain `<audio src>` over a progressively produced MP3:** browsers can start consuming a normal streamed media resource before it is complete. For an indefinite/growing resource, seekable ranges reflect what is actually available; you cannot promise seeking into audio that has not been generated. ([MDN Web Docs][26]) | Standard media behavior. | **v1 default.** |
| **After generation is complete:** serve `final.mp3` with known length plus normal byte-range support so full seeking becomes deterministic. | HTTP ranges + HTML media behavior. | Swap the player from live resource to final stable artifact seamlessly. |
| **Playback speed:** `HTMLMediaElement.playbackRate` is broadly available; browsers pitch-correct by default, and `preservesPitch` defaults true. ([MDN Web Docs][27]) | MDN. | Keep 0.75x–2x playback entirely in `<audio>`. |

### New v1 path

```text
continuous FFmpeg MP3 encoder
          ↓
GET /jobs/:id/live.mp3
chunked/progressive HTTP body
          ↓
<audio src="/jobs/:id/live.mp3">
```

While generation is active:

* play/pause normally
* playbackRate normally
* seek **only inside `audio.seekable`**
* future text/audio is not seekable because it does not exist yet

When finalized:

```text
/jobs/:id/final.mp3
Content-Length
Accept-Ranges: bytes
```

Then full arbitrary seeking is available.

If Narrate ever revisits MSE, use a broadly supported MSE container/codec such as MP4/AAC or WebM/Opus rather than raw MP3.

---

## 7. Chunk size vs Kokoro internals

The original generic **1,200–1,800 character** recommendation is too coarse for Kokoro specifically.

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| Kokoro ONNX's internal model ceiling is **510 phonemes/tokens**. ([GitHub][28]) | Current implementation. | Never let the local adapter routinely hit that ceiling. |
| Current splitter prefers **sentence → clause → word → last-resort harder split**, so it is safer than naive truncation. ([GitHub][29]) | Current `kokoro-onnx` implementation. | Still, hidden engine-side splitting should be exceptional, not Narrate's normal chunking mechanism. |
| Outer chunking still matters. If Narrate sends 1,800 characters and Kokoro secretly breaks it into several internal requests, Narrate loses clean correspondence among chapter timing, cache entries, cancel boundaries, progress and audible seams. | Architectural consequence of the documented 510 limit/splitter. ([GitHub][28]) | Pre-phonemize before synthesis and bound the chunk with the same unit the engine actually consumes. |
| `kokoro-onnx` also has a continuous mode that overlaps generation to carry prosody across joins, but current implementation notes additional work, around **1.4×**, and model timing requirements. ([GitHub][30]) | Current implementation. | Do not require continuous mode in v1. Benchmark it later. |

### Local Kokoro chunk contract

**Replace 1,200–1,800 characters for the Kokoro adapter with:**

```text
first playable chunk:
  150–250 phonemes

normal target:
  350–450 phonemes

hard application maximum:
  500 phonemes

model hard ceiling:
  510
```

Rules:

1. whole sentence first
2. pack consecutive sentences toward 350–450
3. heading always creates a boundary
4. if one sentence exceeds 500, split at clause punctuation
5. then words if necessary
6. only allow the library's own splitter as the last safety net

Why leave 10 phonemes unused? Because **510 is an engine ceiling, not a target**.

The generic cloud chunk target of 1,200–1,800 *characters* can remain. Chunk limits now belong partly to provider adapters, exactly as the provider architecture intended.

---

## 8. Piper 1.8.0 optional tier

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Python API:** current API is centered on `PiperVoice`; voices are loaded through `PiperVoice.load(...)`, with synthesis APIs including WAV and streaming/raw synthesis paths. ([GitHub][31]) | Current OHF Piper docs/source. | If Piper is enabled, use the Python library directly inside the local helper. |
| **HTTP server:** yes, an HTTP mode ships through the HTTP extra, using `piper-tts[http]` and `piper.http_server`; it exposes synthesis/info/voice endpoints. ([GitHub][32]) | Current project docs. | **Do not use it for Narrate.** Another localhost service/process buys nothing here. |
| **Voice licensing:** Piper voice downloads use `.onnx` + `.onnx.json`, and voice/model `MODEL_CARD` information must be checked because voice licenses vary independently of Piper's GPL code. ([GitHub][33]) | Current voice docs. | Installer records model URL/version/license from the model card. Never say "all Piper voices are GPL." |
| **Default en-US candidate:** `en_US-joe-medium` is current, medium quality, ~22.05 kHz, with its model card identifying a CC0/public-domain-compatible source dataset. ([Hugging Face][34]) | Current model card/repository. | **Use `en_US-joe-medium` as Narrate's default Piper voice**, unless a listening test selects another equally permissively licensed voice. |

Piper's product role does not change:

> **Optional ultra-light local fallback**, below Kokoro ONNX on voice quality priority.

---

## 9. Cloud pricing re-verification

### OpenAI

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| `gpt-4o-mini-tts` remains the current standard speech-generation model. Current model docs show **2,000 maximum input tokens**. ([OpenAI Developers][35]) | Official OpenAI model page, crawled today. | Keep `gpt-4o-mini-tts`. |
| Pricing remains **$0.60 / 1M input text tokens + $12 / 1M output audio tokens**. ([OpenAI Developers][35]) | Official OpenAI model page. | Original price was correct. |
| Speech endpoint documentation also imposes a text-size boundary around **4,096 characters**. | Official speech endpoint documentation. ([OpenAI Developers][36]) | Adapter enforces **both** limits and uses whichever is reached first. |
| I found newer realtime voice models, but **no newer ordinary speech-generation TTS model that supersedes `gpt-4o-mini-tts`** in the current model catalog. ([OpenAI Developers][37]) | Current OpenAI model catalog. | No model change. |

### Azure

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| Microsoft exposes an official **Azure Retail Prices REST API**, including filterable retail/unit price records. ([Microsoft Learn][38]) | Microsoft Azure Retail Prices API. | This is the correct source rather than scraping the rendered marketing page. |
| I attempted to resolve the current US PAYG neural TTS meter through Microsoft's current pricing surfaces, but I **still could not get a trustworthy current Speech TTS meter/price row** from the available API/search path. The public pricing page continues to render placeholders in this environment. | Current Microsoft surfaces; exact number **not verified**. ([Microsoft Azure][39]) | **Do not put an Azure PAYG dollar figure in the implementation spec.** Resolve it during implementation against the exact selected region/SKU or user's Azure calculator. |
| Older official/community answers mentioning ~$16/M chars exist, but they are stale enough that I reject them for a September 2026 pin. | Deliberately not used as current pricing authority. | No guessing. |

### ElevenLabs

| Verdict | Current source | Default recommendation |
| --- | --- | --- |
| **Eleven v3:** $0.10 / 1K characters, 5,000-character request limit. ([ElevenLabs][40]) | Official ElevenAPI pricing, crawled today. | Use only if its expressiveness is actually wanted. |
| **v3 Conversational:** $0.05 / 1K characters. ([ElevenLabs][40]) | Official pricing. | Not Narrate's long-document quality default. |
| **Multilingual v2:** $0.10 / 1K characters, 10,000-character limit. ([ElevenLabs][40]) | Official pricing. | Best ElevenLabs long-form baseline if consistency beats expressiveness. |
| **Flash / Turbo:** $0.05 / 1K characters, 40,000-character limit. ([ElevenLabs][40]) | Official API pricing. | Low-cost/low-latency option, not the default provider for Narrate. |

---

# Changes to the original specification

There are **four actual decision reversals** and several clarifications.

1. **OVERTURNED: local TTS default**

   * **Old:** Python `kokoro@0.9.4` / PyTorch.
   * **New:** **`kokoro-onnx@0.6.1` + INT8 model**.
   * PyTorch Kokoro becomes the reference/fallback.
   * Reason: much smaller dependency/model footprint, active 2026 maintenance, explicit 510-phoneme splitting, bundled eSpeak loading, incremental output.

2. **OVERTURNED: Docling automatic fallback**

   * **Old:** PyMuPDF4LLM → automatically retry with Docling.
   * **New:** PyMuPDF4LLM Layout → optional RapidOCR → explicit **Enhanced extraction / Docling install**.
   * Full Docling is no longer part of the default environment.

3. **OVERTURNED: live MP3 MediaSource transport**

   * **Old:** MediaSource for continuous MP3 where supported.
   * **New:** **ordinary `<audio src>` over a progressively streamed continuous MP3**.
   * Raw MP3 MSE is specifically unsuitable as a cross-browser default because Firefox currently rejects `audio/mpeg` under MSE. ([Bugzilla][24])

4. **OVERTURNED: Kokoro's 1,200–1,800-character outer chunk**

   * **Old:** generic 1,200–1,800 chars.
   * **New local Kokoro:** **350–450 phonemes target, 500 hard app max, 510 engine max**.
   * Generic cloud chunk guidance stays unchanged.

The following **do not overturn** the original top-level choices:

* **PyMuPDF4LLM remains the PDF default**, but its exact 1.28.2 contract is now Layout-first, `page_chunks=True`, `header=False`, `footer=False`; word extraction becomes a secondary diagnostics pass.
* **MP3 remains the default downloadable format.** No M4B in v1.
* **Node backend architecture remains.** Make it ESM and run development through `tsx`.
* **Piper remains optional.**
* **OpenAI `gpt-4o-mini-tts` remains the preferred cloud adapter.**
* **ElevenLabs pricing was essentially correct.**
* **Azure's exact PAYG dollar price remains intentionally unresolved rather than guessed.**
* **FFmpeg MP3 chapter generation is now fully closed as a question**, based on the reviewer's direct FFmpeg 6.1 verification.

### Revised local core in one line

```text
React/Vite
   ↓
Node 24 ESM + Express
   ├─ PyMuPDF4LLM Layout
   ├─ optional RapidOCR
   ├─ optional Docling enhanced mode
   ├─ kokoro-onnx INT8
   └─ one continuous FFmpeg MP3 encoder
                ↓
       progressive <audio>
                ↓
         final chaptered MP3
```

**Confidence: 🟢** on the revised architectural decisions and APIs. **🟡** only on exact Coffee Lake TTS RTF/install footprints and the chapter UI behavior of VLC/Windows Media Player/foobar2000/Apple Music, because current authoritative sources do not publish enough to justify pretending those are settled.

[1]: https://github.com/hexgrad/kokoro/blob/main/pyproject.toml "kokoro/pyproject.toml at main · hexgrad/kokoro · GitHub"
[2]: https://pypi.org/project/kokoro/0.9.4/ "kokoro · PyPI"
[3]: https://github.com/thewh1teagle/kokoro-onnx "thewh1teagle/kokoro-onnx"
[4]: https://pypi.org/project/kokoro-onnx/ "kokoro-onnx · PyPI"
[5]: https://github.com/thewh1teagle/kokoro-onnx/blob/main/src/kokoro_onnx/tokenizer.py "kokoro-onnx tokenizer.py"
[6]: https://www.npmjs.com/package/kokoro-js?activeTab=dependencies "kokoro-js · npm"
[7]: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/main/onnx "onnx-community/Kokoro-82M-v1.0-ONNX"
[8]: https://github.com/thewh1teagle/kokoro-onnx/releases "Releases · thewh1teagle/kokoro-onnx"
[9]: https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/api.html "The PyMuPDF4LLM API - PyMuPDF documentation"
[10]: https://pymupdf.readthedocs.io/en/latest/pymupdf4llm/ "PyMuPDF4LLM - PyMuPDF documentation"
[11]: https://pymupdf.readthedocs.io/en/latest/ocr/tesseract-language-packs.html "Tesseract Language Packs - PyMuPDF documentation"
[12]: https://docling-project.github.io/docling/getting_started/installation/ "Docling installation"
[13]: https://github.com/docling-project/docling/blob/main/pyproject.toml "docling pyproject.toml"
[14]: https://github.com/docling-project/docling/blob/main/docs/reference/cli.md "docling CLI reference"
[15]: https://huggingface.co/docling-project/docling-models "docling-project/docling-models"
[16]: https://www.npmjs.com/package/unified?activeTab=versions "unified · npm"
[17]: https://www.npmjs.com/package/file-type?activeTab=versions "file-type · npm"
[18]: https://nodejs.org/api/typescript.html "Node.js TypeScript docs"
[19]: https://www.npmjs.com/package/tsx?activeTab=versions "tsx · npm"
[20]: https://support.pocketcasts.com/knowledge-base/chapters/ "Chapters – Pocket Casts Support"
[21]: https://podcasters.apple.com/support/5482-using-chapters-on-apple-podcasts "Using chapters on Apple Podcasts"
[22]: https://forum.antennapod.org/t/chapter-marks-documentation/1193 "AntennaPod chapter marks documentation"
[23]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/track "<track> - MDN"
[24]: https://bugzilla.mozilla.org/show_bug.cgi?id=2067651 "Bugzilla 2067651"
[25]: https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/isTypeSupported_static "MediaSource.isTypeSupported() - MDN"
[26]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement "HTMLMediaElement - MDN"
[27]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate "HTMLMediaElement.playbackRate - MDN"
[28]: https://github.com/thewh1teagle/kokoro-onnx/blob/main/src/kokoro_onnx/config.py "kokoro-onnx config.py"
[29]: https://github.com/thewh1teagle/kokoro-onnx/blob/main/src/kokoro_onnx/chunker.py "kokoro-onnx chunker.py"
[30]: https://github.com/thewh1teagle/kokoro-onnx/blob/main/src/kokoro_onnx/__init__.py "kokoro-onnx __init__.py"
[31]: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md "Piper Python API"
[32]: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md "Piper HTTP API"
[33]: https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md "Piper voices"
[34]: https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/joe/medium/MODEL_CARD "en_US-joe-medium MODEL_CARD"
[35]: https://developers.openai.com/api/docs/models/gpt-4o-mini-tts "GPT-4o Mini TTS Model | OpenAI API"
[36]: https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create "OpenAI speech endpoint reference"
[37]: https://developers.openai.com/api/docs/models "OpenAI models"
[38]: https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices "Azure Retail Prices API"
[39]: https://azure.microsoft.com/en-us/pricing/details/speech/ "Azure Speech pricing"
[40]: https://elevenlabs.io/pricing/api "ElevenLabs API pricing"
