import { createHash } from 'node:crypto';
import { detectFormat } from './detect/detect.js';
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
export type { DetectInput, Detection } from './detect/detect.js';
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
    warnings: [...detection.warnings],
  };
  const diagnostics: Diagnostic[] = detection.warnings.map((w) => ({
    kind: 'detection-conflict',
    sourceId,
    detail: w,
  }));
  if (detection.encoding && detection.encoding.startsWith('windows-1252')) {
    diagnostics.push({ kind: 'encoding', sourceId, detail: `Decoded as ${detection.encoding}` });
  }

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

/**
 * Several inputs → one SpeakDocument in the given order. Each source becomes a
 * top-level chapter named from its filename unless it already opens with an H1.
 */
export async function normalizeSources(inputs: readonly DetectInput[]): Promise<SpeakDocument> {
  const doc: SpeakDocument = {
    version: NORMALIZATION_VERSION,
    sources: [],
    blocks: [],
    diagnostics: [],
  };
  for (const [i, input] of inputs.entries()) {
    const sourceId = `src-${i + 1}`;
    const { document } = await normalizeSource(input, sourceId);
    const first = document.blocks[0];
    const opensWithH1 = first?.type === 'heading' && first.level === 1;
    if (!opensWithH1) {
      const name = input.filename ? input.filename.replace(/\.[^.]+$/, '') : `Pasted text ${i + 1}`;
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
  }
  return doc;
}
