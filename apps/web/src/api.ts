import type { BatchResult, SpokenSegment } from '@narrate/core';

/** Mirror of the server's NormalizeResponse; the server owns the shape. */
export interface NormalizeResponse extends BatchResult {
  spoken: SpokenSegment[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse(res: Response): Promise<NormalizeResponse> {
  const body = (await res.json().catch(() => null)) as
    (NormalizeResponse & { error?: string; code?: string }) | null;
  if (!res.ok || !body) {
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.code);
  }
  return body;
}

/** Files are sent in list order; the server builds one chapter per file in that order. */
export async function normalizeFiles(files: readonly File[]): Promise<NormalizeResponse> {
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  return parse(await fetch('/api/normalize', { method: 'POST', body: fd }));
}

export async function normalizeText(text: string): Promise<NormalizeResponse> {
  return parse(
    await fetch('/api/normalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  );
}
