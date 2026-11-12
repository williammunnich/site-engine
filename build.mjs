#!/usr/bin/env node
// site-engine: builds the static site.
//   node build.mjs --content <dir> [--vault <dir>] --out <dir> [--site-url https://example.com]
// 1. <content>/site/** is copied to <out> as is.
// 2. With --vault, the vault's published notes become a blog under <out>/blog/ (lib/blog.mjs).
// Blog settings come from <content>/blog.config.json ({ "title", "description", "siteName", "base", "allowHtml" })
// and can be overridden with --blog-title / --blog-description.
import fs from 'node:fs';
import path from 'node:path';
import { buildBlog } from './lib/blog.mjs';

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    o[k] = v;
  }
  return o;
}

export function addToSitemap(file, siteUrl, urls) {
  if (!fs.existsSync(file) || !siteUrl) return false;
  let xml = fs.readFileSync(file, 'utf8');
  const add = urls.map(u => siteUrl + u).filter(u => !xml.includes(`<loc>${u}</loc>`))
    .map(u => `  <url><loc>${u}</loc></url>`).join('\n');
  if (!add) return true;
  xml = xml.replace(/<\/urlset>\s*$/, add + '\n</urlset>\n');
  fs.writeFileSync(file, xml);
  return true;
}

export function build({ content, vault, out, siteUrl = '', blogTitle, blogDescription }) {
  if (!content || !out) throw new Error('usage: node build.mjs --content <dir> [--vault <dir>] --out <dir> [--site-url https://…]');
  const site = path.join(content, 'site');
  if (!fs.existsSync(site)) throw new Error(`no site/ folder in ${content}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(site, out, { recursive: true, filter: src => path.basename(src) !== '.DS_Store' });
  const cfgFile = path.join(content, 'blog.config.json');
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
  siteUrl = String(siteUrl || cfg.siteUrl || '').replace(/\/$/, '');
  let blog = null;
  if (vault) {
    const base = cfg.base || '/blog';
    blog = buildBlog({
      vault, outDir: path.join(out, base.replace(/^\//, '')), base, siteUrl,
      title: blogTitle || cfg.title || 'Blog', description: blogDescription || cfg.description || '',
      siteName: cfg.siteName || '', homeUrl: cfg.homeUrl || '/', allowHtml: !!cfg.allowHtml,
    });
    addToSitemap(path.join(out, 'sitemap.xml'), siteUrl, blog.urls);
  }
  return { out, blog };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build.mjs')) {
  const a = args(process.argv.slice(2));
  try {
    const r = build({ content: a.content, vault: a.vault, out: a.out, siteUrl: a['site-url'], blogTitle: a['blog-title'], blogDescription: a['blog-description'] });
    console.log(`built ${r.out}` + (r.blog ? `: ${r.blog.posts.length} posts, ${r.blog.tags.length} tags, ${r.blog.assets.length} attachments` : ''));
  } catch (err) { console.error(err.message); process.exit(1); }
}
