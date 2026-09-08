import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Position } from 'unist';
import rehypeParse from 'rehype-parse';
import { unified } from 'unified';
import type {
  Diagnostic,
  ImageAltBlock,
  ListItemBlock,
  Provenance,
  SpeakBlock,
  TableBlock,
} from '../types.js';
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  collapseWhitespace,
  ensureTerminalPunctuation,
  isBareUrlText,
  isMeaningfulAlt,
  spokenLink,
} from '../speakable/inline.js';

/** Elements whose content is never spoken. Removed structurally, not regex-stripped. */
const DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'form',
  'nav',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'map',
  'area',
  'dialog',
]);
/** Drops worth telling the user about (the rest are invisible plumbing). */
const DROP_REPORTED = new Set(['script', 'style', 'noscript', 'template', 'form', 'nav', 'iframe']);

/** Containers with no speech semantics of their own: recurse into their children. */
const TRANSPARENT = new Set([
  'html',
  'body',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'figure',
  'details',
  'summary',
  'dl',
  'address',
  'fieldset',
  'center',
  'hgroup',
  'picture',
  'span',
  'font',
]);

const HEADING_RE = /^h([1-6])$/;

export interface HtmlContext {
  sourceId: string;
  diagnostics: Diagnostic[];
  title?: string;
  dropped: Map<string, number>;
  /** True once a whole-document drop census has run, so per-node counting is skipped. */
  censusDone: boolean;
}

export function newHtmlContext(sourceId: string): HtmlContext {
  return { sourceId, diagnostics: [], dropped: new Map(), censusDone: false };
}

const documentParser = unified().use(rehypeParse, { fragment: false });
const fragmentParser = unified().use(rehypeParse, { fragment: true });

export function looksLikeHtmlDocument(text: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(text);
}

export function parseHtml(text: string): Root {
  return (looksLikeHtmlDocument(text) ? documentParser : fragmentParser).parse(text);
}

/**
 * HTML → blocks. Content root is <main> when present, else a single dominant
 * <article> (≥70% of body text), else <body>. Everything in DROP vanishes,
 * hidden content vanishes, block elements map to blocks, and loose inline
 * content between blocks is gathered into implicit paragraphs.
 */
export function normalizeHtml(text: string, ctx: HtmlContext): SpeakBlock[] {
  const root = parseHtml(text);
  // Census the whole document, not just the content root, so the user learns
  // what was left out even when it lived in <head> or outside <main>.
  walk(root, (el) => {
    if (DROP_REPORTED.has(el.tagName))
      ctx.dropped.set(el.tagName, (ctx.dropped.get(el.tagName) ?? 0) + 1);
  });
  ctx.censusDone = true;
  const body = findFirst(root, (el) => el.tagName === 'body') ?? root;
  const contentRoot = selectContentRoot(body);
  const blocks: SpeakBlock[] = [];
  flow(contentRoot.children as RootContent[], 0, blocks, ctx);
  if (!ctx.title) {
    const titleEl = findFirst(root, (el) => el.tagName === 'title');
    const t = titleEl ? collapseWhitespace(textContent(titleEl)) : '';
    if (t) ctx.title = t;
  }
  flushDropDiagnostics(ctx);
  return blocks;
}

/**
 * Turn the drop census into diagnostics and reset it. Called once per source by
 * whichever normalizer owns the context: normalizeHtml for HTML documents, the
 * Markdown normalizer for HTML fragments embedded in Markdown.
 */
export function flushDropDiagnostics(ctx: HtmlContext): void {
  for (const [tag, count] of ctx.dropped) {
    ctx.diagnostics.push({
      kind: 'dropped-element',
      sourceId: ctx.sourceId,
      detail: `Dropped ${count} <${tag}> element${count === 1 ? '' : 's'}`,
    });
  }
  ctx.dropped.clear();
}

/** Blocks from an HTML fragment embedded in another format (Markdown's `html` nodes). */
export function normalizeHtmlFragment(text: string, ctx: HtmlContext): SpeakBlock[] {
  const root = fragmentParser.parse(text);
  const blocks: SpeakBlock[] = [];
  flow(root.children, 0, blocks, ctx);
  return blocks;
}

/** Spoken inline text of an HTML fragment (for inline HTML inside Markdown paragraphs). */
export function htmlFragmentInlineText(text: string, ctx: HtmlContext): string {
  const root = fragmentParser.parse(text);
  return collapseWhitespace(root.children.map((n) => inline(n, ctx)).join(''));
}

