/**
 * The semantic intermediate representation every input is normalized into
 * before chunking or synthesis. TTS providers never see files, Markdown,
 * HTML or PDF; they see speakable text rendered from these blocks.
 *
 * Bump NORMALIZATION_VERSION whenever a change here or in the normalizers
 * alters spoken output for the same input: it is part of the resume key.
 */
export const NORMALIZATION_VERSION = 1 as const;

export type SourceFormat = 'txt' | 'markdown' | 'html' | 'pdf' | 'docx';

/** How sure the detector was. `default` means "nothing matched, fell through to plain text". */
export type DetectionConfidence = 'strong' | 'medium' | 'weak' | 'default';

export interface SourceRecord {
  /** Stable within one SpeakDocument, e.g. "src-1". Every block points back to one of these. */
  id: string;
  filename?: string;
  /** Format the content was actually parsed as. */
  format: SourceFormat;
  /** Format the filename extension claimed, when there was one. */
  declaredFormat?: SourceFormat;
  confidence: DetectionConfidence;
  byteLength: number;
  /** SHA-256 hex of the raw input bytes. Part of the resume/cache key. */
  contentHash: string;
  encoding?: string;
  warnings: string[];
}

/** Where a block came from in its source. Offsets are into the decoded source text. */
export interface Provenance {
  start?: number;
  end?: number;
  page?: number;
}

interface BlockBase {
  sourceId: string;
  provenance?: Provenance;
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** H1–H3 become chapter markers; deeper headings are spoken but not indexed. */
  chapter: boolean;
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph';
  text: string;
}

export interface ListItemBlock extends BlockBase {
  type: 'list-item';
  text: string;
  ordered: boolean;
  /** 1-based position within an ordered list. */
  index?: number;
  /** Present only for GFM task items. */
  checked?: boolean;
  /** 0 for top-level items; nested lists are flattened with depth + 1. */
  depth: number;
}

/** A blockquote ("Quote. … End quote.") or an HTML aside ("Aside. …"). */
export interface ContainerBlock extends BlockBase {
  type: 'quote' | 'aside';
  blocks: SpeakBlock[];
}

export interface TableBlock extends BlockBase {
  type: 'table';
  /** Empty when the table had no header row. */
  header: string[];
  rows: string[][];
  /** True when the table exceeds the small-table threshold and is summarized instead of read. */
  omitted: boolean;
}

export interface ImageAltBlock extends BlockBase {
  type: 'image-alt';
  alt: string;
}

/** The fact that code existed is preserved; its contents are not spoken. */
export interface CodeOmissionBlock extends BlockBase {
  type: 'code-omission';
  code: string;
  lang?: string;
}

/** A horizontal rule or similar break: silence, not speech. */
export interface PauseBlock extends BlockBase {
  type: 'pause';
}

/** Footnote body, relocated to the end of the section that referenced it. */
export interface FootnoteBlock extends BlockBase {
  type: 'footnote';
  index: number;
  text: string;
}

export type SpeakBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListItemBlock
  | ContainerBlock
  | TableBlock
  | ImageAltBlock
  | CodeOmissionBlock
  | PauseBlock
  | FootnoteBlock;

export type DiagnosticKind =
  | 'omitted-code'
  | 'omitted-table'
  | 'omitted-image'
  | 'dropped-element'
  | 'detection-conflict'
  | 'encoding';

/** Something the user may want to know was left out or reinterpreted. Never fatal. */
export interface Diagnostic {
  kind: DiagnosticKind;
  sourceId: string;
  detail: string;
}

export interface SpeakDocument {
  version: typeof NORMALIZATION_VERSION;
  title?: string;
  sources: SourceRecord[];
  blocks: SpeakBlock[];
  diagnostics: Diagnostic[];
}
