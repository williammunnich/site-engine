/**
 * @file util.mjs
 * Small text helpers shared by the builder: HTML escaping, slugs, dates and plain-text extraction.
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-13
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

/** The file-name date orders the builder understands; the first is the default (see `dateFormat` in the README). */
export const DATE_FORMATS = ['MM-DD-YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD'];

/**
 * YYYY-MM-DD from a Date, a date string, or a daily-note file name. A year-first date (2026-11-13) is always
 * understood. A date written with the year last (11-13-2026) is ambiguous, so `format` says how to read it:
 * "MM-DD-YYYY" (the default) is month first, "DD-MM-YYYY" is day first, and "YYYY-MM-DD" means year-last
 * dates are not read at all. The result is not checked against the calendar: use isRealDate for that.
 * @param {Date|string} v - The value to read a date from.
 * @param {string} [format] - One of DATE_FORMATS; anything else counts as "MM-DD-YYYY".
 * @returns {string} The date as YYYY-MM-DD, or an empty string when none is found.
 */
export function isoDate(v, format = 'MM-DD-YYYY') {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v);
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (format === 'YYYY-MM-DD') return '';
  m = /(\d{2})-(\d{2})-(\d{4})/.exec(s);
  if (!m) return '';
  return format === 'DD-MM-YYYY' ? `${m[3]}-${m[2]}-${m[1]}` : `${m[3]}-${m[1]}-${m[2]}`;
}

/**
 * Tells whether a YYYY-MM-DD text is a day that exists (month 1-12, and a day that month has in that year).
 * @param {string} iso - Date as YYYY-MM-DD.
 * @returns {boolean} True for a real calendar day; false for things like 2026-13-11 or 2026-02-30.
 */
export function isRealDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Date.UTC rolls an impossible day over into the next month, so the parts only match for a real day
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Tells whether a file name is nothing but a date (a daily note), in one of the orders isoDate reads.
 * @param {string} name - File name without the extension.
 * @returns {boolean} True for names like "11-13-2026" or "2026-11-13".
 */
export function isDateName(name) {
  return /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/.test(String(name).trim());
}

/**
 * Decodes the %XX escapes of a link target ("Pasted%20image.png" -> "Pasted image.png").
 * @param {string} s - The link target as written in the note.
 * @returns {string} The decoded text, or the text unchanged when its escapes are malformed.
 */
export function decodePath(s) {
  try { return decodeURIComponent(s); } catch { return String(s); }
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
