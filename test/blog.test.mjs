/**
 * @file blog.test.mjs
 * Tests for the builder: builds the example content and fixture vault once, then checks the publish
 * rule, privacy, links, callouts, embeds, frontmatter, index/tag/feed pages and escaping.
 *
 * Run with: node --test test/
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-12
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { isPublished, parseNote } from '../lib/blog.mjs';
import { createMarkdown, stripComments } from '../lib/markdown.mjs';

/** Folder of this test file. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The fixture vault with published and private notes. */
const VAULT = path.join(HERE, 'fixtures', 'vault');
/** The example content folder that is copied as the site. */
const CONTENT = path.join(HERE, '..', 'examples', 'content');

/**
 * Builds the site into a fresh temporary folder.
 * @returns {{out: string, r: Object, files: string[], read: Function, all: Function}} The output folder, the build result, every written file, read(rel) for one file's text, and all() for every file's content joined.
 */
function buildOnce() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-engine-test-'));
  const r = build({ content: CONTENT, vault: VAULT, out, siteUrl: 'https://example.com' });
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : files.push(f); } })(out);
  return { out, r, files, read: rel => fs.readFileSync(path.join(out, rel), 'utf8'), all: () => files.map(f => fs.readFileSync(f).toString('latin1')).join('\n') };
}
/** The one build that all tests inspect. */
const B = buildOnce();

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
