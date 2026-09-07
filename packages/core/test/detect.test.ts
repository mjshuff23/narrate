import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  normalizeSource,
  normalizeSources,
  NotYetSupportedError,
  UnsupportedFormatError,
} from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);
const PROSE = 'This is ordinary prose.\n\nIt has two paragraphs and no markup at all.';
const HTML_DOC = '<!DOCTYPE html><html><body><h1>T</h1><p>Body text here.</p></body></html>';
const HTML_FRAG = '<div><p>One</p><p>Two</p><ul><li>x</li></ul></div>';
const MD = '# Title\n\nSome prose with a [link](https://e.com).\n\n- item one\n- item two';

describe('format detection precedence', () => {
  it('a .txt file that contains an HTML document is detected as HTML, with a warning', async () => {
    const d = await detectFormat({ bytes: enc(HTML_DOC), filename: 'notes.txt' });
    expect(d.format).toBe('html');
    expect(d.confidence).toBe('strong');
    expect(d.declaredFormat).toBe('txt');
    expect(d.warnings[0]).toMatch(/notes\.txt contains HTML and was interpreted as HTML/);
  });

  it('a .txt file with strong Markdown structure is detected as Markdown', async () => {
    const d = await detectFormat({ bytes: enc(MD), filename: 'notes.txt' });
    expect(d.format).toBe('markdown');
    expect(d.confidence).toBe('strong');
  });

  it('a renamed PDF wins over its .txt extension', async () => {
    const bytes = enc('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj');
    const d = await detectFormat({ bytes, filename: 'report.txt' });
    expect(d.format).toBe('pdf');
    expect(d.confidence).toBe('strong');
    expect(d.warnings[0]).toMatch(/PDF signature/);
  });

  it('a .pdf that is actually text is interpreted as text with a warning', async () => {
    const d = await detectFormat({ bytes: enc(PROSE), filename: 'fake.pdf' });
    expect(d.format).toBe('txt');
    expect(d.warnings[0]).toMatch(/named like a PDF but contains text/);
  });

  it('a DOCX container is detected from its ZIP contents', async () => {
    const bytes = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...enc('....[Content_Types].xml....word/document.xml....'),
    ]);
    const d = await detectFormat({ bytes, filename: 'letter.docx' });
    expect(d.format).toBe('docx');
  });

  it('a ZIP that is not DOCX is rejected', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc('....something/else.txt....')]);
    await expect(detectFormat({ bytes, filename: 'archive.docx' })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('a recognizable binary such as PNG is rejected', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    await expect(detectFormat({ bytes: png, filename: 'x.txt' })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('pasted text with no extension: HTML structure wins, then Markdown, then plain text', async () => {
    expect((await detectFormat({ text: HTML_FRAG })).format).toBe('html');
    expect((await detectFormat({ text: MD })).format).toBe('markdown');
    const plain = await detectFormat({ text: PROSE });
    expect(plain.format).toBe('txt');
    expect(plain.confidence).toBe('default');
  });

  it('a lone angle-bracket expression in prose does not become HTML', async () => {
    const d = await detectFormat({
      text: 'If a < b and c > d, then nothing happens.\n\nSecond paragraph.',
    });
    expect(d.format).toBe('txt');
  });

  it('a single inline tag or a single list line is too weak to override plain text', async () => {
    expect((await detectFormat({ text: 'Some <b>bold</b> text.', filename: 'a.txt' })).format).toBe(
      'txt',
    );
    expect((await detectFormat({ text: 'Groceries\n\n- eggs', filename: 'a.txt' })).format).toBe(
      'txt',
    );
  });

  it('a .md file is always Markdown, even without markup', async () => {
    const d = await detectFormat({ text: PROSE, filename: 'plain.md' });
    expect(d.format).toBe('markdown');
    expect(d.confidence).toBe('weak');
    expect(d.warnings).toEqual([]);
  });

  it('Markdown with a little inline HTML stays Markdown', async () => {
    const d = await detectFormat({ text: `${MD}\n\nA line with <br> and <b>bold</b>.` });
    expect(d.format).toBe('markdown');
  });
});

describe('text decoding', () => {
  it('honours a UTF-8 BOM', async () => {
    const d = await detectFormat({ bytes: new Uint8Array([0xef, 0xbb, 0xbf, ...enc('héllo')]) });
    expect(d.text).toBe('héllo');
    expect(d.encoding).toBe('utf-8 (BOM)');
  });

  it('honours a UTF-16LE BOM', async () => {
    const body = Buffer.from('hi there', 'utf16le');
    const d = await detectFormat({ bytes: new Uint8Array([0xff, 0xfe, ...body]) });
    expect(d.text).toBe('hi there');
  });

  it('falls back to Windows-1252 with a warning when bytes are not UTF-8', async () => {
    const d = await detectFormat({
      bytes: new Uint8Array([...enc('caf'), 0xe9, ...enc(' au lait')]),
    });
    expect(d.text).toBe('café au lait');
    expect(d.encoding).toBe('windows-1252');
    expect(d.warnings[0]).toMatch(/not valid UTF-8/);
  });
});

describe('normalizeSource / normalizeSources', () => {
  it('detected PDF and DOCX are reported as not yet supported, not silently narrated', async () => {
    await expect(
      normalizeSource({ bytes: enc('%PDF-1.4'), filename: 'r.pdf' }),
    ).rejects.toBeInstanceOf(NotYetSupportedError);
  });

  it('carries detection warnings into diagnostics', async () => {
    const { document } = await normalizeSource({ bytes: enc(HTML_DOC), filename: 'notes.txt' });
    expect(document.diagnostics.some((d) => d.kind === 'detection-conflict')).toBe(true);
  });

  it('combines several sources in order, one chapter per file unless the file opens with an H1', async () => {
    const doc = await normalizeSources([
      { text: 'plain notes', filename: 'notes.txt' },
      { text: '# Own Title\n\nbody', filename: 'own.md' },
      { text: 'pasted' },
    ]);
    const headings = doc.blocks.filter((b) => b.type === 'heading').map((h) => h.text);
    expect(headings).toEqual(['notes', 'Own Title', 'Pasted text 3']);
    expect(doc.sources.map((s) => s.id)).toEqual(['src-1', 'src-2', 'src-3']);
    expect(doc.blocks.filter((b) => b.type === 'paragraph').map((b) => b.sourceId)).toEqual([
      'src-1',
      'src-2',
      'src-3',
    ]);
  });
});