function selectContentRoot(body: Root | Element): Root | Element {
  const main = findFirst(body, (el) => el.tagName === 'main');
  if (main) return main;
  const articles: Element[] = [];
  walk(body, (el) => {
    if (el.tagName === 'article') articles.push(el);
  });
  if (articles.length === 0) return body;
  const bodyLen = speakableLength(body);
  if (bodyLen === 0) return body;
  const best = articles
    .map((a) => ({ a, len: speakableLength(a) }))
    .sort((x, y) => y.len - x.len)[0]!;
  return best.len / bodyLen >= 0.7 ? best.a : body;
}

function speakableLength(node: Root | Element): number {
  let n = 0;
  const visit = (c: RootContent | ElementContent) => {
    if (c.type === 'text') n += collapseWhitespace(c.value).length;
    else if (c.type === 'element' && !DROP.has(c.tagName) && !isHidden(c))
      c.children.forEach(visit);
  };
  node.children.forEach(visit);
  return n;
}

function isHidden(el: Element): boolean {
  const p = el.properties ?? {};
  if (p['hidden'] !== undefined && p['hidden'] !== false) return true;
  if (String(p['ariaHidden'] ?? '').toLowerCase() === 'true') return true;
  const style = String(p['style'] ?? '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return style.includes('display:none') || style.includes('visibility:hidden');
}

function findFirst(node: Root | Element, pred: (el: Element) => boolean): Element | undefined {
  let found: Element | undefined;
  walk(node, (el) => {
    if (!found && pred(el)) found = el;
  });
  return found;
}

function walk(node: Root | Element, fn: (el: Element) => void): void {
  for (const c of node.children) {
    if (c.type === 'element') {
      fn(c);
      walk(c, fn);
    }
  }
}

export function textContent(node: Root | Element): string {
  let out = '';
  const visit = (c: RootContent | ElementContent) => {
    if (c.type === 'text') out += c.value;
    else if (c.type === 'element') c.children.forEach(visit);
  };
  node.children.forEach(visit);
  return out;
}

type Positioned = { position?: Position | undefined };

function prov(node: Positioned): Provenance | undefined {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  if (s === undefined || e === undefined) return undefined;
  return { start: s, end: e };
}

function withProv<T extends SpeakBlock>(block: T, node: Positioned): T {
  const p = prov(node);
  return p ? { ...block, provenance: p } : block;
}

function noteDrop(el: Element, ctx: HtmlContext): void {
  if (ctx.censusDone || !DROP_REPORTED.has(el.tagName)) return;
  ctx.dropped.set(el.tagName, (ctx.dropped.get(el.tagName) ?? 0) + 1);
}

/** Inline (phrasing) content → speakable text. Block elements encountered here are flattened. */
function inline(node: RootContent | ElementContent, ctx: HtmlContext): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  const el = node;
  if (DROP.has(el.tagName)) {
    noteDrop(el, ctx);
    return '';
  }
  if (isHidden(el)) return '';
  switch (el.tagName) {
    case 'br':
      return ' ';
    case 'img': {
      const alt = String(el.properties?.['alt'] ?? '');
      if (isMeaningfulAlt(alt))
        return ` Image: ${ensureTerminalPunctuation(collapseWhitespace(alt))} `;
      ctx.diagnostics.push({
        kind: 'omitted-image',
        sourceId: ctx.sourceId,
        detail: alt
          ? `Image with generic alt text omitted: "${alt}"`
          : 'Image without alt text omitted',
      });
      return '';
    }
    case 'a': {
      const href = String(el.properties?.['href'] ?? '');
      const text = collapseWhitespace(el.children.map((c) => inline(c, ctx)).join(''));
      if (href && isBareUrlText(text, href)) return ` ${spokenLink(href)} `;
      return text;
    }
    default:
      return el.children.map((c) => inline(c, ctx)).join('');
  }
}

/**
 * Flow content → blocks. `pending` accumulates loose inline content until a
 * block element forces a paragraph boundary.
 */
