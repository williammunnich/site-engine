/**
 * @file blog.test.mjs
 * Tests for the builder: builds the example content and fixture vault once, then checks the publish
 * rule, privacy, links, callouts, embeds, frontmatter, index/tag/feed pages and escaping. The options
 * (indexStyle, theme, feedTitle) get their own builds through buildWith(). The daily-note options (publishFolders,
 * dateFormat, autoTitle, lineBreaks, failOnMissing) are tested on a small vault that dailyVault() writes to a
 * temporary folder, so file names with spaces and accents do not have to live in git.
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
import { isPublished, parseNote, fixedThemeCss, leadingHeading } from '../lib/blog.mjs';
import { isoDate, isRealDate } from '../lib/util.mjs';
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
 * @param {string} [vault] - The vault to build from; the fixture vault by default.
 * @returns {{out: string, r: Object, files: string[], read: Function, all: Function}} The output folder, the build result, every written file, read(rel) for one file's text, and all() for every file's content joined.
 */
function buildWith(config = {}, vault = VAULT) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-engine-test-'));
  const r = build({ content: CONTENT, vault, out, siteUrl: 'https://example.com', config });
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
  assert.match(idx, /<a class="post-title internal-link" href="\/blog\/second\/"><strong>Second post<\/strong><\/a>\n<p class="post-excerpt"><a class="post-excerpt-link" href="\/blog\/second\/" tabindex="-1">[^<]+<\/a><\/p>/);
  assert.match(idx, /<a class="post-title internal-link" href="\/blog\/hello-world\/"><strong>[^<]+<\/strong><\/a>\n<p class="post-excerpt"><a class="post-excerpt-link" href="\/blog\/hello-world\/" tabindex="-1">[^<]+<\/a><\/p>/);
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

test('backlinks: false leaves "Linked mentions" and its footer off note pages; the default keeps them', () => {
  const note = buildWith({ backlinks: false }).read('blog/hello-world/index.html');
  for (const gone of ['mod-footer', 'embedded-backlinks', 'Linked mentions', 'No backlinks found']) assert.ok(!note.includes(gone), gone + ' is still on the note page');
  assert.ok(note.includes('<article class="note-content">'), 'the note itself is still there');
  assert.ok(B.read('blog/hello-world/index.html').includes('Linked mentions'), 'default build keeps the block');
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

// ---------------------------------------------------------------------------------------------------------------
// Daily notes as posts: publishFolders, dateFormat, autoTitle, lineBreaks, failOnMissing, pasted images and files
// ---------------------------------------------------------------------------------------------------------------

/**
 * Writes a small vault the way Obsidian leaves one when daily notes are the posts: notes named by date with no
 * front matter, and pasted files in one assets/ folder, linked by relative path.
 * @param {Object<string, string>} [extra] - More notes to write, as { "vault/path.md": "text" }.
 * @returns {string} Path of the new vault folder.
 */
function dailyVault(extra = {}) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'site-engine-vault-'));
  const png = fs.readFileSync(path.join(VAULT, 'attachments', 'diagram.png'));
  const notes = {
    'daily/11-13-2026.md': [
      'First line.', 'Second line of the same paragraph.', '',
      '![](../assets/Pasted%20image%2020261113.png)',            // what Obsidian writes on paste
      '![shot|200](../assets/Pasted image 20261113.png)',        // typed by hand, with a space and a width
      '![[Pasted image 20261113.png]]',                          // Obsidian's own embed form
      '![](../assets/caf%C3%A9%20photo.png)',                    // a file name that is not plain ASCII
      '[the manual](../assets/User manual.pdf) and ![](../assets/User%20manual.pdf) and [[User manual.pdf]]', '',
      'See [[11-12-2026]] and [yesterday](11-12-2026.md). Not public: [[11-10-2026]] and [hidden](11-10-2026.md) and [[notes]].',
    ].join('\n'),
    'daily/11-12-2026.md': '# A day with a heading\n\nBody of the twelfth.\n',
    'daily/11-10-2026.md': '---\npublish: false\n---\nHIDDENDAILY\n',
    'daily/01-02-2026.md': 'The second of January, or the first of February.\n',
    'daily/idea.md': '---\ndraft: true\n---\nDRAFTDAILY\n',
    'posts/Old post.md': '---\ndate: 2026-11-01\n---\nAn older post.\n',
    'notes/notes.md': 'PRIVATENOTE outside the publish folders.\n',
    ...extra,
  };
  for (const [rel, text] of Object.entries(notes)) {
    fs.mkdirSync(path.join(v, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(v, rel), text);
  }
  fs.mkdirSync(path.join(v, 'assets'), { recursive: true });
  for (const name of ['Pasted image 20261113.png', 'café photo.png', 'never used.png']) fs.writeFileSync(path.join(v, 'assets', name), png);
  fs.writeFileSync(path.join(v, 'assets', 'User manual.pdf'), '%PDF-1.4 test');
  return v;
}
/** The settings a site uses to publish its daily notes. */
const DAILY = { publishFolders: ['posts', 'daily'], dateFormat: 'MM-DD-YYYY', autoTitle: true, lineBreaks: true, failOnMissing: true };

