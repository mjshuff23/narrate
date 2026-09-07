import type {
  Definition,
  FootnoteDefinition,
  ListItem,
  Node,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  Diagnostic,
  FootnoteBlock,
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
  numberToWords,
  speakInlineUrls,
  spokenLink,
} from '../speakable/inline.js';
import {
  flushDropDiagnostics,
  htmlFragmentInlineText,
  newHtmlContext,
  normalizeHtmlFragment,
} from './html.js';
import type { HtmlContext } from './html.js';

const parser = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdown(text: string): Root {
  return parser.parse(text);
}

export interface MarkdownContext {
  sourceId: string;
  diagnostics: Diagnostic[];
  title?: string;
}

interface State {
  ctx: MarkdownContext;
  html: HtmlContext;
  definitions: Map<string, Definition>;
  footnoteDefs: Map<string, FootnoteDefinition>;
  /** identifier → 1-based number, assigned in order of first reference. */
  footnoteOrder: Map<string, number>;
  /** Referenced footnotes whose bodies have not been emitted yet. */
  footnotePending: string[];
  footnoteEmitted: Set<string>;
}

/**
 * Markdown → blocks via a real AST (remark + GFM). Never regex-stripped.
 * Element rules follow the spec table: headings speak their text (H1–H3 are
 * chapters), code blocks are omitted but recorded, links speak anchor text or
 * "Link to host", images speak meaningful alt text only, footnote bodies move
 * to the end of the section that referenced them.
 */
export function normalizeMarkdown(text: string, ctx: MarkdownContext): SpeakBlock[] {
  const root = parseMarkdown(text);
  const state: State = {
    ctx,
    html: newHtmlContext(ctx.sourceId),
    definitions: new Map(),
    footnoteDefs: new Map(),
    footnoteOrder: new Map(),
    footnotePending: [],
    footnoteEmitted: new Set(),
  };
  collectDefinitions(root, state);
  const blocks: SpeakBlock[] = [];
  flow(root.children, 0, blocks, state);
  flushFootnotes(blocks, state);
  // Footnotes defined but never referenced still get spoken, at the very end.
  for (const id of state.footnoteDefs.keys()) {
    if (!state.footnoteEmitted.has(id)) {
      footnoteNumber(id, state);
      state.footnotePending.push(id);
    }
  }
  flushFootnotes(blocks, state);
  flushDropDiagnostics(state.html);
  ctx.diagnostics.push(...state.html.diagnostics);
  return blocks;
}

function collectDefinitions(node: Node, state: State): void {
  if (node.type === 'definition') {
    const d = node as Definition;
    state.definitions.set(d.identifier.toLowerCase(), d);
  } else if (node.type === 'footnoteDefinition') {
    const d = node as FootnoteDefinition;
    state.footnoteDefs.set(d.identifier.toLowerCase(), d);
  }
  if ('children' in node) {
    for (const c of (node as Parent).children) collectDefinitions(c, state);
  }
}

function prov(node: Node): Provenance | undefined {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  if (s === undefined || e === undefined) return undefined;
  return { start: s, end: e };
}

function withProv<T extends SpeakBlock>(block: T, node: Node): T {
  const p = prov(node);
  return p ? { ...block, provenance: p } : block;
}

function footnoteNumber(identifier: string, state: State): number {
  const id = identifier.toLowerCase();
  let n = state.footnoteOrder.get(id);
  if (n === undefined) {
    n = state.footnoteOrder.size + 1;
    state.footnoteOrder.set(id, n);
  }
  return n;
}

function flushFootnotes(out: SpeakBlock[], state: State): void {
  for (const id of state.footnotePending) {
    if (state.footnoteEmitted.has(id)) continue;
    const def = state.footnoteDefs.get(id);
    if (!def) continue;
    state.footnoteEmitted.add(id);
    const text = collapseWhitespace(
      def.children
        .map((c) => (c.type === 'paragraph' ? inlineAll(c.children, state) : ''))
        .join(' '),
    );
    if (!text) continue;
    const block: FootnoteBlock = {
      type: 'footnote',
      sourceId: state.ctx.sourceId,
      index: footnoteNumber(id, state),
      text,
    };
    out.push(withProv(block, def));
  }
  state.footnotePending = [];
}

function inlineAll(nodes: readonly PhrasingContent[], state: State): string {
  return collapseWhitespace(nodes.map((n) => inline(n, state)).join(''));
}

function inline(node: PhrasingContent, state: State): string {
  switch (node.type) {
    case 'text':
      // GFM autolinks most URLs and emails into link nodes; this catches the rest.
      return speakInlineUrls(node.value);
    case 'emphasis':
    case 'strong':
    case 'delete':
      return node.children.map((c) => inline(c, state)).join('');
    case 'inlineCode':
      return node.value;
    case 'break':
      return ' ';
    case 'html':
      return ` ${htmlFragmentInlineText(node.value, state.html)} `;
    case 'link': {
      const text = node.children.map((c) => inline(c, state)).join('');
      return isBareUrlText(text, node.url) ? ` ${spokenLink(node.url)} ` : text;
    }
    case 'linkReference': {
      const text = node.children.map((c) => inline(c, state)).join('');
      const def = state.definitions.get(node.identifier.toLowerCase());
      if (!def) return text;
      return isBareUrlText(text, def.url) ? ` ${spokenLink(def.url)} ` : text;
    }
    case 'image':
      return imageText(node.alt, state);
    case 'imageReference':
      return imageText(node.alt, state);
    case 'footnoteReference': {
      const n = footnoteNumber(node.identifier, state);
      const id = node.identifier.toLowerCase();
      if (!state.footnotePending.includes(id)) state.footnotePending.push(id);
      return ` footnote ${numberToWords(n)} `;
    }
    default:
      return 'children' in node
        ? (node as Parent).children.map((c) => inline(c as PhrasingContent, state)).join('')
        : '';
  }
}

