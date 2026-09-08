import { createHash } from 'node:crypto';
import { detectFormat, UnsupportedFormatError } from './detect/detect.js';
import type { DetectInput, Detection } from './detect/detect.js';
import { normalizeHtml, newHtmlContext } from './normalize/html.js';
import { normalizeMarkdown } from './normalize/markdown.js';
import type { MarkdownContext } from './normalize/markdown.js';
import { normalizeText } from './normalize/text.js';
import type { Diagnostic, HeadingBlock, SourceRecord, SpeakBlock, SpeakDocument } from './types.js';
import { NORMALIZATION_VERSION } from './types.js';

export * from './types.js';
export {
  detectFormat,
  formatFromFilename,
  UnsupportedFormatError,
  zipEntryNames,
} from './detect/detect.js';
export type { DetectInput, Detection, DetectionWarning } from './detect/detect.js';
export { renderSpoken, spokenText } from './render.js';
export type { SpokenSegment } from './render.js';
export {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  isMeaningfulAlt,
  numberToWords,
  spokenEmail,
  spokenHostname,
  spokenLink,
} from './speakable/inline.js';

export interface NormalizeResult {
  document: SpeakDocument;
  detection: Detection;
}

export class NotYetSupportedError extends Error {
  constructor(public readonly format: string) {
    super(`${format.toUpperCase()} extraction is not implemented yet`);
    this.name = 'NotYetSupportedError';
  }
}

/**
 * One input → one SpeakDocument. Detects the format, normalizes, and records
 * provenance. PDF and DOCX are detected here but extracted by a later slice.
 */
export async function normalizeSource(
  input: DetectInput,
  sourceId = 'src-1',
): Promise<NormalizeResult> {
  const detection = await detectFormat(input);
  const bytes = input.bytes ?? new TextEncoder().encode(input.text ?? '');
  const record: SourceRecord = {
    id: sourceId,
    ...(input.filename ? { filename: input.filename } : {}),
    format: detection.format,
    ...(detection.declaredFormat ? { declaredFormat: detection.declaredFormat } : {}),
    confidence: detection.confidence,
    byteLength: bytes.byteLength,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    ...(detection.encoding ? { encoding: detection.encoding } : {}),
    warnings: detection.warnings.map((w) => w.detail),
  };
  // Every detection warning becomes exactly one diagnostic; the kind travels with the warning.
  const diagnostics: Diagnostic[] = detection.warnings.map((w) => ({
    kind: w.kind,
    sourceId,
    detail: w.detail,
  }));

  let blocks: SpeakBlock[];
  let title: string | undefined;
  const text = detection.text ?? '';
  switch (detection.format) {
    case 'txt':
      blocks = normalizeText(text, sourceId);
      break;
    case 'markdown': {
      const ctx: MarkdownContext = { sourceId, diagnostics };
      blocks = normalizeMarkdown(text, ctx);
      title = ctx.title;
      break;
    }
    case 'html': {
      const ctx = newHtmlContext(sourceId);
      blocks = normalizeHtml(text, ctx);
      diagnostics.push(...ctx.diagnostics);
      title = ctx.title;
      break;
    }
    case 'pdf':
    case 'docx':
      throw new NotYetSupportedError(detection.format);
  }

  const document: SpeakDocument = {
    version: NORMALIZATION_VERSION,
    ...(title ? { title } : {}),
    sources: [record],
    blocks,
    diagnostics,
  };
  return { document, detection };
}

/** Outcome of one input inside a batch; a failure never sinks the other inputs. */
export type SourceResult =
  | { index: number; filename?: string; ok: true; sourceId: string; detection: Detection }
  | {
      index: number;
      filename?: string;
      ok: false;
      error: string;
      code: 'unsupported' | 'not-yet-supported' | 'empty' | 'error';
    };

export interface BatchResult {
  document: SpeakDocument;
  results: SourceResult[];
}

/**
 * Several inputs → one SpeakDocument in the given order. When there is more
 * than one input, each becomes a top-level chapter named from its filename
 * unless it already opens with an H1; a lone input is left as it is, because a
 * spoken "Pasted text one." heading over a single document is noise.
 * Inputs that cannot be normalized are reported in `results` and skipped.
 */
export async function normalizeBatch(inputs: readonly DetectInput[]): Promise<BatchResult> {
  const doc: SpeakDocument = {
    version: NORMALIZATION_VERSION,
    sources: [],
    blocks: [],
    diagnostics: [],
  };
  const results: SourceResult[] = [];
  let n = 0;
  for (const [index, input] of inputs.entries()) {
    const named = input.filename ? { filename: input.filename } : {};
    const sourceId = `src-${n + 1}`;
    let result: NormalizeResult;
    try {
      result = await normalizeSource(input, sourceId);
    } catch (err) {
      const code =
        err instanceof NotYetSupportedError
          ? 'not-yet-supported'
          : err instanceof UnsupportedFormatError
            ? err.detected === 'empty'
              ? 'empty'
              : 'unsupported'
            : 'error';
      results.push({
        index,
        ...named,
        ok: false,
        code,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    n += 1;
    const { document, detection } = result;
    const first = document.blocks[0];
    const opensWithH1 = first?.type === 'heading' && first.level === 1;
    if (!opensWithH1 && inputs.length > 1) {
      const name = input.filename
        ? input.filename.replace(/\.[^.]+$/, '')
        : `Pasted text ${index + 1}`;
      const heading: HeadingBlock = {
        type: 'heading',
        sourceId,
        level: 1,
        text: name,
        chapter: true,
      };
      doc.blocks.push(heading);
    }
    doc.blocks.push(...document.blocks);
    doc.sources.push(...document.sources);
    doc.diagnostics.push(...document.diagnostics);
    if (!doc.title && document.title) doc.title = document.title;
    results.push({ index, ...named, ok: true, sourceId, detection });
  }
  return { document: doc, results };
}

/** normalizeBatch without the per-source report; throws if every input failed. */
export async function normalizeSources(inputs: readonly DetectInput[]): Promise<SpeakDocument> {
  const { document, results } = await normalizeBatch(inputs);
  const failed = results.filter((r) => !r.ok);
  if (inputs.length > 0 && failed.length === inputs.length) {
    throw new Error(failed.map((r) => r.error).join('; '));
  }
  return document;
}