test('publishFolders: notes in the listed folders publish with no front matter; publish: false and draft: true stay out', () => {
  assert.equal(isPublished('daily/11-13-2026.md', {}, ['posts', 'daily']), true);
  assert.equal(isPublished('daily/11-13-2026.md', {}), false, 'the default is still posts/ only');
  assert.equal(isPublished('daily/a.md', { publish: false }, ['posts', 'daily']), false);
  assert.equal(isPublished('daily/a.md', { draft: true }, ['posts', 'daily']), false);
  assert.equal(isPublished('dailyish/a.md', {}, ['daily']), false, 'a folder name must match whole');
  const D = buildWith(DAILY, dailyVault());
  assert.deepEqual(D.r.blog.posts.map(p => p.slug), ['11-13-2026', '11-12-2026', 'old-post', '01-02-2026'], 'published notes, newest first');
  const all = D.all();
  for (const s of ['HIDDENDAILY', 'DRAFTDAILY', 'PRIVATENOTE']) assert.ok(!all.includes(s), s + ' leaked');
  assert.ok(!fs.existsSync(path.join(D.out, 'blog/11-10-2026')) && !fs.existsSync(path.join(D.out, 'blog/idea')));
  // without the option the same vault publishes only posts/
  assert.deepEqual(buildWith({}, dailyVault()).r.blog.posts.map(p => p.slug), ['old-post']);
});

test('dateFormat: the file name gives the date, read month first or day first; impossible dates stop the build', () => {
  assert.equal(isoDate('11-13-2026'), '2026-11-13');
  assert.equal(isoDate('13-11-2026', 'DD-MM-YYYY'), '2026-11-13');
  assert.equal(isoDate('2026-11-13', 'DD-MM-YYYY'), '2026-11-13', 'year-first is always understood');
  assert.equal(isoDate('11-13-2026', 'YYYY-MM-DD'), '');
  assert.equal(isRealDate('2026-11-13'), true);
  assert.equal(isRealDate('2026-13-11'), false);
  assert.equal(isRealDate('2026-02-30'), false);
  const date = (D, slug) => D.r.blog.posts.find(p => p.slug === slug).date;
  const M = buildWith(DAILY, dailyVault());
  assert.equal(date(M, '11-13-2026'), '2026-11-13');
  assert.equal(date(M, '01-02-2026'), '2026-01-02');
  assert.equal(date(M, 'old-post'), '2026-11-01', 'a date property still works');
  const idx = M.read('blog/index.html');
  assert.ok(idx.indexOf('/blog/11-13-2026/') < idx.indexOf('/blog/11-12-2026/') && idx.indexOf('/blog/11-12-2026/') < idx.indexOf('/blog/old-post/')
    && idx.indexOf('/blog/old-post/') < idx.indexOf('/blog/01-02-2026/'), 'the index is sorted by the real date, newest first');
  // day first: the same file name is another day, and the US-order names are no longer dates
  const dayFirst = dailyVault();
  for (const f of ['11-13-2026.md', '11-12-2026.md', '11-10-2026.md']) fs.rmSync(path.join(dayFirst, 'daily', f));
  fs.writeFileSync(path.join(dayFirst, 'daily', '13-11-2026.md'), 'Day first.\n');
  const DF = buildWith({ ...DAILY, dateFormat: 'DD-MM-YYYY' }, dayFirst);
  assert.equal(date(DF, '13-11-2026'), '2026-11-13');
  assert.equal(date(DF, '01-02-2026'), '2026-02-01');
  // month 13 is an error that names the file, not a guess
  assert.throws(() => buildWith(DAILY, dayFirst), /daily\/13-11-2026\.md.*not a real date.*MM-DD-YYYY/);
  assert.throws(() => buildWith(DAILY, dailyVault({ 'posts/x.md': '---\ndate: 2026-02-30\n---\nx' })), /posts\/x\.md.*not a real date/);
  assert.throws(() => buildWith({ dateFormat: 'D/M/Y' }), /"dateFormat" must be one of/);
});

test('autoTitle: title property, else the first-line heading (shown once), else the date written out; off by default', () => {
  const D = buildWith(DAILY, dailyVault({ 'posts/Named.md': '---\ntitle: From the property\n---\n# Heading stays\n' }));
  const title = slug => D.r.blog.posts.find(p => p.slug === slug).title;
  assert.equal(title('11-13-2026'), 'November 13, 2026');
  assert.equal(title('11-12-2026'), 'A day with a heading');
  assert.equal(title('old-post'), 'Old post', 'a name that is not a date stays the title');
  assert.equal(title('named'), 'From the property');
  const twelfth = D.read('blog/11-12-2026/index.html');
  assert.match(twelfth, /<div class="inline-title" role="heading" aria-level="1">A day with a heading<\/div>/);
  assert.ok(!twelfth.includes('<h1'), 'the heading that became the title is not repeated in the body');
  assert.match(D.read('blog/named/index.html'), /<h1 id="heading-stays">/, 'with a title property the heading stays in the body');
  assert.match(D.read('blog/index.html'), /href="\/blog\/11-13-2026\/"><strong>November 13, 2026<\/strong>|href="\/blog\/11-13-2026\/">November 13, 2026</);
  assert.deepEqual(leadingHeading('\n# Hi there #\nbody'), { title: 'Hi there', body: 'body' });
  assert.equal(leadingHeading('text\n# Later'), null);
  assert.equal(leadingHeading('## Not level one'), null);
  // off (the default): the file name is the title and the heading stays where it is
  const off = buildWith({ publishFolders: ['daily'] }, dailyVault());
  assert.equal(off.r.blog.posts.find(p => p.slug === '11-13-2026').title, '11-13-2026');
  assert.match(off.read('blog/11-12-2026/index.html'), /<h1 id="a-day-with-a-heading">/);
});

