// An Obsidian vault -> a static blog under /blog/. Only published notes are read into the output, and every link,
// embed, backlink and tag is resolved against that published set, so a private note can't leak by being linked to.
//
// Published = frontmatter `publish: true`, or the note lives under `posts/`. Never published: `publish: false`,
// `draft: true`, anything in templates/, .obsidian/, .trash/ or dot-folders.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createMarkdown, stripComments } from './markdown.mjs';
import { escapeHtml, slugify, tagSlug, isoDate, textOf } from './util.mjs';
import { notePage, indexPage, tagPage, feedXml } from './templates.mjs';

const SKIP_DIRS = new Set(['templates', 'template', '_templates', 'node_modules']);

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

const truthy = v => v === true || v === 'true' || v === 'yes';
const falsy = v => v === false || v === 'false' || v === 'no';

export function isPublished(rel, fm) {
  if (falsy(fm.publish) || truthy(fm.draft)) return false;
  return truthy(fm.publish) || /^posts\//i.test(rel.split(path.sep).join('/'));
}

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

const tagsFrom = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [])
  .map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);

const aliasesFrom = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(a => String(a).trim()).filter(Boolean);

/** Reads the vault and returns the published notes, without rendering. */
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

/** Renders the published notes into outDir (e.g. dist/blog). Returns what it wrote, for the sitemap and tests. */
export function buildBlog({ vault, outDir, base = '/blog', siteUrl = '', title = 'Blog', description = '', siteName = '', homeUrl = '/', allowHtml = false, themeDir, stylesheets = [] }) {
  const { published, files } = loadVault(vault);
  const md = createMarkdown({ allowHtml });

  // lookup tables: by name, by path without .md, and by aliases. Only published notes are in them.
  const byKey = new Map();
  const key = s => String(s).trim().toLowerCase().replace(/\.md$/, '');
  for (const n of published) {
    for (const k of [n.name, n.rel, n.rel.replace(/\.md$/i, ''), ...aliasesFrom(n.fm.aliases || n.fm.alias)]) {
      if (!byKey.has(key(k))) byKey.set(key(k), n);
    }
    n.url = `${base}/${n.slug}/`;
  }
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
  const renderBody = (n, env) => md.render(stripComments(n.body), env);
  const embedNote = (id, parentEnv) => {
    const n = byId.get(id);
    return renderBody(n, { ...parentEnv, depth: (parentEnv.depth || 0) + 1, links: new Set(), tags: new Set() });
  };

  // pass 1: render every published note, collecting outgoing links and tags
  for (const n of published) {
    const env = { resolve, attachment, embedNote, base, links: new Set(), tags: new Set(), depth: 0 };
    n.html = renderBody(n, env);
    n.links = env.links;
    n.tags = [...new Set([...n.tags, ...env.tags])];
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

  const ctx = { base, title, description, siteName, homeUrl, siteUrl, stylesheets, tags: [...tagMap.keys()].sort() };
  const write = (rel, html) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  for (const n of posts) write(`${n.slug}/index.html`, notePage(n, ctx));
  write('index.html', indexPage(posts, ctx));
  for (const [t, list] of tagMap) write(`tags/${tagSlug(t)}/index.html`, tagPage(t, list, ctx));
  write('feed.xml', feedXml(posts.slice(0, 30), ctx));

  // theme files
  const src = themeDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'blog', 'theme');
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(outDir, f));

  const urls = [`${base}/`, ...posts.map(p => p.url), ...[...tagMap.keys()].map(t => `${base}/tags/${tagSlug(t)}/`)];
  return { posts, tags: [...tagMap.keys()], urls, assets: [...copied.values()] };
}

export { escapeHtml };
