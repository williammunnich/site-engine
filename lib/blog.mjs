/**
 * @file blog.mjs
 * Turns an Obsidian vault into a static blog under /blog/. Only published notes are read into the output, and every link,
 * embed, backlink and tag is resolved against that published set, so a private note can't leak by being linked to.
 *
 * Published = frontmatter `publish: true`, or the note lives under `posts/`. Never published: `publish: false`,
 * `draft: true`, anything in templates/, .obsidian/, .trash/ or dot-folders.
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-13
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createMarkdown, stripComments } from './markdown.mjs';
import { escapeHtml, slugify, tagSlug, isoDate, textOf } from './util.mjs';
import { notePage, indexPage, tagPage, feedXml } from './templates.mjs';

/** Top-level vault folders that are never read (compared in lower case). */
const SKIP_DIRS = new Set(['templates', 'template', '_templates', 'node_modules']);

/**
 * Splits a note into its YAML frontmatter and its Markdown body.
 * @param {string} text - The note file's text.
 * @returns {{fm: Object, body: string}} The frontmatter (empty when missing, invalid or not a mapping) and the body.
 */
export function parseNote(text) {
  let fm = {}, body = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
  if (m) {
    try { fm = YAML.parse(m[1], { schema: 'core' }) || {}; } catch { fm = {}; }
    if (typeof fm !== 'object' || Array.isArray(fm)) fm = {};
    body = body.slice(m[0].length);
  }
  return { fm, body };
}

/**
 * Tells whether a frontmatter value means yes.
 * @param {*} v - The value.
 * @returns {boolean} True for true, "true" or "yes".
 */
const truthy = v => v === true || v === 'true' || v === 'yes';
/**
 * Tells whether a frontmatter value means no.
 * @param {*} v - The value.
 * @returns {boolean} True for false, "false" or "no".
 */
const falsy = v => v === false || v === 'false' || v === 'no';

/**
 * Decides whether a note is published: `publish: false` or `draft: true` always wins, otherwise
 * `publish: true` or living under posts/ publishes it.
 * @param {string} rel - The note's path inside the vault.
 * @param {Object} fm - The note's frontmatter.
 * @returns {boolean} True when the note may be published.
 */
export function isPublished(rel, fm) {
  if (falsy(fm.publish) || truthy(fm.draft)) return false;
  return truthy(fm.publish) || /^posts\//i.test(rel.split(path.sep).join('/'));
}

/**
 * Lists the vault's files, skipping dot-entries and the top-level template folders.
 * @param {string} dir - Folder to read.
 * @param {string} [root] - The vault root; defaults to dir on the first call.
 * @param {{notes: Object[], files: Object[]}} [out] - Collector that the recursion fills.
 * @returns {{notes: Object[], files: Object[]}} Markdown notes and other files, each as { full, rel }.
 */
function walk(dir, root = dir, out = { notes: [], files: [] }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;                         // .obsidian, .trash, .git, .github, dotfiles
    const full = path.join(dir, e.name), rel = path.relative(root, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (dir === root && SKIP_DIRS.has(e.name.toLowerCase())) continue;
      walk(full, root, out);
    } else if (e.isFile()) {
      (e.name.toLowerCase().endsWith('.md') ? out.notes : out.files).push({ full, rel });
    }
  }
  return out;
}

/**
 * Reads the frontmatter `tags` value as a list.
 * @param {string[]|string} v - A list, or text split on commas and white space.
 * @returns {string[]} Tag names without the leading #.
 */
const tagsFrom = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [])
  .map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);

/**
 * Reads the frontmatter `aliases` value as a list.
 * @param {string[]|string} v - A list, or comma-separated text.
 * @returns {string[]} The trimmed, non-empty aliases.
 */
const aliasesFrom = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(a => String(a).trim()).filter(Boolean);

/**
 * Reads the vault and returns the published notes, without rendering. Each published note gets a
 * unique slug, an id, a title, a date (frontmatter, then file name, then file time) and its tags.
 * @param {string} vault - Path of the vault folder.
 * @returns {{all: Object[], published: Object[], files: Object[]}} Every note, the published ones, and the non-note files.
 */
export function loadVault(vault) {
  const { notes, files } = walk(vault);
  const all = notes.map(({ full, rel }) => {
    const { fm, body } = parseNote(fs.readFileSync(full, 'utf8'));
    const name = path.basename(rel, path.extname(rel));
    return { full, rel, name, fm, body, published: isPublished(rel, fm) };
  });
  const published = all.filter(n => n.published);
  const used = new Set();
  for (const n of published) {
    let slug = slugify(n.fm.slug || n.name) || 'post';
    const base = slug; let i = 2;
    while (used.has(slug)) slug = `${base}-${i++}`;
    used.add(slug);
    n.slug = slug;
    n.id = n.rel;
    n.title = String(n.fm.title || n.name);
    n.date = isoDate(n.fm.date) || isoDate(n.name) || isoDate(fs.statSync(n.full).mtime);
    n.updated = isoDate(n.fm.updated) || '';
    n.tags = tagsFrom(n.fm.tags);
  }
  return { all, published, files };
}

