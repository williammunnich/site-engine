// Small helpers shared by the builder.
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// "My Note: Part 2" -> "my-note-part-2". Keeps letters from any language.
export function slugify(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

// Nested tags keep their slashes as folders: #project/cloudcut -> tags/project/cloudcut/
export function tagSlug(tag) {
  return String(tag).split('/').map(slugify).filter(Boolean).join('/');
}

// YYYY-MM-DD from a Date, a date string, or a daily-note file name (YYYY-MM-DD or MM-DD-YYYY).
export function isoDate(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return '';
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// Plain text from rendered HTML, for excerpts and the feed summary.
export function textOf(html) {
  return String(html).replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<\/(p|div|li|h\d|tr|td|th|summary|blockquote|pre)>|<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