test('pasted images and files: relative paths with %20, spaces and accents are copied and linked from the post', () => {
  const D = buildWith(DAILY, dailyVault());
  const h = D.read('blog/11-13-2026/index.html');
  const img = /src="(\/blog\/assets\/pasted-image-20261113-[0-9a-f]{8}\.png)"/.exec(h);
  assert.ok(img, 'the pasted image is on the page');
  assert.equal(h.split(img[1]).length - 1, 3, 'the %20 form, the form with a space and the ![[embed]] all show the same file');
  assert.match(h, /<img src="[^"]+" alt="shot" width="200" loading="lazy">/, '![alt|200](…) sets the width');
  assert.match(h, /<img src="\/blog\/assets\/cafe-photo-[0-9a-f]{8}\.png"/);
  const pdf = /href="(\/blog\/assets\/user-manual-[0-9a-f]{8}\.pdf)"[^>]*>the manual<\/a>/.exec(h);
  assert.ok(pdf, 'a link to a PDF points at the copy');
  assert.equal(h.split(pdf[1]).length - 1, 3, 'the link, the ![](pdf) form and the [[pdf]] form all link the file');
  // every address on the page is a file that was written, and nothing unused was copied
  for (const m of h.matchAll(/(?:src|href)="(\/blog\/assets\/[^"]+)"/g)) assert.ok(fs.existsSync(path.join(D.out, m[1])), m[1] + ' was not written');
  assert.equal(D.r.blog.assets.length, 3);
  assert.ok(!D.files.some(f => /never-used/.test(f)));
  assert.deepEqual(D.r.blog.missing, []);
  assert.ok(!h.includes('is-unresolved internal-embed') && !h.includes('internal-embed is-unresolved'));
});

test('links between daily notes: published targets are links, private or missing ones are plain text', () => {
  const h = buildWith(DAILY, dailyVault()).read('blog/11-13-2026/index.html');
  assert.match(h, /<a class="internal-link" data-href="11-12-2026" href="\/blog\/11-12-2026\/">11-12-2026<\/a>/);
  assert.match(h, /<a href="\/blog\/11-12-2026\/" class="internal-link">yesterday<\/a>/);
  assert.match(h, /<span class="internal-link is-unresolved">11-10-2026<\/span>/);
  assert.match(h, /<span class="internal-link is-unresolved">hidden<\/span>/);
  assert.match(h, /<span class="internal-link is-unresolved">notes<\/span>/);
  assert.ok(!h.includes('href="#"') && !h.includes('11-10-2026/'), 'no dead link and no address of a private note');
});

test('lineBreaks: a single line break shows as one, like in Obsidian; off by default', () => {
  assert.match(buildWith(DAILY, dailyVault()).read('blog/11-13-2026/index.html'), /First line\.<br>\s*Second line/);
  assert.match(buildWith({ publishFolders: ['daily'] }, dailyVault()).read('blog/11-13-2026/index.html'), /First line\.\nSecond line/);
});

test('a missing image is reported, and with failOnMissing it stops the build naming the note and the file', () => {
  const broken = { 'daily/11-14-2026.md': '![](../assets/not%20here.png) and ![[gone.png]] and [doc](../assets/gone.pdf)' };
  assert.throws(() => buildWith(DAILY, dailyVault(broken)), err => {
    assert.match(err.message, /3 missing attachment/);
    assert.match(err.message, /daily\/11-14-2026\.md: \.\.\/assets\/not%20here\.png/);
    assert.match(err.message, /daily\/11-14-2026\.md: gone\.png/);
    assert.match(err.message, /daily\/11-14-2026\.md: \.\.\/assets\/gone\.pdf/);
    return true;
  });
  // without the option the build goes through, the page shows the name as text, and the result lists what is missing
  const soft = buildWith({ ...DAILY, failOnMissing: false }, dailyVault(broken));
  assert.equal(soft.r.blog.missing.length, 3);
  const h = soft.read('blog/11-14-2026/index.html');
  assert.match(h, /<span class="internal-embed is-unresolved">/);
  assert.ok(!h.includes('<img'), 'no broken image tag');
  assert.match(h, /<span class="internal-link is-unresolved">doc<\/span>/);
});
