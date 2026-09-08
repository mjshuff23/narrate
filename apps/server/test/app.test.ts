import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, LIMITS } from '../src/app.js';
import type { NormalizeResponse } from '../src/app.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function multipart(files: { name: string; content: string | Uint8Array }[]): FormData {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([f.content]), f.name);
  return fd;
}

describe('GET /api/health', () => {
  it('answers', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('POST /api/normalize', () => {
  it('normalizes pasted text and returns document, results and spoken segments', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '# Hello\n\nA [link](https://e.com).' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NormalizeResponse;
    expect(body.results).toEqual([
      expect.objectContaining({
        ok: true,
        detection: expect.objectContaining({ format: 'markdown' }),
      }),
    ]);
    expect(body.document.title).toBe('Hello');
    expect(body.spoken.map((s) => s.text)).toEqual(['Hello.', 'A link.']);
  });

  it('normalizes uploaded files in the order sent, one chapter per file', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      body: multipart([
        { name: 'b-second.txt', content: 'second body' },
        { name: 'a-first.md', content: '# First\n\nfirst body' },
      ]),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NormalizeResponse;
    expect(body.results.map((r) => r.filename)).toEqual(['b-second.txt', 'a-first.md']);
    expect(body.spoken.map((s) => s.text)).toEqual([
      'b-second.',
      'second body',
      'First.',
      'first body',
    ]);
  });

  it('reports an unsupported or not-yet-supported file per source without sinking the batch', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      body: multipart([
        { name: 'r.pdf', content: '%PDF-1.7\n1 0 obj\nendobj\n%%EOF' },
        { name: 'ok.txt', content: 'fine' },
        {
          name: 'pic.png',
          content: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
          ]),
        },
      ]),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as NormalizeResponse;
    expect(body.results.map((r) => (r.ok ? 'ok' : r.code))).toEqual([
      'not-yet-supported',
      'ok',
      'unsupported',
    ]);
    expect(body.spoken.map((s) => s.text)).toEqual(['ok.', 'fine']);
  });

  it('rejects an empty request with 400', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects oversized pasted text with 413', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(LIMITS.jsonBytes + 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'LIMIT_TEXT_SIZE' });
  });

  it('rejects an oversized upload with 413 and a Multer code', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      body: multipart([{ name: 'big.txt', content: new Uint8Array(LIMITS.fileBytes + 1) }]),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'LIMIT_FILE_SIZE' });
  });

  it('keeps only the basename of a user-supplied filename', async () => {
    const res = await fetch(`${base}/api/normalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi', filename: '../../etc/passwd' }),
    });
    const body = (await res.json()) as NormalizeResponse;
    expect(body.results[0]?.filename).toBe('passwd');
  });
});
