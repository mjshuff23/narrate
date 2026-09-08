/**
 * Manual review tool: run a file (or stdin) through detection and
 * normalization and print exactly what a voice would read.
 *
 *   pnpm speak path/to/doc.md
 *   cat notes.txt | pnpm speak            # pasted-text mode, no filename
 *   pnpm speak doc.html --json            # full SpeakDocument instead
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { normalizeSource, renderSpoken } from '../src/index.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));

if (!file && process.stdin.isTTY) {
  console.error('usage: pnpm speak <file> [--json]   or   cat file | pnpm speak [--json]');
  process.exit(2);
}

let bytes: Uint8Array;
try {
  bytes = new Uint8Array(file ? readFileSync(file) : readFileSync(0));
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === 'ENOENT'
      ? `speak: no such file: ${file}`
      : `speak: cannot read ${file ?? 'stdin'}: ${String(err)}`,
  );
  process.exit(1);
}
const input = file ? { bytes, filename: basename(file) } : { bytes };

const { document, detection } = await normalizeSource(input);
if (json) {
  console.log(JSON.stringify({ detection, document }, null, 2));
} else {
  const src = document.sources[0]!;
  console.error(
    `# ${src.filename ?? 'pasted text'} → ${detection.format} (${detection.confidence})` +
      `${src.encoding ? `, ${src.encoding}` : ''}; ${document.blocks.length} blocks` +
      `${document.title ? `; title: ${document.title}` : ''}`,
  );
  for (const e of detection.evidence) console.error(`#   evidence: ${e}`);
  for (const w of detection.warnings) console.error(`#   warning [${w.kind}]: ${w.detail}`);
  for (const d of document.diagnostics) console.error(`#   diagnostic [${d.kind}]: ${d.detail}`);
  console.error('');
  for (const seg of renderSpoken(document)) {
    if (seg.pause) console.log('[pause]\n');
    else if (seg.text) console.log(`${seg.text}\n`);
  }
}
