import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSource, spokenText } from '../src/index.js';
import type { SpeakBlock } from '../src/index.js';

const fixture = readFileSync(new URL('./fixtures/elements.md', import.meta.url), 'utf8');

async function md(text: string, filename = 'doc.md') {
  return normalizeSource({ text, filename });
}

function flat(blocks: readonly SpeakBlock[]): SpeakBlock[] {
  return blocks.flatMap((b) =>
    b.type === 'quote' || b.type === 'aside' ? [b, ...flat(b.blocks)] : [b],
  );
}

describe('markdown normalizer', () => {
  it('produces the golden spoken text for the element fixture', async () => {
    const { document } = await md(fixture);
    expect(spokenText(document)).toMatchSnapshot();
  });

  it('makes H1–H3 chapters and speaks H4+ without indexing', async () => {
    const { document } = await md(fixture);
    const headings = document.blocks.filter((b) => b.type === 'heading');
    const h1 = headings.find((h) => h.level === 1)!;
    const h4 = headings.find((h) => h.level === 4)!;
    expect(h1.chapter).toBe(true);
    expect(h4.chapter).toBe(false);
    expect(h4.text).toBe('Deep Heading Four');
    expect(document.title).toBe('Narrate Fixture Document');
  });

  it('never says "heading level"', async () => {
    const { document } = await md(fixture);
    expect(spokenText(document).toLowerCase()).not.toContain('heading level');
  });

  it('speaks emphasis, strikethrough and inline code as plain text', async () => {
    const { document } = await md('Text with **bold**, *italic*, ~~struck~~ and `code()`.');
    expect(spokenText(document)).toBe('Text with bold, italic, struck and code().');
  });

  it('collapses hard-wrapped lines inside a paragraph', async () => {
    const { document } = await md('one\ntwo\nthree');
    expect(spokenText(document)).toBe('one two three');
  });

  it('speaks descriptive link text only, and bare URLs as "Link to host"', async () => {
    const { document } = await md(
      'See [the docs](https://example.com/a/b?c=1). Or https://www.example.org/x/y. Or <https://docs.example.net/g>.',
    );
    expect(spokenText(document)).toBe(
      'See the docs. Or Link to example dot org. Or Link to docs dot example dot net.',
    );
  });

  it('resolves reference-style links', async () => {
    const { document } = await md(
      'A [ref link][r] and a bare [https://x.io][r2].\n\n[r]: https://x.io/a\n[r2]: https://x.io',
    );
    expect(spokenText(document)).toBe('A ref link and a bare Link to x dot io.');
  });

  it('speaks emails with "at" and "dot"', async () => {
    const { document } = await md('Mail jane.doe@example.com now.');
    expect(spokenText(document)).toBe('Mail jane dot doe at example dot com now.');
  });

  it('speaks meaningful alt text and omits empty or generic alt', async () => {
    const { document } = await md(
      '![A chart of revenue](c.png)\n\n![](d.png)\n\n![screenshot](s.png)\n\n![photo.jpg](p.jpg)',
    );
    expect(spokenText(document)).toBe('Image: A chart of revenue.');
    expect(document.diagnostics.filter((d) => d.kind === 'omitted-image')).toHaveLength(3);
  });

  it('speaks bullets plainly, ordered items with word ordinals, tasks with state', async () => {
    const { document } = await md('- a\n- b\n\n1. x\n2. y\n\n- [x] done\n- [ ] open');
    expect(spokenText(document).split('\n\n')).toEqual([
      'a',
      'b',
      'One. x',
      'Two. y',
      'Checked. done',
      'Not checked. open',
    ]);
  });

  it('flattens nested lists with depth', async () => {
    const { document } = await md('- outer\n  - inner\n    - deeper');
    const items = document.blocks.filter((b) => b.type === 'list-item');
    expect(items.map((i) => [i.text, i.depth])).toEqual([
      ['outer', 0],
      ['inner', 1],
      ['deeper', 2],
    ]);
  });

  it('wraps a whole blockquote in Quote / End quote once', async () => {
    const { document } = await md('> first\n>\n> second');
    expect(spokenText(document)).toBe('Quote.\n\nfirst\n\nsecond\n\nEnd quote.');
  });

  it('omits code blocks but keeps the source and a diagnostic', async () => {
    const { document } = await md('```ts\nconst x = 1;\n```\n\n    indented');
    const code = document.blocks.filter((b) => b.type === 'code-omission');
    expect(code).toHaveLength(2);
    expect(code[0]!.code).toBe('const x = 1;');
    expect(code[0]!.lang).toBe('ts');
    expect(spokenText(document)).toBe('Code block omitted.\n\nCode block omitted.');
    expect(document.diagnostics.filter((d) => d.kind === 'omitted-code')).toHaveLength(2);
  });

  it('reads small tables row-wise with header labels', async () => {
    const { document } = await md(
      '| Name | Role |\n| - | - |\n| Ada | Engineer |\n| Grace | Admiral |',
    );
    expect(spokenText(document)).toBe(
      'Table.\n\nName: Ada; Role: Engineer.\n\nName: Grace; Role: Admiral.',
    );
  });

  it('summarizes tables wider than 6 columns or longer than 20 rows', async () => {
    const wide =
      '| a | b | c | d | e | f | g |\n| - | - | - | - | - | - | - |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |';
    const rows = Array.from({ length: 21 }, (_, i) => `| r${i} | v${i} |`).join('\n');
    const long = `| k | v |\n| - | - |\n${rows}`;
    expect(spokenText((await md(wide)).document)).toBe('Table, 1 row by 7 columns, omitted.');
    expect(spokenText((await md(long)).document)).toBe('Table, 21 rows by 2 columns, omitted.');
    const twenty = `| k | v |\n| - | - |\n${Array.from({ length: 20 }, (_, i) => `| r${i} | v${i} |`).join('\n')}`;
    expect((await md(twenty)).document.blocks[0]).toMatchObject({ type: 'table', omitted: false });
  });

  it('never speaks a header label for an empty cell', async () => {
    const { document } = await md('| Name | Value |\n| - | - |\n| Ada | |\n| | 2 |');
    expect(spokenText(document)).toBe('Table.\n\nName: Ada.\n\nValue: 2.');
  });

  it('turns horizontal rules into pauses', async () => {
    const { document } = await md('a\n\n---\n\nb');
    expect(document.blocks.map((b) => b.type)).toEqual(['paragraph', 'pause', 'paragraph']);
  });

  it('numbers footnotes by first reference and moves bodies to the end of the section', async () => {
    const src =
      '# A\n\nClaim[^x] and more[^y].\n\nStill section A.\n\n# B\n\nSection B.\n\n[^y]: Body Y.\n[^x]: Body X.';
    const { document } = await md(src);
    expect(spokenText(document).split('\n\n')).toEqual([
      'A.',
      'Claim footnote one and more footnote two.',
      'Still section A.',
      'Footnote one. Body X.',
      'Footnote two. Body Y.',
      'B.',
      'Section B.',
    ]);
  });

  it('parses embedded HTML structurally instead of stripping tags', async () => {
    const { document } = await md(
      '<div><p>Block html.</p></div>\n\nInline <b>bold</b> and a<br>break.',
    );
    expect(spokenText(document)).toBe('Block html.\n\nInline bold and a break.');
  });

  it('reports elements dropped from HTML embedded in Markdown', async () => {
    const { document } = await md('# T\n\n<div><script>x()</script><p>kept</p></div>');
    expect(spokenText(document)).toBe('T.\n\nkept');
    expect(document.diagnostics.map((d) => d.detail)).toContain('Dropped 1 <script> element');
  });

  it('records provenance offsets on blocks', async () => {
    const src = 'first\n\nsecond';
    const { document } = await md(src);
    const second = document.blocks[1]!;
    expect(src.slice(second.provenance!.start, second.provenance!.end)).toBe('second');
  });

  it('keeps every block pointing at its source record', async () => {
    const { document } = await md(fixture);
    for (const b of flat(document.blocks)) expect(b.sourceId).toBe('src-1');
    expect(document.sources[0]!.format).toBe('markdown');
    expect(document.sources[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