function imageText(alt: string | null | undefined, state: State): string {
  if (isMeaningfulAlt(alt)) return ` Image: ${ensureTerminalPunctuation(collapseWhitespace(alt))} `;
  state.ctx.diagnostics.push({
    kind: 'omitted-image',
    sourceId: state.ctx.sourceId,
    detail: alt
      ? `Image with generic alt text omitted: "${alt}"`
      : 'Image without alt text omitted',
  });
  return '';
}

function flow(nodes: readonly RootContent[], depth: number, out: SpeakBlock[], state: State): void {
  const { sourceId } = state.ctx;
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        if (node.depth <= 3) flushFootnotes(out, state);
        const text = inlineAll(node.children, state);
        if (!text) break;
        if (node.depth === 1 && !state.ctx.title) state.ctx.title = text;
        out.push(
          withProv(
            { type: 'heading', sourceId, level: node.depth, text, chapter: node.depth <= 3 },
            node,
          ),
        );
        break;
      }
      case 'paragraph': {
        const nonImage = node.children.filter(
          (c) =>
            !(
              c.type === 'image' ||
              c.type === 'imageReference' ||
              (c.type === 'text' && !c.value.trim())
            ),
        );
        if (nonImage.length === 0) {
          for (const img of node.children) {
            if (img.type !== 'image' && img.type !== 'imageReference') continue;
            if (isMeaningfulAlt(img.alt)) {
              out.push(
                withProv({ type: 'image-alt', sourceId, alt: collapseWhitespace(img.alt) }, img),
              );
            } else imageText(img.alt, state);
          }
          break;
        }
        const text = inlineAll(node.children, state);
        if (text) out.push(withProv({ type: 'paragraph', sourceId, text }, node));
        break;
      }
      case 'list': {
        let index = node.start ?? 1;
        for (const item of node.children) {
          listItem(
            item,
            node.ordered === true,
            node.ordered ? index : undefined,
            depth,
            out,
            state,
          );
          index += 1;
        }
        break;
      }
      case 'blockquote': {
        const inner: SpeakBlock[] = [];
        flow(node.children, depth, inner, state);
        if (inner.length > 0) out.push(withProv({ type: 'quote', sourceId, blocks: inner }, node));
        break;
      }
      case 'code': {
        const lang = node.lang ?? undefined;
        out.push(
          withProv(
            { type: 'code-omission', sourceId, code: node.value, ...(lang ? { lang } : {}) },
            node,
          ),
        );
        state.ctx.diagnostics.push({
          kind: 'omitted-code',
          sourceId,
          detail: `Code block omitted (${node.value.split('\n').length} lines${lang ? `, ${lang}` : ''})`,
        });
        break;
      }
      case 'thematicBreak':
        out.push(withProv({ type: 'pause', sourceId }, node));
        break;
      case 'table':
        table(node, out, state);
        break;
      case 'html':
        out.push(...normalizeHtmlFragment(node.value, state.html));
        break;
      case 'definition':
      case 'footnoteDefinition':
      case 'yaml':
        break;
      default:
        break;
    }
  }
}

function listItem(
  item: ListItem,
  ordered: boolean,
  index: number | undefined,
  depth: number,
  out: SpeakBlock[],
  state: State,
): void {
  const { sourceId } = state.ctx;
  const own: string[] = [];
  const nested: RootContent[] = [];
  for (const c of item.children) {
    if (c.type === 'paragraph') own.push(inlineAll(c.children, state));
    else if (c.type === 'heading') own.push(inlineAll(c.children, state));
    else nested.push(c);
  }
  const text = collapseWhitespace(own.join(' '));
  if (text) {
    const block: ListItemBlock = {
      type: 'list-item',
      sourceId,
      text,
      ordered,
      depth,
      ...(index !== undefined ? { index } : {}),
      ...(typeof item.checked === 'boolean' ? { checked: item.checked } : {}),
    };
    out.push(withProv(block, item));
  }
  // Nested lists, code, quotes and tables inside the item follow it at depth + 1.
  flow(nested, depth + 1, out, state);
}

function table(node: Table, out: SpeakBlock[], state: State): void {
  const rows = node.children.map((row) =>
    row.children.map((cell) => inlineAll(cell.children, state)),
  );
  if (rows.length === 0) return;
  const header = rows[0]!;
  const body = rows.slice(1);
  const cols = Math.max(header.length, ...body.map((r) => r.length));
  const omitted = body.length > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS;
  const block: TableBlock = {
    type: 'table',
    sourceId: state.ctx.sourceId,
    header,
    rows: body,
    omitted,
  };
  out.push(withProv(block, node));
  if (omitted) {
    state.ctx.diagnostics.push({
      kind: 'omitted-table',
      sourceId: state.ctx.sourceId,
      detail: `Table of ${body.length} rows by ${cols} columns summarized instead of read`,
    });
  }
}
