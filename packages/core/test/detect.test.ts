import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  normalizeSource,
  normalizeSources,
  NotYetSupportedError,
  UnsupportedFormatError,
  zipEntryNames,
} from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal but structurally valid ZIP (stored entries, real central directory, EOCD). */
function zip(names: string[]): Uint8Array {
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const local: number[] = [];
  const central: number[] = [];
  for (const name of names) {
    const nb = [...enc(name)];
    const data = [...enc('x')];
    const offset = local.length;
    // local file header: sig, version, flags, method, time, date, crc, csize, usize, nlen, xlen
    local.push(0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0));
    local.push(
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nb.length),
      ...u16(0),
      ...nb,
      ...data,
    );
    // central directory header: sig, vmade, vneed, flags, method, time, date, crc, csize, usize,
    // nlen, xlen, clen, disk, iattr, eattr, local offset, name
    central.push(
      0x50,
      0x4b,
      1,
      2,
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
    );
    central.push(
      ...u32(0),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nb.length),
      ...u16(0),
      ...u16(0),
    );
    central.push(...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nb);
  }
  const eocd = [0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(names.length), ...u16(names.length)];
  eocd.push(...u32(central.length), ...u32(local.length), ...u16(0));
  return new Uint8Array([...local, ...central, ...eocd]);
}
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
    expect(d.warnings[0]?.detail).toMatch(/notes\.txt contains HTML and was interpreted as HTML/);
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
    expect(d.warnings[0]?.detail).toMatch(/PDF signature/);
  });

  it('a .pdf that is actually text is interpreted as text with a warning', async () => {
    const d = await detectFormat({ bytes: enc(PROSE), filename: 'fake.pdf' });
    expect(d.format).toBe('txt');
    expect(d.warnings[0]?.detail).toMatch(/named like a PDF but contains text/);
  });

  it('a DOCX container is detected from its ZIP central directory, not from stray bytes', async () => {
    const docx = zip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    const d = await detectFormat({ bytes: docx, filename: 'letter.docx' });
    expect(d.format).toBe('docx');
    expect(zipEntryNames(docx)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ]);
    // The same strings as payload bytes, without a directory entry, must not count.
    const decoy = zip(['readme.txt']);
    const withDecoy = new Uint8Array([
      ...decoy.subarray(0, 30),
      ...enc('word/document.xml'),
      ...decoy.subarray(30),
    ]);
    await expect(detectFormat({ bytes: withDecoy, filename: 'x.docx' })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('a ZIP that is not DOCX is rejected, as is a ZIP with no central directory', async () => {
    await expect(
      detectFormat({ bytes: zip(['something/else.txt']), filename: 'archive.docx' }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
    const truncated = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...enc('....')]);
    await expect(
      detectFormat({ bytes: truncated, filename: 'broken.docx' }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('rejects a ZIP whose only EOCD signature sits inside a comment, and one whose directory overruns', async () => {
    const good = zip(['[Content_Types].xml', 'word/document.xml']);
    // Append bytes containing a fake EOCD signature: the real EOCD no longer ends the file.
    const commented = new Uint8Array([...good, 0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    expect(zipEntryNames(commented)).toBeUndefined();
    // Corrupt the first central-directory name length so the record claims to run past the EOCD.
    const overrun = new Uint8Array(good);
    const cd =
      good.length - 22 - (46 + '[Content_Types].xml'.length) - (46 + 'word/document.xml'.length);
    overrun[cd + 28] = 0xff;
    overrun[cd + 29] = 0xff;
    expect(zipEntryNames(overrun)).toBeUndefined();
    await expect(detectFormat({ bytes: overrun, filename: 'x.docx' })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
  });

  it('prose that quotes a PDF header, even a versioned one at line start, stays text', async () => {
    for (const text of [
      'The %PDF- marker is how readers spot a PDF.\n\nMore prose.',
      'Every PDF begins with %PDF-1.4 or similar.\n\nMore prose.',
      'Header line:\n%PDF-1.7\nThat is all the file needs, the article claimed.',
    ]) {
      expect((await detectFormat({ bytes: enc(text), filename: 'n.txt' })).format).toBe('txt');
    }
  });

  it('a real PDF is detected with junk before the header, even straddling the 1024-byte window', async () => {
    const body = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n';
    expect((await detectFormat({ bytes: enc(body) })).format).toBe('pdf');
    const junk = `${'x'.repeat(1020)}\n${body}`; // header begins at byte 1021, version ends past 1024
    expect((await detectFormat({ bytes: enc(junk), filename: 'r.pdf' })).format).toBe('pdf');
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

  it('a text line followed by dashes is a divider, not a setext heading, for detection', async () => {
    expect((await detectFormat({ text: 'before\n---\nafter', filename: 'n.txt' })).format).toBe(
      'txt',
    );
    expect((await detectFormat({ text: 'Title\n=====\n\nprose' })).format).toBe('txt');
    // Inside a real Markdown file it is still a heading.
    const { document } = await normalizeSource({ text: 'Title\n=====\n\nprose', filename: 'n.md' });
    expect(document.blocks[0]).toMatchObject({ type: 'heading', level: 1, text: 'Title' });
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
    expect(d.warnings[0]).toMatchObject({
      kind: 'encoding',
      detail: expect.stringMatching(/not valid UTF-8/),
    });
  });
});

describe('normalizeSource / normalizeSources', () => {
  it('detected PDF and DOCX are reported as not yet supported, not silently narrated', async () => {
    await expect(
      normalizeSource({ bytes: enc('%PDF-1.4'), filename: 'r.pdf' }),
    ).rejects.toBeInstanceOf(NotYetSupportedError);
  });

  it('carries detection warnings into diagnostics, one per warning, typed by cause', async () => {
    const { document } = await normalizeSource({ bytes: enc(HTML_DOC), filename: 'notes.txt' });
    expect(document.diagnostics.filter((d) => d.kind === 'detection-conflict')).toHaveLength(1);
    const latin = await normalizeSource({
      bytes: new Uint8Array([...enc('caf'), 0xe9]),
      filename: 'c.txt',
    });
    expect(latin.document.diagnostics.map((d) => d.kind)).toEqual(['encoding']);
    // The filename never influences the kind, even when it looks like an encoding name.
    const tricky = await normalizeSource({ bytes: enc(HTML_DOC), filename: 'UTF-8.txt' });
    expect(tricky.document.diagnostics.map((d) => d.kind)).toEqual(['detection-conflict']);
  });

  it('a single source gets no synthetic chapter heading', async () => {
    const doc = await normalizeSources([{ text: 'just prose' }]);
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph']);
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