/** Start and end comments in obsidian.css around the rules that follow the system setting and draw the header button. */
const SWITCH_MARKS = ['/* theme-switch:start */', '/* theme-switch:end */'];
/** Start and end comments in obsidian.css around the rules that hold the dark values. */
const DARK_MARKS = ['/* theme-dark:start */', '/* theme-dark:end */'];

/**
 * Removes every region between a start and an end marker comment (markers included) from CSS text.
 * @param {string} css - The stylesheet text.
 * @param {string[]} marks - [start marker, end marker].
 * @returns {string} The text without those regions.
 * @throws {Error} When a start marker has no end marker after it (a cut would silently eat the rest of the file).
 */
function cutMarked(css, [start, end]) {
  let out = css, i;
  while ((i = out.indexOf(start)) !== -1) {
    const j = out.indexOf(end, i);
    if (j === -1) throw new Error(`theme stylesheet: "${start}" has no matching "${end}"`);
    out = out.slice(0, i) + out.slice(j + end.length).replace(/^\n/, '');
  }
  return out;
}

/**
 * Reduces the built-in stylesheet to one fixed theme, for a site that does not want light/dark switching.
 * "light" drops the system-following rules and all dark values; "dark" drops the system-following rules and
 * keeps the dark values (the page then carries class "theme-dark" on <html>, see lib/templates.mjs).
 * @param {string} css - The text of blog/theme/obsidian.css.
 * @param {string} theme - "light" or "dark".
 * @returns {string} The stylesheet for that one theme, with no prefers-color-scheme rule left.
 */
export function fixedThemeCss(css, theme) {
  const out = cutMarked(css, SWITCH_MARKS);
  return theme === 'light' ? cutMarked(out, DARK_MARKS) : out;
}

/**
 * Renders the published notes into outDir (e.g. dist/blog). Returns what it wrote, for the sitemap and tests.
 * @param {Object} o - Blog options.
 * @param {string} o.vault - Path of the Obsidian vault.
 * @param {string} o.outDir - Folder the blog is written into.
 * @param {string} [o.base] - URL path the blog is served under.
 * @param {string} [o.siteUrl] - Public site address, for canonical links and the feed.
 * @param {string} [o.title] - Blog title.
 * @param {string} [o.description] - Blog description.
 * @param {string} [o.siteName] - Site name shown in the breadcrumb.
 * @param {string} [o.homeUrl] - Where the site-name breadcrumb links to.
 * @param {boolean} [o.allowHtml] - Lets raw HTML in notes through to the page.
 * @param {string} [o.themeDir] - Folder of theme files to copy; defaults to blog/theme in this project.
 * @param {string[]} [o.stylesheets] - Extra stylesheet addresses for every page.
 * @param {string} [o.indexStyle] - "default" (title, description, dates, tags, tag cloud) or "simple" (heading, bold titles, previews, dividers).
 * @param {string} [o.theme] - "auto" (follow the system, with a header button), or "light" / "dark" for one fixed theme with no button.
 * @param {string} [o.feedTitle] - Title of the Atom feed; defaults to the blog title.
 * @param {boolean} [o.feed] - False writes no feed.xml and puts no link to it in the pages. Default true.
 * @param {boolean} [o.tags] - False switches tags off for the whole blog: no chips, no tags row in Properties, no tag cloud, no tag pages, no feed categories, and #tags in the text stay plain text. Default true.
 * @returns {{posts: Object[], tags: string[], urls: string[], assets: string[]}} The posts (newest first), tag names, page addresses and copied attachment addresses.
 */
