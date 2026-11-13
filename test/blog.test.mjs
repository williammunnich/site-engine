/**
 * @file blog.test.mjs
 * Tests for the builder: builds the example content and fixture vault once, then checks the publish
 * rule, privacy, links, callouts, embeds, frontmatter, index/tag/feed pages and escaping. The options
 * (indexStyle, theme, feedTitle) get their own builds through buildWith().
 *
 * Run with: node --test test/
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-13
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { isPublished, parseNote, fixedThemeCss } from '../lib/blog.mjs';
import { createMarkdown, stripComments } from '../lib/markdown.mjs';

/** Folder of this test file. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The fixture vault with published and private notes. */
const VAULT = path.join(HERE, 'fixtures', 'vault');
/** The example content folder that is copied as the site. */
const CONTENT = path.join(HERE, '..', 'examples', 'content');

/**
 * Builds the site into a fresh temporary folder.
 * @param {Object} [config] - Settings laid over the example's blog.config.json, to try an option.
 * @returns {{out: string, r: Object, files: string[], read: Function, all: Function}} The output folder, the build result, every written file, read(rel) for one file's text, and all() for every file's content joined.
 */
function buildWith(config = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-engine-test-'));
  const r = build({ content: CONTENT, vault: VAULT, out, siteUrl: 'https://example.com', config });
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(f); } })(out);
  return { out, r, files, read: rel => fs.readFileSync(path.join(out, rel), 'utf8'), all: () => files.map(f => fs.readFileSync(f).toString('latin1')).join('\n') };
}
/** The one build that all tests inspect. */
const B = buildWith();

test('publish rule: posts/ folder or publish: true; never publish: false or draft: true', () => {
  assert.equal(isPublished('posts/a.md', {}), true);
  assert.equal(isPublished('notes/a.md', {}), false);
  assert.equal(isPublished('notes/a.md', { publish: true }), true);
  assert.equal(isPublished('posts/a.md', { publish: false }), false);
  assert.equal(isPublished('posts/a.md', { draft: true }), false);
  assert.equal(isPublished('daily/2026-11-10.md', { publish: 'true' }), true);
  assert.deepEqual(B.r.blog.posts.map(p => p.slug).sort(), ['hello-world', 'second']);
});

test('private notes never leak: not as pages, text, links, embeds, backlinks, comments or attachments', () => {
  const all = B.all();
  for (const s of ['TOPSECRET', 'DRAFTSECRET', 'OPTOUTSECRET', 'DAILYSECRET', 'TEMPLATESECRET', 'SECRETCOMMENT']) assert.ok(!all.includes(s), s + ' leaked');
  assert.ok(!B.files.some(f => /secret|draft|optout|2026-11-09|unused/i.test(path.basename(f))), 'a private file was written');
  assert.ok(!all.includes('href="/blog/secret-plan/'), 'link to a private note');
  // the private note links to Hello world, but it must not show up as a backlink
  const hello = B.read('blog/hello-world/index.html');
  assert.match(hello, /Linked mentions<\/div><div class="tree-item-flair">1</);
  assert.match(hello, /href="\/blog\/second\/"><div class="tree-item-inner">Second post/);
});

test('wikilinks: plain, alias, heading; private targets become text', () => {
  const h = B.read('blog/hello-world/index.html');
  assert.match(h, /<a class="internal-link" data-href="Second post" href="\/blog\/second\/">Second post<\/a>/);
  assert.match(h, /href="\/blog\/second\/#next-steps">the plan<\/a>/);
  assert.match(h, /<span class="internal-link is-unresolved">Secret plan<\/span>/);
  assert.match(h, /<span class="internal-link is-unresolved">my alias<\/span>/);
  assert.match(B.read('blog/second/index.html'), /<h2 id="next-steps">/);
});