function flow(
  nodes: readonly RootContent[],
  depth: number,
  out: SpeakBlock[],
  ctx: HtmlContext,
): void {
  let pending: string[] = [];
  let pendingStart: number | undefined;
  const flush = () => {
    const text = collapseWhitespace(pending.join(''));
    if (text) {
      const block: SpeakBlock = { type: 'paragraph', sourceId: ctx.sourceId, text };
      out.push(
        pendingStart !== undefined ? { ...block, provenance: { start: pendingStart } } : block,
      );
    }
    pending = [];
    pendingStart = undefined;
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      if (pending.length === 0) pendingStart = node.position?.start.offset;
      pending.push(node.value);
      continue;
    }
    if (node.type !== 'element') continue;
    const el = node;
    if (DROP.has(el.tagName)) {
      noteDrop(el, ctx);
      continue;
    }
    if (isHidden(el)) continue;

    const heading = HEADING_RE.exec(el.tagName);
    if (heading) {
      flush();
      const level = Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6;
      const text = collapseWhitespace(el.children.map((c) => inline(c, ctx)).join(''));
      if (!text) continue;
      if (level === 1 && !ctx.title) ctx.title = text;
      out.push(
        withProv({ type: 'heading', sourceId: ctx.sourceId, level, text, chapter: level <= 3 }, el),
      );
      continue;
    }

    switch (el.tagName) {
      case 'p':
      case 'dt':
      case 'dd':
      case 'figcaption':
      case 'caption':
      case 'legend': {
        flush();
        const imgs = onlyImages(el);
        if (imgs) {
          for (const img of imgs) pushImage(img, out, ctx);
          break;
        }
        const text = collapseWhitespace(el.children.map((c) => inline(c, ctx)).join(''));
        if (text) out.push(withProv({ type: 'paragraph', sourceId: ctx.sourceId, text }, el));
        break;
      }
      case 'img':
        flush();
        pushImage(el, out, ctx);
        break;
      case 'ul':
      case 'ol':
        flush();
        list(el, depth, out, ctx);
        break;
      case 'li':
        // A stray <li> outside a list: treat as an unordered item.
        flush();
        listItem(el, false, undefined, depth, out, ctx);
        break;
      case 'blockquote':
      case 'aside': {
        flush();
        const inner: SpeakBlock[] = [];
        flow(el.children as RootContent[], depth, inner, ctx);
        if (inner.length > 0) {
          out.push(
            withProv(
              {
                type: el.tagName === 'aside' ? 'aside' : 'quote',
                sourceId: ctx.sourceId,
                blocks: inner,
              },
              el,
            ),
          );
        }
        break;
      }
      case 'pre': {
        flush();
        const code = textContent(el);
        const codeEl = el.children.find(
          (c): c is Element => c.type === 'element' && c.tagName === 'code',
        );
        const lang = codeEl ? langFromClass(codeEl) : undefined;
        out.push(
          withProv(
            { type: 'code-omission', sourceId: ctx.sourceId, code, ...(lang ? { lang } : {}) },
            el,
          ),
        );
        ctx.diagnostics.push({
          kind: 'omitted-code',
          sourceId: ctx.sourceId,
          detail: `Code block omitted (${code.split('\n').length} lines${lang ? `, ${lang}` : ''})`,
        });
        break;
      }
      case 'table':
        flush();
        table(el, out, ctx);
        break;
      case 'hr':
        flush();
        out.push(withProv({ type: 'pause', sourceId: ctx.sourceId }, el));
        break;
      default:
        if (TRANSPARENT.has(el.tagName)) {
          // Inline-ish transparents (span, font) stay in the pending run; block transparents break it.
          if (el.tagName === 'span' || el.tagName === 'font') {
            if (pending.length === 0) pendingStart = el.position?.start.offset;
            pending.push(inline(el, ctx));
          } else {
            flush();
            flow(el.children as RootContent[], depth, out, ctx);
          }
        } else {
          // Unknown or inline element: part of the current paragraph run.
          if (pending.length === 0) pendingStart = el.position?.start.offset;
          pending.push(inline(el, ctx));
        }
    }
  }
  flush();
}

function onlyImages(el: Element): Element[] | undefined {
  const imgs: Element[] = [];
  for (const c of el.children) {
    if (c.type === 'text') {
      if (c.value.trim()) return undefined;
    } else if (c.type === 'element') {
      if (c.tagName === 'img') imgs.push(c);
      else if (c.tagName === 'picture' || c.tagName === 'a') {
        const nested = onlyImages(c);
        if (!nested) return undefined;
        imgs.push(...nested);
      } else if (c.tagName !== 'br') return undefined;
    }
  }
  return imgs.length > 0 ? imgs : undefined;
}

function pushImage(img: Element, out: SpeakBlock[], ctx: HtmlContext): void {
  const alt = String(img.properties?.['alt'] ?? '');
  if (isMeaningfulAlt(alt)) {
    const block: ImageAltBlock = {
      type: 'image-alt',
      sourceId: ctx.sourceId,
      alt: collapseWhitespace(alt),
    };
    out.push(withProv(block, img));
    return;
  }
  ctx.diagnostics.push({
    kind: 'omitted-image',
    sourceId: ctx.sourceId,
    detail: alt
      ? `Image with generic alt text omitted: "${alt}"`
      : 'Image without alt text omitted',
  });
}

