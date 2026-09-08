import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeBatch, renderSpoken } from '@narrate/core';
import type { BatchResult, DetectInput, SpokenSegment } from '@narrate/core';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

/** Everything the client needs to show a preview, in one response. */
export interface NormalizeResponse extends BatchResult {
  spoken: SpokenSegment[];
}

export const LIMITS = {
  /** Per uploaded file. Generous for text; PDFs arrive in a later slice with their own limit. */
  fileBytes: 25 * 1024 * 1024,
  files: 20,
  /** Pasted text over JSON. */
  jsonBytes: 5 * 1024 * 1024,
} as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.fileBytes, files: LIMITS.files, fields: 5 },
});

const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

/**
 * The localhost API. Built as a factory so tests can mount it on an ephemeral
 * port. No auth: it binds to 127.0.0.1 only (see index.ts), and nothing it
 * holds leaves the machine unless a cloud provider is chosen in a later slice.
 */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'narrate', version: 1 });
  });

  // POST /api/normalize
  //   multipart/form-data with one or more `files` parts, in the order the user arranged them
  //   application/json { "text": "...", "filename"?: "..." } for pasted text
  app.post(
    '/api/normalize',
    express.json({ limit: LIMITS.jsonBytes }),
    upload.array('files', LIMITS.files),
    async (req, res, next) => {
      try {
        const inputs = inputsFromRequest(req);
        if (inputs.length === 0) {
          res
            .status(400)
            .json({ error: 'No input: send files as multipart "files" parts or JSON { text }' });
          return;
        }
        const batch = await normalizeBatch(inputs);
        const body: NormalizeResponse = { ...batch, spoken: renderSpoken(batch.document) };
        res.json(body);
      } catch (err) {
        next(err);
      }
    },
  );

  // Production: the built client, if present. Dev uses Vite's server with a proxy instead.
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile('index.html', { root: webDist });
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' ? 413 : 400;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e.type === 'entity.too.large') {
      res.status(413).json({ error: 'Pasted text is too large', code: 'LIMIT_TEXT_SIZE' });
      return;
    }
    if (e.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Body is not valid JSON', code: 'BAD_JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

function inputsFromRequest(req: Request): DetectInput[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length > 0) {
    return files.map((f) => ({
      bytes: new Uint8Array(f.buffer),
      filename: safeName(f.originalname),
    }));
  }
  const body = req.body as { text?: unknown; filename?: unknown } | undefined;
  if (body && typeof body.text === 'string' && body.text.trim().length > 0) {
    const filename = typeof body.filename === 'string' ? safeName(body.filename) : undefined;
    return [{ text: body.text, ...(filename ? { filename } : {}) }];
  }
  return [];
}

/** Filenames are user-supplied display strings; keep just the basename and cap the length. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.slice(0, 200) || 'untitled';
}
