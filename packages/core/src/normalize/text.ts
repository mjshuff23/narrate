import type { SpeakBlock } from '../types.js';
import { collapseWhitespace, speakInlineUrls } from '../speakable/inline.js';

const RULE_LINE_RE = /^[ \t]*([-=*_])\1{2,}[ \t]*$/;
const PARAGRAPH_BREAK_RE = /\n[ \t]*(?:\n[ \t]*)+/g;

/**
 * Plain text: paragraphs are separated by blank lines; single newlines inside
 * a paragraph are hard wraps and become spaces. A line of only dashes,
 * equals, stars or underscores is a rule and becomes a pause, even without
 * blank lines around it. Bare URLs and emails get their spoken forms.
 *
 * Line endings (CRLF, lone CR, LF) are normalized to LF for the scan, and an
 * offset map translates every block boundary back to the original text, so
 * provenance offsets slice the source the caller actually has.
 */
export function normalizeText(text: string, sourceId: string): SpeakBlock[] {
  const { normalized, toOriginal } = normalizeLineEndings(text);
  const blocks: SpeakBlock[] = [];
  let start = 0;
  for (const m of normalized.matchAll(PARAGRAPH_BREAK_RE)) {
    emitChunk(normalized, start, m.index, sourceId, blocks, toOriginal);
    start = m.index + m[0].length;
  }
  emitChunk(normalized, start, normalized.length, sourceId, blocks, toOriginal);
  return blocks;
}

/** LF-only copy of `text` plus a map from each normalized offset to the original one. */
function normalizeLineEndings(text: string): {
  normalized: string;
  toOriginal: (i: number) => number;
} {
  if (!text.includes('\r')) return { normalized: text, toOriginal: (i) => i };
  const map: number[] = [];
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '\r') {
      map.push(i);
      out += '\n';
      if (text[i + 1] === '\n') i += 1;
    } else {
      map.push(i);
      out += ch;
    }
  }
  map.push(text.length);
  return { normalized: out, toOriginal: (i) => map[i] ?? text.length };
}

/** One blank-line-delimited chunk: split further at rule lines, the rest is a paragraph. */
function emitChunk(
  text: string,
  start: number,
  end: number,
  sourceId: string,
  out: SpeakBlock[],
  toOriginal: (i: number) => number,
): void {
  if (end <= start) return;
  let paraStart: number | undefined;
  let paraEnd = start;
  const flush = () => {
    if (paraStart === undefined) return;
    const spoken = collapseWhitespace(speakInlineUrls(text.slice(paraStart, paraEnd)));
    if (spoken) {
      out.push({
        type: 'paragraph',
        sourceId,
        text: spoken,
        provenance: { start: toOriginal(paraStart), end: toOriginal(paraEnd) },
      });
    }
    paraStart = undefined;
  };
  let lineStart = start;
  while (lineStart < end) {
    const nl = text.indexOf('\n', lineStart);
    const lineEnd = nl === -1 || nl >= end ? end : nl;
    const body = text.slice(lineStart, lineEnd);
    if (RULE_LINE_RE.test(body)) {
      flush();
      out.push({
        type: 'pause',
        sourceId,
        provenance: { start: toOriginal(lineStart), end: toOriginal(lineEnd) },
      });
    } else if (body.trim().length > 0) {
      if (paraStart === undefined) paraStart = lineStart;
      paraEnd = lineEnd;
    }
    lineStart = lineEnd + 1;
  }
  flush();
}
