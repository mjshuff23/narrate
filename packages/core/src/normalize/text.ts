import type { SpeakBlock } from '../types.js';
import { collapseWhitespace, speakInlineUrls } from '../speakable/inline.js';

const RULE_LINE_RE = /^\s*([-=*_])\1{2,}\s*$/;

/**
 * Plain text: paragraphs are separated by blank lines; single newlines inside
 * a paragraph are hard wraps and become spaces. A line of only dashes,
 * equals, stars or underscores is a rule and becomes a pause. Bare URLs and
 * emails get their spoken forms. That is the whole format.
 */
export function normalizeText(text: string, sourceId: string): SpeakBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks: SpeakBlock[] = [];
  let pos = 0;
  for (const raw of normalized.split(/\n[ \t]*\n+/)) {
    const start = normalized.indexOf(raw, pos);
    pos = start + raw.length;
    if (raw.trim().length === 0) continue;
    if (RULE_LINE_RE.test(raw)) {
      blocks.push({ type: 'pause', sourceId, provenance: { start, end: pos } });
      continue;
    }
    const spoken = collapseWhitespace(speakInlineUrls(raw));
    if (spoken.length === 0) continue;
    blocks.push({ type: 'paragraph', sourceId, text: spoken, provenance: { start, end: pos } });
  }
  return blocks;
}
