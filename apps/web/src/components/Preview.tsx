import type { SpokenSegment } from '@narrate/core';
import type { NormalizeResponse } from '../api';

const KIND_LABEL: Record<SpokenSegment['kind'], string> = {
  heading: 'heading',
  paragraph: '',
  'list-item': 'list',
  quote: 'quote',
  aside: 'aside',
  table: 'table',
  'image-alt': 'image',
  'code-omission': 'code',
  pause: 'pause',
  footnote: 'footnote',
};

/**
 * Exactly what will be spoken, in order, with what was detected and what was
 * left out. This is the review surface until audio exists, and the
 * diagnostics panel after.
 */
export function Preview({ result }: { result: NormalizeResponse }) {
  const { document, results, spoken } = result;
  const chapters = document.blocks.filter((b) => b.type === 'heading' && b.chapter).length;
  const chars = spoken.reduce((n, s) => n + s.text.length, 0);

  return (
    <section className="preview" aria-label="Speakable preview">
      <header className="preview__head">
        <h2>{document.title ?? 'Untitled'}</h2>
        <p className="muted">
          {document.blocks.length} blocks · {chapters} chapters · {chars.toLocaleString()} spoken
          characters
        </p>
      </header>

      <ul className="sources" aria-label="Sources">
        {results.map((r) => (
          <li key={r.index} className={r.ok ? 'source' : 'source source--error'}>
            <span className="source__name">{r.filename ?? 'Pasted text'}</span>
            {r.ok ? (
              <span className="source__meta">
                {r.detection.format} · {r.detection.confidence}
                {r.detection.encoding ? ` · ${r.detection.encoding}` : ''}
              </span>
            ) : (
              <span className="source__meta">{r.error}</span>
            )}
            {r.ok && r.detection.warnings.length > 0 && (
              <ul className="warnings">
                {r.detection.warnings.map((w, i) => (
                  <li key={i} className="warning">
                    {w.detail}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <ol className="spoken" aria-label="Spoken text">
        {spoken.map((s, i) =>
          s.pause ? (
            <li key={i} className="spoken__pause" aria-label="pause" />
          ) : (
            <li key={i} className={`spoken__seg spoken__seg--${s.kind}`}>
              {KIND_LABEL[s.kind] && <span className="tag">{KIND_LABEL[s.kind]}</span>}
              <span className="spoken__text">{s.text}</span>
            </li>
          ),
        )}
      </ol>

      {document.diagnostics.length > 0 && (
        <details className="diagnostics">
          <summary>
            {document.diagnostics.length} {document.diagnostics.length === 1 ? 'thing' : 'things'}{' '}
            left out or reinterpreted
          </summary>
          <ul>
            {document.diagnostics.map((d, i) => (
              <li key={i}>
                <span className="tag">{d.kind}</span> {d.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
