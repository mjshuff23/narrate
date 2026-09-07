/**
 * Inline speakable-text rules shared by every normalizer: URLs, emails,
 * alt-text quality, ordinals, whitespace. Block-level framing ("Quote.",
 * "Table.", "Image:") lives in render.ts; these helpers produce the text
 * that goes *inside* a block.
 */

export const TABLE_MAX_ROWS = 20;
export const TABLE_MAX_COLS = 6;

/**
 * Collapse runs of whitespace and remove the space that inline substitutions
 * (" Link to host ") leave before closing punctuation.
 */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim();
}

/** "https://www.example.com/a/b?x=1" → "example dot com". Falls back to the raw string if unparseable. */
export function spokenHostname(url: string): string {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  let host: string;
  try {
    host = new URL(candidate).hostname;
  } catch {
    host = url;
  }
  host = host.replace(/^www\./i, '');
  return host.split('.').filter(Boolean).join(' dot ');
}

/** The spoken form of a bare URL. Path, query and hash are deliberately dropped. */
export function spokenLink(url: string): string {
  if (/^mailto:/i.test(url)) return spokenEmail(url.replace(/^mailto:/i, '').split('?')[0] ?? '');
  return `Link to ${spokenHostname(url)}`;
}

/** "jane.doe@example.com" → "jane dot doe at example dot com". */
export function spokenEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return address;
  const local = address.slice(0, at).split('.').filter(Boolean).join(' dot ');
  const domain = address
    .slice(at + 1)
    .split('.')
    .filter(Boolean)
    .join(' dot ');
  return `${local} at ${domain}`;
}

/** True when link text is just the URL again (an autolink), so anchor text would be noise. */
export function isBareUrlText(text: string, url: string): boolean {
  const strip = (s: string) =>
    s
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^mailto:/i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  const t = strip(text);
  return t.length === 0 || t === strip(url);
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

/**
 * Replace bare URLs and email addresses in plain prose with their spoken forms.
 * URLs go first: an address inside a URL's query (`?to=a@b.com`) belongs to the
 * URL, and the spoken URL contains no `@`, so the email pass cannot re-match it.
 */
export function speakInlineUrls(text: string): string {
  const withUrls = text.replace(URL_RE, (m) => {
    const trailing = TRAILING_PUNCT_RE.exec(m)?.[0] ?? '';
    const url = trailing ? m.slice(0, -trailing.length) : m;
    return spokenLink(url) + trailing;
  });
  return withUrls.replace(EMAIL_RE, (m) => spokenEmail(m));
}

const GENERIC_ALT = new Set([
  'image',
  'img',
  'photo',
  'picture',
  'pic',
  'screenshot',
  'logo',
  'icon',
  'graphic',
  'figure',
  'banner',
  'thumbnail',
  'placeholder',
  'untitled',
]);
const FILENAME_ALT_RE = /^[\w\s\-./\\()]+\.(png|jpe?g|gif|svg|webp|bmp|tiff?|avif)$/i;

/** Alt text worth speaking: not empty, not a filename, not a one-word generic label. */
export function isMeaningfulAlt(alt: string | undefined | null): alt is string {
  if (!alt) return false;
  const t = collapseWhitespace(alt);
  if (t.length < 3) return false;
  if (FILENAME_ALT_RE.test(t)) return false;
  if (GENERIC_ALT.has(t.toLowerCase().replace(/[.!]$/, ''))) return false;
  return true;
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 1 → "one", 42 → "forty-two", 1000+ → digits. Used for list ordinals and footnote numbers. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1000) return String(n);
  if (n < 20) return ONES[n] as string;
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)] as string;
    return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
  }
  const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
  return n % 100 === 0 ? hundreds : `${hundreds} ${numberToWords(n % 100)}`;
}

/** Give headings and labels a sentence-final stop so the voice pauses instead of running on. */
export function ensureTerminalPunctuation(text: string): string {
  const t = text.trim();
  if (t.length === 0) return t;
  return /[.!?:;…]$/.test(t) ? t : `${t}.`;
}
