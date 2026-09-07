import type { SpeakBlock, SpeakDocument } from './types.js';
import { ensureTerminalPunctuation, numberToWords } from './speakable/inline.js';

export interface SpokenSegment {
  /** Empty text with pause=true is a deliberate silence (horizontal rule). */
  text: string;
  kind: SpeakBlock['type'];
  /** Index path into SpeakDocument.blocks (nested for quote/aside children). */
  path: number[];
  pause?: true;
}

/**
 * Blocks → the exact text a voice will read, one segment per block, with
 * block-level framing applied: "Quote. … End quote.", ordinals, task state,
 * "Table." rows, "Image: …", "Code block omitted." The chunker consumes
 * these segments; providers never see anything else.
 */
export function renderSpoken(doc: SpeakDocument): SpokenSegment[] {
  const out: SpokenSegment[] = [];
  renderBlocks(doc.blocks, [], out);
  return out;
}

/** Convenience for previews and tests: all spoken segments joined by blank lines. */
export function spokenText(doc: SpeakDocument): string {
  return renderSpoken(doc)
    .map((s) => s.text)
    .filter((t) => t.length > 0)
    .join('\n\n');
}

function renderBlocks(blocks: readonly SpeakBlock[], path: number[], out: SpokenSegment[]): void {
  blocks.forEach((block, i) => renderBlock(block, [...path, i], out));
}

function renderBlock(block: SpeakBlock, path: number[], out: SpokenSegment[]): void {
  const seg = (text: string) => out.push({ text, kind: block.type, path });
  switch (block.type) {
    case 'heading':
      seg(ensureTerminalPunctuation(block.text));
      break;
    case 'paragraph':
      seg(block.text);
      break;
    case 'list-item': {
      const prefix: string[] = [];
      if (block.ordered && block.index !== undefined)
        prefix.push(`${capitalize(numberToWords(block.index))}.`);
      if (block.checked === true) prefix.push('Checked.');
      else if (block.checked === false) prefix.push('Not checked.');
      seg([...prefix, block.text].join(' '));
      break;
    }
    case 'quote':
      seg('Quote.');
      renderBlocks(block.blocks, path, out);
      seg('End quote.');
      break;
    case 'aside':
      seg('Aside.');
      renderBlocks(block.blocks, path, out);
      break;
    case 'table': {
      const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length), 0);
      if (block.omitted) {
        seg(`Table, ${block.rows.length} rows by ${cols} columns, omitted.`);
        break;
      }
      seg('Table.');
      for (const row of block.rows) {
        const cells = row.map((cell, i) => {
          const h = block.header[i];
          return h && cell ? `${h}: ${cell}` : cell || h || '';
        });
        const line = cells.filter(Boolean).join('; ');
        if (line) seg(ensureTerminalPunctuation(line));
      }
      break;
    }
    case 'image-alt':
      seg(`Image: ${ensureTerminalPunctuation(block.alt)}`);
      break;
    case 'code-omission':
      seg('Code block omitted.');
      break;
    case 'pause':
      out.push({ text: '', kind: 'pause', path, pause: true });
      break;
    case 'footnote':
      seg(`Footnote ${numberToWords(block.index)}. ${block.text}`);
      break;
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