function langFromClass(codeEl: Element): string | undefined {
  const cls = codeEl.properties?.['className'];
  const list = Array.isArray(cls) ? cls.map(String) : typeof cls === 'string' ? [cls] : [];
  for (const c of list) {
    const m = /^(?:language|lang)-(.+)$/.exec(c);
    if (m) return m[1];
  }
  return undefined;
}

function list(el: Element, depth: number, out: SpeakBlock[], ctx: HtmlContext): void {
  const ordered = el.tagName === 'ol';
  const startAttr = Number(el.properties?.['start']);
  let index = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;
  for (const c of el.children) {
    if (c.type !== 'element') continue;
    if (c.tagName === 'li') {
      listItem(c, ordered, ordered ? index : undefined, depth, out, ctx);
      index += 1;
    } else if (c.tagName === 'ul' || c.tagName === 'ol') {
      list(c, depth + 1, out, ctx);
    }
  }
}

function listItem(
  li: Element,
  ordered: boolean,
  index: number | undefined,
  depth: number,
  out: SpeakBlock[],
  ctx: HtmlContext,
): void {
  const own: string[] = [];
  const nested: Element[] = [];
  const trailing: SpeakBlock[] = [];
  for (const c of li.children) {
    if (c.type === 'element' && (c.tagName === 'ul' || c.tagName === 'ol')) nested.push(c);
    else if (
      c.type === 'element' &&
      (c.tagName === 'pre' || c.tagName === 'table' || c.tagName === 'blockquote')
    ) {
      flow([c], depth, trailing, ctx);
    } else if (c.type === 'element' && (c.tagName === 'p' || c.tagName === 'div')) {
      own.push(' ', inline(c, ctx), ' ');
    } else own.push(inline(c, ctx));
  }
  const text = collapseWhitespace(own.join(''));
  if (text) {
    const block: ListItemBlock = {
      type: 'list-item',
      sourceId: ctx.sourceId,
      text,
      ordered,
      depth,
      ...(index !== undefined ? { index } : {}),
    };
    out.push(withProv(block, li));
  }
  out.push(...trailing);
  for (const n of nested) list(n, depth + 1, out, ctx);
}

function table(el: Element, out: SpeakBlock[], ctx: HtmlContext): void {
  const rows: { cells: string[]; header: boolean }[] = [];
  const collectRows = (parent: Element, inHead: boolean) => {
    for (const c of parent.children) {
      if (c.type !== 'element') continue;
      if (c.tagName === 'tr') {
        const cells: string[] = [];
        let allTh = true;
        for (const cell of c.children) {
          if (cell.type !== 'element' || (cell.tagName !== 'td' && cell.tagName !== 'th')) continue;
          if (cell.tagName !== 'th') allTh = false;
          cells.push(collapseWhitespace(cell.children.map((x) => inline(x, ctx)).join('')));
          // A spanned cell occupies extra columns; pad so header/value indexes stay aligned.
          const rawSpan = Number(cell.properties?.['colSpan']);
          const span = Number.isInteger(rawSpan) && rawSpan > 0 ? rawSpan : 1;
          for (let i = 1; i < Math.min(span, 64); i += 1) cells.push('');
        }
        if (cells.length > 0) rows.push({ cells, header: inHead || allTh });
      } else if (c.tagName === 'thead' || c.tagName === 'tbody' || c.tagName === 'tfoot') {
        collectRows(c, c.tagName === 'thead');
      }
    }
  };
  collectRows(el, false);
  if (rows.length === 0) return;
  let header: string[] = [];
  let body = rows;
  if (rows[0]!.header) {
    header = rows[0]!.cells;
    body = rows.slice(1);
  }
  const cols = Math.max(header.length, ...body.map((r) => r.cells.length));
  const omitted = body.length > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS;
  const block: TableBlock = {
    type: 'table',
    sourceId: ctx.sourceId,
    header,
    rows: body.map((r) => r.cells),
    omitted,
  };
  out.push(withProv(block, el));
  if (omitted) {
    ctx.diagnostics.push({
      kind: 'omitted-table',
      sourceId: ctx.sourceId,
      detail: `Table of ${body.length} rows by ${cols} columns summarized instead of read`,
    });
  }
}
