import { fileTypeFromBuffer } from 'file-type';
import type { Element, Root as HastRoot, RootContent as HastContent } from 'hast';
import type { Node as MdNode, Parent as MdParent } from 'mdast';
import type { DetectionConfidence, DiagnosticKind, SourceFormat } from '../types.js';
import { looksLikeHtmlDocument, parseHtml } from '../normalize/html.js';
import { parseMarkdown } from '../normalize/markdown.js';

export interface DetectInput {
  bytes?: Uint8Array;
  text?: string;
  filename?: string;
}

/** A warning carries its kind so consumers never classify by parsing the message. */
export interface DetectionWarning {
  kind: Extract<DiagnosticKind, 'detection-conflict' | 'encoding'>;
  detail: string;
}

export interface Detection {
  format: SourceFormat;
  confidence: DetectionConfidence;
  declaredFormat?: SourceFormat;
  /** Decoded text for text formats; absent for pdf/docx. */
  text?: string;
  encoding?: string;
  evidence: string[];
  warnings: DetectionWarning[];
}

export class UnsupportedFormatError extends Error {
  constructor(
    public readonly detected: string,
    message?: string,
  ) {
    super(message ?? `Unsupported input format: ${detected}`);
    this.name = 'UnsupportedFormatError';
  }
}

const EXTENSIONS: Record<string, SourceFormat> = {
  txt: 'txt',
  text: 'txt',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  pdf: 'pdf',
  docx: 'docx',
};

export function formatFromFilename(filename: string | undefined): SourceFormat | undefined {
  if (!filename) return undefined;
  const ext = filename.toLowerCase().split('.').pop();
  return ext ? EXTENSIONS[ext] : undefined;
}

/**
 * Precedence, fixed by the spec:
 *   strong binary signature (PDF, DOCX container)
 *   → text decoding (BOM, else strict UTF-8, else Windows-1252 with a warning)
 *   → extension hint
 *   → HTML structural score
 *   → Markdown structural score
 *   → plain text.
 * Strong content evidence beats the extension; the extension beats weak
 * heuristics; a conflict produces a warning, never a silent choice.
 */
export async function detectFormat(input: DetectInput): Promise<Detection> {
  const declared = formatFromFilename(input.filename);
  const evidence: string[] = [];
  const warnings: DetectionWarning[] = [];
  const conflict = (detail: string) => warnings.push({ kind: 'detection-conflict', detail });
  const name = input.filename ?? 'pasted text';
  const declaredProp = declared ? { declaredFormat: declared } : {};

  let text: string;
  let encoding: string | undefined;

  if (input.bytes) {
    const binary = await detectBinary(input.bytes);
    if (binary) {
      evidence.push(binary.evidence);
      if (declared && declared !== binary.format) {
        conflict(
          `${name} has a ${binary.format.toUpperCase()} signature and was interpreted as ${binary.format.toUpperCase()}`,
        );
      }
      return { format: binary.format, confidence: 'strong', ...declaredProp, evidence, warnings };
    }
    const decoded = decodeText(input.bytes);
    text = decoded.text;
    encoding = decoded.encoding;
    evidence.push(`decoded as ${decoded.encoding}`);
    if (decoded.warning) warnings.push({ kind: 'encoding', detail: decoded.warning });
    if (looksBinary(text))
      throw new UnsupportedFormatError('binary', `${name} looks like binary data, not text`);
  } else if (typeof input.text === 'string') {
    text = input.text;
  } else {
    throw new UnsupportedFormatError('empty', 'No input provided');
  }

  if (declared === 'pdf' || declared === 'docx') {
    conflict(
      `${name} is named like a ${declared.toUpperCase()} but contains text; interpreting the text`,
    );
  }

  const html = scoreHtml(text);
  const md = scoreMarkdown(text);
  evidence.push(`html: ${html.evidence}`, `markdown: ${md.evidence}`);
  const encProp = encoding ? { encoding } : {};
  const done = (format: SourceFormat, confidence: DetectionConfidence): Detection => {
    if (
      declared &&
      declared !== format &&
      declared !== 'pdf' &&
      declared !== 'docx' &&
      confidence !== 'default'
    ) {
      conflict(`${name} contains ${label(format)} and was interpreted as ${label(format)}`);
    }
    return { format, confidence, ...declaredProp, text, ...encProp, evidence, warnings };
  };

  if (html.level === 'strong') return done('html', 'strong');
  if (md.level === 'strong') return done('markdown', 'strong');
  if (declared === 'html') return done('html', html.level === 'none' ? 'weak' : 'medium');
  if (declared === 'markdown') return done('markdown', md.level === 'none' ? 'weak' : 'medium');
  if (html.level === 'medium') return done('html', 'medium');
  if (md.level === 'medium') return done('markdown', 'medium');
  if (declared === 'txt')
    return {
      format: 'txt',
      confidence: 'weak',
      ...declaredProp,
      text,
      ...encProp,
      evidence,
      warnings,
    };
  return {
    format: 'txt',
    confidence: 'default',
    ...declaredProp,
    text,
    ...encProp,
    evidence,
    warnings,
  };
}

