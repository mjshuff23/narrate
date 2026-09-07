import { describe, expect, it } from 'vitest';
import { normalizeSource, spokenText } from '../src/index.js';

async function txt(text: string) {
  return normalizeSource({ text, filename: 'notes.txt' });
}

describe('plain text normalizer', () => {
  it('splits paragraphs on blank lines and joins hard wraps', async () => {
    const { document } = await txt('line one\nline two\n\n\nsecond para\r\nwrapped');
    expect(spokenText(document)).toBe('line one line two\n\nsecond para wrapped');
  });

  it('speaks bare URLs and emails', async () => {
    const { document } = await txt(
      'Visit https://www.example.com/path?x=1, or email a.b@example.org.',
    );
    expect(spokenText(document)).toBe(
      'Visit Link to example dot com, or email a dot b at example dot org.',
    );
  });

  it('turns rule lines into pauses', async () => {
    const { document } = await txt('a\n\n-----\n\nb\n\n=====\n\nc');
    expect(document.blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'pause',
      'paragraph',
      'pause',
      'paragraph',
    ]);
  });

  it('records provenance offsets against the original text, CRLF included', async () => {
    for (const src of [
      'first\n\nsecond one',
      'first\r\n\r\nsecond one',
      'first\r\n  \r\n\r\nsecond one',
    ]) {
      const { document } = await txt(src);
      const b = document.blocks[1]!;
      expect(src.slice(b.provenance!.start, b.provenance!.end)).toBe('second one');
    }
  });

  it('detects a rule line inside a chunk, not only between blank lines', async () => {
    const src = 'before\n---\nafter';
    const { document } = await txt(src);
    expect(document.blocks.map((b) => b.type)).toEqual(['paragraph', 'pause', 'paragraph']);
    const pause = document.blocks[1]!;
    expect(src.slice(pause.provenance!.start, pause.provenance!.end)).toBe('---');
    expect(spokenText(document)).toBe('before\n\nafter');
  });
});
