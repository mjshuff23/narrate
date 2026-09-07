import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSource, spokenText } from '../src/index.js';

const page = readFileSync(new URL('./fixtures/page.html', import.meta.url), 'utf8');
const dominant = readFileSync(new URL('./fixtures/article-dominant.html', import.meta.url), 'utf8');

async function html(text: string, filename = 'page.html') {
  return normalizeSource({ text, filename });
}

describe('html normalizer', () => {
  it('produces the golden spoken text for the page fixture', async () => {
    const { document } = await html(page);
    expect(spokenText(document)).toMatchSnapshot();
  });

  it('drops script, style, noscript, form and nav entirely, with diagnostics', async () => {
    const { document } = await html(page);
    const spoken = spokenText(document);
    expect(spoken).not.toContain('window.track');
    expect(spoken).not.toContain('color: red');
    expect(spoken).not.toContain('Enable JS');
    expect(spoken).not.toContain('Search');
    expect(spoken).not.toContain('About');
    const dropped = document.diagnostics
      .filter((d) => d.kind === 'dropped-element')
      .map((d) => d.detail);
    expect(dropped.join(' ')).toMatch(/<script>/);
    expect(dropped.join(' ')).toMatch(/<nav>/);
    expect(dropped.join(' ')).toMatch(/<form>/);
  });

  it('prefers <main> as the content root, so header and footer chrome vanish', async () => {
    const { document } = await html(page);
    const spoken = spokenText(document);
    expect(spoken).not.toContain('Site Banner Heading');
    expect(spoken).not.toContain('Footer text');
    expect(document.title).toBe('Article & Title');
  });

  it('uses a single dominant <article> when there is no <main>', async () => {
    const { document } = await html(dominant);
    const spoken = spokenText(document);
    expect(spoken).toContain('Dominant Article');
    expect(spoken).not.toContain('Ad');
    expect(spoken).not.toContain('More');
  });

  it('falls back to <title> when there is no H1', async () => {
    const { document } = await html(
      '<html><head><title>Only Title</title></head><body><p>x</p></body></html>',
    );
    expect(document.title).toBe('Only Title');
  });

  it('omits hidden and aria-hidden content', async () => {
    const { document } = await html(page);
    const spoken = spokenText(document);
    expect(spoken).not.toContain('Hidden paragraph');
    expect(spoken).not.toContain('Aria hidden');
    expect(spoken).not.toContain('Display none');
  });

  it('decodes entities before narration', async () => {
    const { document } = await html(page);
    expect(spokenText(document)).toContain('Entities: <tag> & "quoted" © 2026.');
  });

  it('speaks anchor text, or "Link to host" for bare links', async () => {
    const { document } = await html(
      '<p>An <a href="https://example.com/x?y=1">example link</a> and <a href="https://www.example.org/deep">https://www.example.org/deep</a>.</p>',
    );
    expect(spokenText(document)).toBe('An example link and Link to example dot org.');
  });

  it('applies image alt rules in paragraphs, standalone and figures', async () => {
    const { document } = await html(page);
    const spoken = spokenText(document);
    expect(spoken).toContain('Image: A cat sitting on a keyboard.');
    expect(spoken).toContain('Image: Bar chart of monthly signups.');
    expect(spoken).toContain('Figure 1: signups.');
    expect(spoken).not.toContain('logo');
    expect(document.diagnostics.filter((d) => d.kind === 'omitted-image')).toHaveLength(2);
  });

  it('handles lists with start offsets and nesting', async () => {
    const { document } = await html(page);
    const items = document.blocks.filter((b) => b.type === 'list-item');
    expect(items.map((i) => [i.text, i.ordered, i.index ?? null, i.depth])).toEqual([
      ['Alpha', false, null, 0],
      ['Beta', false, null, 0],
      ['Beta nested', false, null, 1],
      ['Third', true, 3, 0],
      ['Fourth', true, 4, 0],
    ]);
    expect(spokenText(document)).toContain('Three. Third\n\nFour. Fourth');
  });

  it('wraps blockquotes and prefixes asides once', async () => {
    const { document } = await html(
      '<blockquote><p>q1</p><p>q2</p></blockquote><aside><p>note</p></aside>',
    );
    expect(spokenText(document)).toBe('Quote.\n\nq1\n\nq2\n\nEnd quote.\n\nAside.\n\nnote');
  });

  it('omits <pre> code but records language and source', async () => {
    const { document } = await html(page);
    const code = document.blocks.find((b) => b.type === 'code-omission')!;
    expect(code.lang).toBe('python');
    expect(code.code).toContain('print("hi")');
    expect(spokenText(document)).toContain('Code block omitted.');
  });

  it('reads tables with thead labels', async () => {
    const { document } = await html(page);
    expect(spokenText(document)).toContain(
      'Table.\n\nName: Alpha; Value: 1.\n\nName: Beta; Value: 2.',
    );
  });

  it('gathers loose inline text in containers into paragraphs', async () => {
    const { document } = await html(
      '<div>Loose text<span> with a span</span>.<p>Para.</p>tail</div>',
    );
    expect(spokenText(document)).toBe('Loose text with a span.\n\nPara.\n\ntail');
  });

  it('treats <hr> as a pause', async () => {
    const { document } = await html('<p>a</p><hr><p>b</p>');
    expect(document.blocks.map((b) => b.type)).toEqual(['paragraph', 'pause', 'paragraph']);
  });
});