export function buildBlog({ vault, outDir, base = '/blog', siteUrl = '', title = 'Blog', description = '', siteName = '', homeUrl = '/', allowHtml = false, themeDir, stylesheets = [], indexStyle = 'default', theme = 'auto', feedTitle = '', tags = true, feed = true }) {
  const { published, files } = loadVault(vault);
  const md = createMarkdown({ allowHtml });

  // lookup tables: by name, by path without .md, and by aliases. Only published notes are in them.
  const byKey = new Map();
  /** Normalises a note name for lookup: trimmed, lower case, without ".md". */
  const key = s => String(s).trim().toLowerCase().replace(/\.md$/, '');
  for (const n of published) {
    for (const k of [n.name, n.rel, n.rel.replace(/\.md$/i, ''), ...aliasesFrom(n.fm.aliases || n.fm.alias)]) {
      if (!byKey.has(key(k))) byKey.set(key(k), n);
    }
    n.url = `${base}/${n.slug}/`;
  }
  /** Finds a published note by name, path or alias; returns { id, url, title } or null for private or missing notes. */
  const resolve = name => {
    const n = byKey.get(key(name)) || byKey.get(key(name.split('/').pop()));
    return n ? { id: n.id, url: n.url, title: n.title } : null;
  };

  // attachments: by file name and by vault path. Copied only when a published note uses them.
  const fileBy = new Map();
  for (const f of files) {
    if (!fileBy.has(f.rel.toLowerCase())) fileBy.set(f.rel.toLowerCase(), f);
    const b = path.basename(f.rel).toLowerCase();
    if (!fileBy.has(b)) fileBy.set(b, f);
  }
  const copied = new Map();
  const assetsDir = path.join(outDir, 'assets');
  /** Copies an attachment into assets/ under a content-hashed name the first time it is used; returns its URL or null when not found. */
  const attachment = name => {
    const clean = String(name).replace(/^\.?\//, '').split('#')[0];
    const f = fileBy.get(clean.toLowerCase()) || fileBy.get(path.basename(clean).toLowerCase());
    if (!f) return null;
    if (!copied.has(f.rel)) {
      const data = fs.readFileSync(f.full);
      const h = crypto.createHash('sha256').update(data).digest('hex').slice(0, 8);
      const ext = path.extname(f.rel).toLowerCase(), stem = slugify(path.basename(f.rel, path.extname(f.rel))) || 'file';
      const out = `${stem}-${h}${ext}`;
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, out), data);
      copied.set(f.rel, `${base}/assets/${out}`);
    }
    return copied.get(f.rel);
  };

  const byId = new Map(published.map(n => [n.id, n]));
  /** Renders one note's Markdown after removing %%comments%%. */
  const renderBody = (n, env) => md.render(stripComments(n.body), env);
  /** Renders a published note for embedding inside another, one level deeper and with its own link and tag sets. */
  const embedNote = (id, parentEnv) => {
    const n = byId.get(id);
    return renderBody(n, { ...parentEnv, depth: (parentEnv.depth || 0) + 1, links: new Set(), tags: new Set() });
  };

  // pass 1: render every published note, collecting outgoing links and tags
  for (const n of published) {
    const env = { resolve, attachment, embedNote, base, links: new Set(), tags: new Set(), depth: 0, showTags: tags };
    n.html = renderBody(n, env);
    n.links = env.links;
    // With tags off every note counts as untagged from here on, so the lists, the tag pages, the tag cloud and
    // the feed categories below all come out empty without each needing its own check. The vault is not changed.
    n.tags = tags ? [...new Set([...n.tags, ...env.tags])] : [];
    n.excerpt = String(n.fm.description || n.fm.summary || textOf(n.html).slice(0, 220));
  }
  // pass 2: backlinks ("Linked mentions"), only from published notes
  for (const n of published) n.backlinks = published.filter(o => o !== n && o.links.has(n.id));

  const posts = [...published].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
  const tagMap = new Map();
  for (const p of posts) for (const t of p.tags) {
    // a nested tag also lists under its parents: #a/b shows on /tags/a/ too, like Obsidian's tag pane
    const parts = t.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const tt = parts.slice(0, i).join('/');
      if (!tagMap.has(tt)) tagMap.set(tt, []);
      if (!tagMap.get(tt).includes(p)) tagMap.get(tt).push(p);
    }
  }

  const ctx = { base, title, description, siteName, homeUrl, siteUrl, stylesheets, indexStyle, theme, feedTitle, feed, showTags: tags, tags: [...tagMap.keys()].sort() };
  /** Writes one output file under outDir, creating folders as needed. */
  const write = (rel, html) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  for (const n of posts) write(`${n.slug}/index.html`, notePage(n, ctx));
  write('index.html', indexPage(posts, ctx));
  for (const [t, list] of tagMap) write(`tags/${tagSlug(t)}/index.html`, tagPage(t, list, ctx));
  if (feed) write('feed.xml', feedXml(posts.slice(0, 30), ctx));

  // theme files
  const src = themeDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'blog', 'theme');
  const fixed = theme === 'light' || theme === 'dark';
  for (const f of fs.readdirSync(src)) {
    // A fixed theme needs no switch: theme.js is left out, and the stylesheet is written without the other theme.
    if (fixed && f === 'theme.js') continue;
    if (fixed && f === 'obsidian.css') { fs.writeFileSync(path.join(outDir, f), fixedThemeCss(fs.readFileSync(path.join(src, f), 'utf8'), theme)); continue; }
    fs.copyFileSync(path.join(src, f), path.join(outDir, f));
  }

  const urls = [`${base}/`, ...posts.map(p => p.url), ...[...tagMap.keys()].map(t => `${base}/tags/${tagSlug(t)}/`)];
  return { posts, tags: [...tagMap.keys()], urls, assets: [...copied.values()] };
}

export { escapeHtml };