function label(f: SourceFormat): string {
  return f === 'markdown' ? 'Markdown' : f.toUpperCase();
}

// ISO 32000 puts the header on the first line; readers tolerate up to 1024 bytes
// of leading junk, so we do too, but require the version to follow.
const PDF_HEADER_RE = /%PDF-\d\.\d/;

async function detectBinary(
  bytes: Uint8Array,
): Promise<{ format: SourceFormat; evidence: string } | undefined> {
  const head = latin1(bytes.subarray(0, 1024));
  if (PDF_HEADER_RE.test(head)) {
    return { format: 'pdf', evidence: '%PDF-x.y header within first 1024 bytes' };
  }
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip) {
    const names = zipEntryNames(bytes);
    if (!names) {
      throw new UnsupportedFormatError('zip', 'ZIP archive has no readable central directory');
    }
    if (names.includes('word/document.xml') && names.includes('[Content_Types].xml')) {
      return {
        format: 'docx',
        evidence: 'ZIP central directory lists [Content_Types].xml and word/document.xml',
      };
    }
    throw new UnsupportedFormatError('zip', 'ZIP archive is not a DOCX document');
  }
  const ft = await fileTypeFromBuffer(bytes);
  if (!ft) return undefined;
  if (ft.ext === 'pdf') return { format: 'pdf', evidence: 'file-type: pdf' };
  if (ft.ext === 'docx') return { format: 'docx', evidence: 'file-type: docx' };
  // Text formats have no magic bytes; anything file-type recognizes here is a binary we cannot read.
  if (ft.mime.startsWith('text/') || ft.ext === 'xml' || ft.ext === 'html') return undefined;
  throw new UnsupportedFormatError(ft.ext, `Unsupported binary format: ${ft.mime}`);
}

/**
 * Entry names from a ZIP's central directory, located via the End Of Central
 * Directory record. Returns undefined if the archive has no parseable directory.
 * ZIP64 archives (entry count 0xFFFF) are not handled; DOCX files never need it.
 */
export function zipEntryNames(bytes: Uint8Array): string[] | undefined {
  if (bytes.length < 22) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    // A real EOCD's comment runs exactly to the end of the file; a stray signature
    // inside a comment will not satisfy that.
    if (
      dv.getUint32(i, true) === 0x06054b50 &&
      i + 22 + dv.getUint16(i + 20, true) === bytes.length
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset >= bytes.length) return undefined;
  const names: string[] = [];
  const utf8 = new TextDecoder('utf-8');
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > eocd || dv.getUint32(p, true) !== 0x02014b50) return undefined;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const end = p + 46 + nameLen + extraLen + commentLen;
    // A record that claims to run past the EOCD is malformed; do not trust a truncated name.
    if (end > eocd) return undefined;
    names.push(utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)));
    p = end;
  }
  return names;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]!);
  return s;
}

export function decodeText(bytes: Uint8Array): {
  text: string;
  encoding: string;
  warning?: string;
} {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8 (BOM)' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le (BOM)',
    };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be (BOM)',
    };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
      warning: 'Input was not valid UTF-8; decoded as Windows-1252, some characters may be wrong',
    };
  }
}

