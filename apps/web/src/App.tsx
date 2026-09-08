import { useState } from 'react';
import { ApiError, normalizeFiles, normalizeText } from './api';
import type { NormalizeResponse } from './api';
import { Preview } from './components/Preview';
import { SourcePicker } from './components/SourcePicker';

type Mode = 'files' | 'paste';
type Status = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string };

export function App() {
  const [mode, setMode] = useState<Mode>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [result, setResult] = useState<NormalizeResponse | null>(null);

  const canSubmit = mode === 'files' ? files.length > 0 : text.trim().length > 0;

  const submit = async () => {
    setStatus({ state: 'loading' });
    try {
      const res = mode === 'files' ? await normalizeFiles(files) : await normalizeText(text);
      setResult(res);
      setStatus({ state: 'idle' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not reach the Narrate server';
      setStatus({ state: 'error', message });
    }
  };

  return (
    <main className="app">
      <header className="app__head">
        <h1>Narrate</h1>
        <p className="muted">Documents in, listenable audio out. Local by default.</p>
      </header>

      <div className="modes" role="tablist" aria-label="Input mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'files'}
          onClick={() => setMode('files')}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          onClick={() => setMode('paste')}
        >
          Paste
        </button>
      </div>

      {mode === 'files' ? (
        <SourcePicker files={files} onChange={setFiles} />
      ) : (
        <textarea
          className="paste"
          aria-label="Paste text, Markdown or HTML"
          placeholder="Paste text, Markdown or HTML…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
        />
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={submit}
          disabled={!canSubmit || status.state === 'loading'}
        >
          {status.state === 'loading' ? 'Reading…' : 'Preview what will be spoken'}
        </button>
        {status.state === 'error' && (
          <p role="alert" className="error">
            {status.message}
          </p>
        )}
      </div>

      {result && <Preview result={result} />}
    </main>
  );
}
