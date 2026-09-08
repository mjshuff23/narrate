import { useId, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';

export interface SourcePickerProps {
  files: readonly File[];
  onChange: (files: File[]) => void;
}

const ACCEPT = '.txt,.text,.md,.markdown,.html,.htm,.pdf,.docx';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Drop zone plus an ordered file list. Real drag events land on the zone;
 * click or Enter/Space opens the native picker. Order is what the server
 * narrates, so the list can be rearranged before submitting.
 */
export function SourcePicker({ files, onChange }: SourcePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const listId = useId();

  const add = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return;
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (
        !next.some(
          (x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified,
        )
      )
        next.push(f);
    }
    onChange(next);
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    depth.current += 1;
    setActive(true);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setActive(false);
    add(e.dataTransfer?.files);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (i: number) => onChange(files.filter((_, k) => k !== i));

  return (
    <div className="picker">
      <div
        className={`dropzone${active ? ' dropzone--active' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Drop files here or press Enter to browse"
        aria-controls={listId}
        data-testid="dropzone"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={onKey}
      >
        <strong>Drop files here</strong>
        <span>or tap to browse · md, txt, html, pdf</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          data-testid="file-input"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <ol className="filelist" id={listId} aria-label="Files in narration order">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}`}>
              <span className="filelist__name">{f.name}</span>
              <span className="filelist__size">{formatSize(f.size)}</span>
              <span className="filelist__actions">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${f.name} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === files.length - 1}
                  aria-label={`Move ${f.name} down`}
                >
                  ↓
                </button>
                <button type="button" onClick={() => remove(i)} aria-label={`Remove ${f.name}`}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
