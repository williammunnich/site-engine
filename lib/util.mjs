/**
 * @file util.mjs
 * Small text helpers shared by the builder: HTML escaping, slugs, dates and plain-text extraction.
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-12
 */

/**
 * Escapes the five HTML special characters so text is safe inside markup and attributes.
 * @param {*} s - Value to escape; null and undefined become an empty string.
 * @returns {string} The escaped text.
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Makes a URL slug: "My Note: Part 2" -> "my-note-part-2". Keeps letters from any language.
 * @param {*} s - Text to turn into a slug.
 * @returns {string} Lower-case words joined by dashes; may be empty.
 */
export function slugify(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/**
 * Slug for a tag. Nested tags keep their slashes as folders: #project/cloudcut -> tags/project/cloudcut/
 * @param {string} tag - Tag name without the leading #.
 * @returns {string} The slugged parts joined by "/".
 */
export function tagSlug(tag) {
  return String(tag).split('/').map(slugify).filter(Boolean).join('/');
}

/**
 * YYYY-MM-DD from a Date, a date string, or a daily-note file name (YYYY-MM-DD or MM-DD-YYYY).
 * @param {Date|string} v - The value to read a date from.
 * @returns {string} The date as YYYY-MM-DD, or an empty string when none is found.
 */
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

/**
 * Formats a YYYY-MM-DD date for readers, e.g. "November 12, 2026".
 * @param {string} iso - Date as YYYY-MM-DD.
 * @returns {string} The long US-English date, or an empty string for an empty input.
 */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Plain text from rendered HTML, for excerpts and the feed summary.
 * @param {string} html - Rendered HTML.
 * @returns {string} The text with tags removed, entities decoded and white space collapsed.
 */
export function textOf(html) {
  return String(html).replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<\/(p|div|li|h\d|tr|td|th|summary|blockquote|pre)>|<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
