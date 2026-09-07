import type { SpeakBlock } from '../types.js';
import { collapseWhitespace, speakInlineUrls } from '../speakable/inline.js';

const RULE_LINE_RE = /^[ \t]*([-=*_])\1{2,}[ \t]*$/;
const PARAGRAPH_BREAK_RE = /\r?\n[ \t]*(?:\r?\n[ \t]*)+/g;
const LINE_RE = /[^\r\n]*(?:\r?\n|$)/g;

/**
 * Plain text: paragraphs are separated by blank lines; single newlines inside
 * a paragraph are hard wraps and become spaces. A line of only dashes,
 * equals, stars or underscores is a rule and becomes a pause, even without
 * blank lines around it. Bare URLs and emails get their spoken forms.
 *
 * Provenance offsets are into the original `text`, CRLF included, so a
 * consumer can slice the source it actually has.
 */
export function normalizeText(text: string, sourceId: string): SpeakBlock[] {
  const blocks: SpeakBlock[] = [];
  let start = 0;
  for (const m of text.matchAll(PARAGRAPH_BREAK_RE)) {
    emitChunk(text, start, m.index, sourceId, blocks);
    start = m.index + m[0].length;
  }
  emitChunk(text, start, text.length, sourceId, blocks);
  return blocks;
}

/** One blank-line-delimited chunk: split further at rule lines, the rest is a paragraph. */
function emitChunk(
  text: string,
  start: number,
  end: number,
  sourceId: string,
  out: SpeakBlock[],
): void {
  if (end <= start) return;
  const chunk = text.slice(start, end);
  let paraStart: number | undefined;
  let paraEnd = start;
  const flush = () => {
    if (paraStart === undefined) return;
    const spoken = collapseWhitespace(speakInlineUrls(text.slice(paraStart, paraEnd)));
    if (spoken)
      out.push({
        type: 'paragraph',
        sourceId,
        text: spoken,
        provenance: { start: paraStart, end: paraEnd },
      });
    paraStart = undefined;
  };
  for (const line of chunk.matchAll(LINE_RE)) {
    if (line[0].length === 0) break;
    const lineStart = start + line.index;
    const body = line[0].replace(/\r?\n$/, '');
    const lineEnd = lineStart + body.length;
    if (RULE_LINE_RE.test(body)) {
      flush();
      out.push({ type: 'pause', sourceId, provenance: { start: lineStart, end: lineEnd } });
      continue;
    }
    if (body.trim().length === 0) continue;
    if (paraStart === undefined) paraStart = lineStart;
    paraEnd = lineEnd;
  }
  flush();
}
