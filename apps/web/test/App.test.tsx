import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { NormalizeResponse } from '../src/api';

const response: NormalizeResponse = {
  document: {
    version: 1,
    title: 'Hello',
    sources: [],
    blocks: [
      { type: 'heading', level: 1, text: 'Hello', chapter: true, sourceId: 'src-1' },
      { type: 'paragraph', text: 'A link.', sourceId: 'src-1' },
    ],
    diagnostics: [
      { kind: 'omitted-code', sourceId: 'src-1', detail: 'Code block omitted (2 lines)' },
    ],
  },
  results: [
    {
      index: 0,
      filename: 'notes.txt',
      ok: true,
      sourceId: 'src-1',
      detection: {
        format: 'markdown',
        confidence: 'strong',
        declaredFormat: 'txt',
        evidence: [],
        warnings: [
          {
            kind: 'detection-conflict',
            detail: 'notes.txt contains Markdown and was interpreted as Markdown',
          },
        ],
      },
    },
  ],
  spoken: [
    { kind: 'heading', text: 'Hello.', path: [0] },
    { kind: 'pause', text: '', path: [1], pause: true },
    { kind: 'paragraph', text: 'A link.', path: [2] },
  ],
};

function mockFetch(body: unknown, status = 200) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('pastes text, submits JSON, and renders the spoken preview with warnings and diagnostics', async () => {
    const fetch = mockFetch(response);
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paste' }));
    const box = screen.getByLabelText('Paste text, Markdown or HTML');
    fireEvent.change(box, { target: { value: '# Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /preview what will be spoken/i }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Speakable preview' })).toBeTruthy(),
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/normalize');
    expect(JSON.parse(init.body as string)).toEqual({ text: '# Hello' });

    const spoken = screen.getByRole('list', { name: 'Spoken text' });
    expect(spoken.textContent).toContain('Hello.');
    expect(spoken.textContent).toContain('A link.');
    expect(spoken.querySelectorAll('.spoken__pause')).toHaveLength(1);
    expect(screen.getByText(/interpreted as Markdown/)).toBeTruthy();
    expect(screen.getByText(/1 thing left out/)).toBeTruthy();
  });

  it('accepts dropped files into an ordered list, reorders and removes them, then submits multipart in order', async () => {
    const fetch = mockFetch(response);
    render(<App />);
    const zone = screen.getByTestId('dropzone');
    const a = new File(['a'], 'a.md', { type: 'text/markdown' });
    const b = new File(['bb'], 'b.txt', { type: 'text/plain' });
    fireEvent.dragEnter(zone);
    expect(zone.className).toContain('dropzone--active');
    fireEvent.drop(zone, { dataTransfer: { files: [a, b], types: ['Files'] } });
    expect(zone.className).not.toContain('dropzone--active');

    const list = screen.getByRole('list', { name: 'Files in narration order' });
    expect(Array.from(list.querySelectorAll('.filelist__name')).map((n) => n.textContent)).toEqual([
      'a.md',
      'b.txt',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Move b.txt up' }));
    expect(Array.from(list.querySelectorAll('.filelist__name')).map((n) => n.textContent)).toEqual([
      'b.txt',
      'a.md',
    ]);

    // Dropping the same file again does not duplicate it.
    fireEvent.drop(zone, { dataTransfer: { files: [a], types: ['Files'] } });
    expect(list.querySelectorAll('li')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /preview what will be spoken/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const fd = init.body as FormData;
    expect(fd.getAll('files').map((f) => (f as File).name)).toEqual(['b.txt', 'a.md']);

    fireEvent.click(screen.getByRole('button', { name: 'Remove a.md' }));
    expect(list.querySelectorAll('li')).toHaveLength(1);
  });

  it('opens the native picker from the keyboard and lists chosen files', () => {
    render(<App />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(screen.getByTestId('dropzone'), { key: 'Enter' });
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File(['x'], 'picked.html')] } });
    expect(screen.getByText('picked.html')).toBeTruthy();
  });

  it('shows the server error message', async () => {
    mockFetch({ error: 'Pasted text is too large', code: 'LIMIT_TEXT_SIZE' }, 413);
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Paste' }));
    fireEvent.change(screen.getByLabelText('Paste text, Markdown or HTML'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /preview what will be spoken/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Pasted text is too large'),
    );
  });
});
