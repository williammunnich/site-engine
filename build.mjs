#!/usr/bin/env node
/**
 * @file build.mjs
 * Command-line entry point of site-engine: builds the static site.
 *
 *   node build.mjs --content <dir> [--vault <dir>] --out <dir> [--site-url https://example.com]
 *
 * 1. <content>/site/** is copied to <out> as is.
 * 2. With --vault, the vault's published notes become a blog under <out>/blog/ (lib/blog.mjs).
 * Blog settings come from <content>/blog.config.json ({ "title", "description", "siteName", "base", "allowHtml", "stylesheets",
 * "indexStyle", "theme", "feedTitle", "tags", "feed" }) and can be overridden with --blog-title / --blog-description.
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-13
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildBlog } from './lib/blog.mjs';

/**
 * Turns "--key value" command-line words into an object; a flag with no value becomes true.
 * @param {string[]} argv - The words after the script name.
 * @returns {Object<string, string|boolean>} Option names (without the dashes) and their values.
 */
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

/**
 * Adds the blog's pages to an existing sitemap.xml, skipping addresses that are already listed.
 * @param {string} file - Path of the sitemap.xml to update.
 * @param {string} siteUrl - Site address without a trailing slash, e.g. https://example.com.
 * @param {string[]} urls - Site-relative addresses to add, e.g. "/blog/hello/".
 * @returns {boolean} False when there is no sitemap file or no site address, otherwise true.
 */
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

/**
 * Builds the site: empties the output folder, copies <content>/site into it and, when a vault is
 * given, renders the blog and adds its pages to the sitemap.
 * @param {Object} o - Build options.
 * @param {string} o.content - Content folder; must hold a site/ folder and may hold blog.config.json.
 * @param {string} [o.vault] - Obsidian vault to publish as the blog.
 * @param {string} o.out - Output folder; it is deleted and rewritten.
 * @param {string} [o.siteUrl] - Public site address; falls back to siteUrl in blog.config.json.
 * @param {string} [o.blogTitle] - Overrides the blog title from the config.
 * @param {string} [o.blogDescription] - Overrides the blog description from the config.
 * @param {Object} [o.config] - Settings that override blog.config.json key by key (used by the tests to try an option).
 * @returns {{out: string, blog: Object|null}} The output folder and what buildBlog wrote (null without a vault).
 * @throws {Error} When content or out is missing, or the content folder has no site/ folder.
 */
export function build({ content, vault, out, siteUrl = '', blogTitle, blogDescription, config = {} }) {
  if (!content || !out) throw new Error('usage: node build.mjs --content <dir> [--vault <dir>] --out <dir> [--site-url https://…]');
  const site = path.join(content, 'site');
  if (!fs.existsSync(site)) throw new Error(`no site/ folder in ${content}`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(site, out, { recursive: true, filter: src => path.basename(src) !== '.DS_Store' });
  const cfgFile = path.join(content, 'blog.config.json');
  const cfg = { ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}), ...config };
  siteUrl = String(siteUrl || cfg.siteUrl || '').replace(/\/$/, '');
  let blog = null;
  if (vault) {
    const base = cfg.base || '/blog';
    blog = buildBlog({
      vault, outDir: path.join(out, base.replace(/^\//, '')), base, siteUrl,
      title: blogTitle || cfg.title || 'Blog', description: blogDescription || cfg.description || '',
      siteName: cfg.siteName || '', homeUrl: cfg.homeUrl || '/', allowHtml: !!cfg.allowHtml,
      stylesheets: Array.isArray(cfg.stylesheets) ? cfg.stylesheets : [],
      // Only the known values are passed on, so a typo in the config gives today's default, not a half-applied option.
      indexStyle: cfg.indexStyle === 'simple' ? 'simple' : 'default',
      theme: cfg.theme === 'light' || cfg.theme === 'dark' ? cfg.theme : 'auto',
      feedTitle: typeof cfg.feedTitle === 'string' ? cfg.feedTitle : '',
      tags: cfg.tags !== false,   // tags are on unless the config says exactly false
      feed: cfg.feed !== false,   // same for the Atom feed
    });
    addToSitemap(path.join(out, 'sitemap.xml'), siteUrl, blog.urls);
  }
  return { out, blog };
}

// Runs the build when this file is started from the command line (not when it is imported).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build.mjs')) {
  const a = args(process.argv.slice(2));
  try {
    const r = build({ content: a.content, vault: a.vault, out: a.out, siteUrl: a['site-url'], blogTitle: a['blog-title'], blogDescription: a['blog-description'] });
    console.log(`built ${r.out}` + (r.blog ? `: ${r.blog.posts.length} posts, ${r.blog.tags.length} tags, ${r.blog.assets.length} attachments` : ''));
  } catch (err) { console.error(err.message); process.exit(1); }
}