test('wikilinks and tags inside code stay literal', () => {
  const h = B.read('blog/hello-world/index.html');
  assert.match(h, /const x = &quot;\[\[Secret plan\]\] #notatag&quot;/);
  assert.ok(!h.includes('/tags/notatag/'));
  assert.ok(!h.includes('/tags/12/'), 'a number is not a tag');
});

test('callouts: types, titles, foldable', () => {
  const h = B.read('blog/hello-world/index.html');
  assert.match(h, /<div class="callout" data-callout="tip" data-callout-type="tip">/);
  assert.match(h, /callout-title-inner">Keep notes short</);
  assert.match(h, /<details class="callout is-collapsible" data-callout="warning"[^>]*><summary/);
  assert.match(h, /<details class="callout is-collapsible" data-callout="question" data-callout-type="faq" open>/);
  const md = createMarkdown();
  assert.match(md.render('> [!NOTE]\n> body'), /data-callout="note"[\s\S]*callout-title-inner">Note</);
  assert.match(md.render('> [!unknown] x\n> y'), /data-callout="note" data-callout-type="unknown"/);
  assert.match(md.render('> just a quote'), /<blockquote>/);
});

test('embeds: images copied once with size; unreferenced attachments not copied; private note embeds vanish', () => {
  const h = B.read('blog/hello-world/index.html');
  assert.match(h, /<img src="\/blog\/assets\/diagram-[0-9a-f]{8}\.png" alt="diagram" width="300"/);
  assert.equal(B.r.blog.assets.length, 1);
  assert.ok(!B.read('blog/second/index.html').includes('markdown-embed'));
});

test('frontmatter: properties block, tags, dates, slug; publish keys hidden', () => {
  const h = B.read('blog/hello-world/index.html');
  assert.match(h, /class="metadata-container"/);
  assert.match(h, /data-property-key="status"[\s\S]*?started/);
  assert.match(h, /multi-select-pill tag" href="\/blog\/tags\/cloudcut\/start\/">cloudcut\/start</);
  assert.ok(!B.read('blog/second/index.html').includes('data-property-key="publish"'));
  assert.deepEqual(parseNote('---\na: 1\n---\nbody').fm, { a: 1 });
  assert.deepEqual(parseNote('no frontmatter').fm, {});
  assert.deepEqual(parseNote('---\n: bad: [yaml\n---\nx').fm, {});
});

test('index, tag pages, feed and sitemap', () => {
  const idx = B.read('blog/index.html');
  assert.ok(idx.indexOf('/blog/second/') < idx.indexOf('/blog/hello-world/'), 'newest first');
  assert.match(B.read('blog/tags/cloudcut/index.html'), /hello-world/);
  const feed = B.read('blog/feed.xml');
  assert.match(feed, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.match(feed, /<link href="https:\/\/example.com\/blog\/second\/"\/>/);
  assert.match(B.read('sitemap.xml'), /<loc>https:\/\/example.com\/blog\/hello-world\/<\/loc>/);
  assert.ok(B.read('index.html').includes('Example site'), 'content copied as is');
});

test('HTML is escaped; comments are stripped; task lists and highlights render', () => {
  const md = createMarkdown();
  assert.ok(!md.render('<script>alert(1)</script>').includes('<script>'));
  assert.equal(stripComments('a %%x\ny%% b'), 'a  b');
  assert.match(md.render('- [x] done'), /checked> done/);
  assert.match(md.render('==hi=='), /<mark>hi<\/mark>/);
  assert.match(md.render('[[a|<b>]]', { resolve: () => ({ id: 'a', url: '/blog/a/', title: 'a' }), links: new Set() }), /&lt;b&gt;/);
});

test('default index and theme are unchanged when no option is set', () => {
  const idx = B.read('blog/index.html');
  assert.match(idx, /<ul class="post-list">/);
  assert.match(idx, /class="post-meta"><time datetime=/, 'dates are shown');
  assert.match(idx, /<p class="blog-description">/);
  assert.match(idx, /<h2 id="tags">Tags<\/h2><p class="tag-cloud">/);
  assert.ok(!idx.includes('post-divider') && !idx.includes('post-list-simple'), 'no simple-style markup');
  assert.match(idx, /<html lang="en">/);
  assert.match(idx, /<script src="\/blog\/theme\.js"><\/script>/);
  assert.match(idx, /class="clickable-icon theme-toggle"/);
  assert.ok(fs.existsSync(path.join(B.out, 'blog/theme.js')));
  assert.match(B.read('blog/obsidian.css'), /prefers-color-scheme: dark/);
  assert.match(B.read('blog/feed.xml'), /<title>Devlog<\/title>/, 'the feed is named after the blog title');
});

test('indexStyle "simple": heading, bold linked titles, previews, dividers between posts, nothing else', () => {
  const S = buildWith({ indexStyle: 'simple', title: 'Blog' });
  const idx = S.read('blog/index.html');
  assert.match(idx, /<div class="inline-title" role="heading" aria-level="1">Blog<\/div>/);
  assert.match(idx, /<a class="post-title internal-link" href="\/blog\/second\/"><strong>Second post<\/strong><\/a>\n<p class="post-excerpt">[^<]+<\/p>/);
  assert.match(idx, /<a class="post-title internal-link" href="\/blog\/hello-world\/"><strong>[^<]+<\/strong><\/a>\n<p class="post-excerpt">[^<]+<\/p>/);
  assert.ok(idx.indexOf('/blog/second/') < idx.indexOf('/blog/hello-world/'), 'newest first');
  // two posts, so exactly one divider, and it sits between them
  assert.equal(idx.split('<hr class="post-divider">').length - 1, S.r.blog.posts.length - 1);
  const d = idx.indexOf('<hr class="post-divider">');
  assert.ok(idx.indexOf('/blog/second/') < d && d < idx.indexOf('/blog/hello-world/'), 'divider between the posts');
  for (const gone of ['tag-cloud', 'id="tags"', 'post-meta', 'post-tags', '<time', 'blog-description', '/blog/tags/']) assert.ok(!idx.includes(gone), gone + ' is on the simple index');
  // the rest of the blog is untouched: post pages, tag pages and the header link home
  assert.match(S.read('blog/hello-world/index.html'), /class="metadata-container"/);
  assert.match(S.read('blog/tags/cloudcut/index.html'), /hello-world/);
  assert.match(idx, /<a class="view-header-breadcrumb" href="\/">example\.com<\/a>/);
  assert.match(S.read('blog/obsidian.css'), /hr\.post-divider/);
});

test('theme "light": one fixed theme, no button, no script, no dark rules', () => {
  const L = buildWith({ theme: 'light' });
  for (const page of ['blog/index.html', 'blog/hello-world/index.html', 'blog/tags/cloudcut/index.html']) {
    const h = L.read(page);
    assert.match(h, /<html lang="en" class="theme-light">/, page);
    for (const gone of ['theme-toggle', 'theme.js', 'when-dark', 'when-light', 'Switch light/dark']) assert.ok(!h.includes(gone), `${gone} left in ${page}`);
    assert.match(h, /<div class="view-actions">\s*<a class="clickable-icon" href="\/blog\/feed\.xml" aria-label="Feed"/, 'the feed link stays');
  }
  assert.ok(!fs.existsSync(path.join(L.out, 'blog/theme.js')), 'theme.js is not copied');
  const css = L.read('blog/obsidian.css');
  for (const gone of ['prefers-color-scheme', ':root.theme-dark', ':root:not(.theme-light)', 'theme-switch:start', 'theme-dark:start', 'when-dark', '#1e1e1e']) assert.ok(!css.includes(gone), gone + ' left in the stylesheet');
  assert.match(css, /--color-base-00: #ffffff/, 'the light values stay');
  assert.match(css, /\.post-title \{/, 'the rest of the stylesheet stays');
});

test('theme "dark" keeps the dark values and drops the switch; unknown values mean "auto"; feedTitle names the feed', () => {
  const D = buildWith({ theme: 'dark', feedTitle: 'Example devlog' });
  assert.match(D.read('blog/index.html'), /<html lang="en" class="theme-dark">/);
  const css = D.read('blog/obsidian.css');
  assert.ok(!css.includes('prefers-color-scheme') && !css.includes('when-dark'));
  assert.match(css, /:root\.theme-dark \{[^}]*--color-base-00: #1e1e1e/);
  assert.match(D.read('blog/feed.xml'), /<title>Example devlog<\/title>/);
  assert.match(D.read('blog/index.html'), /type="application\/atom\+xml" title="Example devlog"/);
  assert.match(buildWith({ theme: 'sepia', indexStyle: 'fancy' }).read('blog/index.html'), /theme-toggle[\s\S]*<ul class="post-list">/);
  assert.throws(() => fixedThemeCss('a /* theme-switch:start */ b', 'light'), /no matching/);
});

test('tags: false removes tags everywhere a reader could see them; the default keeps them', () => {
  const T = buildWith({ tags: false });
  assert.deepEqual(T.r.blog.tags, []);
  assert.ok(!T.files.some(f => f.includes(`${path.sep}tags${path.sep}`)), 'a tag page was written');
  assert.ok(!T.r.blog.urls.some(u => u.includes('/tags/')), 'a tag page is in the url list');
  assert.ok(!T.read('sitemap.xml').includes('/tags/'), 'a tag page is in the sitemap');
  const all = ['blog/index.html', 'blog/hello-world/index.html', 'blog/second/index.html', 'blog/feed.xml'].map(f => T.read(f)).join('\n');
  for (const gone of ['/tags/', 'class="tag"', 'tag-cloud', 'post-tags', 'multi-select-pill tag', 'data-property-key="tags"', '<category']) assert.ok(!all.includes(gone), gone + ' left with tags off');
  // an inline #tag keeps its words as plain text, and the other properties still show
  const md = createMarkdown();
  assert.equal(md.render('a #cloud/cut b', { showTags: false }).trim(), '<p>a #cloud/cut b</p>');
  assert.match(md.render('a #cloud/cut b', { base: '/blog' }), /<a href="\/blog\/tags\/cloud\/cut\/" class="tag">#cloud\/cut<\/a>/);
  assert.match(T.read('blog/hello-world/index.html'), /data-property-key="status"/);
  // default build: tags are all still there
  assert.ok(B.files.some(f => f.includes(`${path.sep}tags${path.sep}`)));
  assert.match(B.read('blog/hello-world/index.html'), /data-property-key="tags"/);
  assert.match(B.read('blog/feed.xml'), /<category term=/);
});

test('feed: false writes no feed and leaves no link to it; with a fixed theme the header is only the breadcrumbs', () => {
  const F = buildWith({ feed: false, theme: 'light' });
  assert.ok(!fs.existsSync(path.join(F.out, 'blog/feed.xml')), 'feed.xml was written');
  const pages = F.files.filter(f => f.endsWith('.html') || f.endsWith('.xml')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  for (const gone of ['feed.xml', 'application/atom+xml', 'aria-label="Feed"', 'view-actions', 'clickable-icon']) assert.ok(!pages.includes(gone), gone + ' left with the feed off');
  assert.match(F.read('blog/index.html'), /<nav class="view-header-breadcrumbs"[\s\S]*?<\/nav>\s*<\/div>\s*<main/, 'nothing after the breadcrumbs in the header');
  // feed off alone keeps the theme button; the default build keeps the feed
  const G = buildWith({ feed: false }).read('blog/index.html');
  assert.ok(!G.includes('feed.xml') && G.includes('theme-toggle'));
  assert.ok(fs.existsSync(path.join(B.out, 'blog/feed.xml')));
  assert.match(B.read('blog/index.html'), /rel="alternate" type="application\/atom\+xml"/);
});