function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096);
  if (sample.length === 0) return false;
  let control = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    if (c === 0 || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c)) control += 1;
  }
  return control / sample.length > 0.02;
}

type Level = 'strong' | 'medium' | 'weak' | 'none';

const HTML_BLOCK = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'blockquote',
  'pre',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'figure',
  'dl',
]);
const HTML_INLINE = new Set([
  'a',
  'img',
  'br',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'code',
  'sup',
  'sub',
  'small',
  'mark',
]);

function scoreHtml(text: string): { level: Level; evidence: string } {
  if (!text.includes('<')) return { level: 'none', evidence: 'no tags' };
  const root = parseHtml(text);
  let block = 0;
  let inlineTags = 0;
  let structural = looksLikeHtmlDocument(text);
  const visit = (n: HastContent | HastRoot) => {
    if (n.type === 'element') {
      const el = n as Element;
      if (el.tagName === 'html' || el.tagName === 'body' || el.tagName === 'head')
        structural = true;
      else if (HTML_BLOCK.has(el.tagName)) block += 1;
      else if (HTML_INLINE.has(el.tagName)) inlineTags += 1;
    }
    if ('children' in n) for (const c of n.children) visit(c as HastContent);
  };
  visit(root);
  const evidence = `${structural ? 'document skeleton, ' : ''}${block} block, ${inlineTags} inline elements`;
  if (structural || block >= 3) return { level: 'strong', evidence };
  if (block >= 1 || inlineTags >= 2) return { level: 'medium', evidence };
  if (inlineTags === 1) return { level: 'weak', evidence };
  return { level: 'none', evidence };
}

function scoreMarkdown(text: string): { level: Level; evidence: string } {
  const root = parseMarkdown(text);
  const counts = {
    heading: 0,
    setext: 0,
    fence: 0,
    table: 0,
    listItems: 0,
    quote: 0,
    link: 0,
    image: 0,
    emphasis: 0,
    rule: 0,
  };
  const visit = (n: MdNode) => {
    switch (n.type) {
      case 'heading': {
        // Only ATX headings (`# Title`) are strong evidence. A setext heading is a line
        // followed by ---- or ====, which plain text uses as a divider all the time.
        const s = n.position?.start.offset;
        if (s !== undefined && text[s] === '#') counts.heading += 1;
        else counts.setext += 1;
        break;
      }
      case 'code': {
        const s = n.position?.start.offset;
        const fence = s !== undefined ? text.slice(s, s + 3) : '';
        if (fence === '```' || fence === '~~~') counts.fence += 1;
        break;
      }
      case 'table':
        counts.table += 1;
        break;
      case 'listItem':
        counts.listItems += 1;
        break;
      case 'blockquote':
        counts.quote += 1;
        break;
      case 'link':
      case 'linkReference': {
        const s = n.position?.start.offset;
        if (s !== undefined && text[s] === '[') counts.link += 1;
        break;
      }
      case 'image':
      case 'imageReference':
        counts.image += 1;
        break;
      case 'emphasis':
      case 'strong':
        counts.emphasis += 1;
        break;
      case 'thematicBreak':
        counts.rule += 1;
        break;
      default:
        break;
    }
    if ('children' in n) for (const c of (n as MdParent).children) visit(c);
  };
  visit(root);
  const kinds = Object.entries(counts).filter(([, v]) => v > 0);
  const evidence = kinds.length ? kinds.map(([k, v]) => `${k}=${v}`).join(' ') : 'no structure';
  const total = kinds.reduce((a, [, v]) => a + v, 0);
  if (
    counts.heading > 0 ||
    counts.fence > 0 ||
    counts.table > 0 ||
    counts.listItems >= 2 ||
    kinds.length >= 2
  ) {
    return { level: 'strong', evidence };
  }
  if (total >= 2) return { level: 'medium', evidence };
  if (total === 1) return { level: 'weak', evidence };
  return { level: 'none', evidence };
}
