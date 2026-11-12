// HTML for the blog pages, laid out like Obsidian's reading view: a 700px column, the inline title, the
// Properties block, the note, and "Linked mentions" at the bottom.
import { escapeHtml as e, formatDate, tagSlug, isoDate } from './util.mjs';
import { ICON_LINK } from './icons.mjs';

const svg = d => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon" aria-hidden="true">${d}</svg>`;
const I = {
  text: svg('<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/>'),
  list: svg('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
  tags: svg('<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5" fill="currentColor"/>'),
  calendar: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
  check: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>'),
  number: svg('<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
};
// keys that steer publishing; they're not shown in the Properties block
const HIDDEN_PROPS = new Set(['publish', 'draft', 'slug', 'title', 'description', 'cssclasses', 'cssclass']);

function layout({ title, ctx, body, description = '', canonical = '', bodyClass = '' }) {
  const b = ctx.base;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
${description ? `<meta name="description" content="${e(description)}">` : ''}
${canonical ? `<link rel="canonical" href="${e(canonical)}">` : ''}
<link rel="alternate" type="application/atom+xml" title="${e(ctx.title)}" href="${b}/feed.xml">
<link rel="stylesheet" href="${b}/obsidian.css">
<script src="${b}/theme.js"></script>
</head>
<body class="${bodyClass}">
<div class="view-header">
  <nav class="view-header-breadcrumbs" aria-label="Breadcrumbs">
    ${ctx.siteName ? `<a class="view-header-breadcrumb" href="${e(ctx.homeUrl)}">${e(ctx.siteName)}</a><span class="view-header-breadcrumb-separator">/</span>` : ''}
    <a class="view-header-breadcrumb" href="${b}/">${e(ctx.title)}</a>
  </nav>
  <div class="view-actions">
    <a class="clickable-icon" href="${b}/feed.xml" aria-label="Feed" title="Feed">${svg('<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>')}</a>
    <button class="clickable-icon theme-toggle" type="button" aria-label="Switch light/dark" title="Switch light/dark"><span class="when-light">${I.moon}</span><span class="when-dark">${I.sun}</span></button>
  </div>
</div>
<main class="markdown-reading-view">
<div class="markdown-preview-view markdown-rendered">
<div class="markdown-preview-sizer">
${body}
</div>
</div>
</main>
</body>
</html>
`;
}

function propValue(k, v, ctx) {
  if (k === 'tags' || k === 'tag') {
    const list = (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).map(t => String(t).replace(/^#/, '')).filter(Boolean);
    return { icon: I.tags, html: `<div class="multi-select-container">${list.map(t => `<a class="multi-select-pill tag" href="${ctx.base}/tags/${tagSlug(t)}/">${e(t)}</a>`).join('')}</div>` };
  }
  if (typeof v === 'boolean') return { icon: I.check, html: `<input type="checkbox" class="metadata-input-checkbox" disabled${v ? ' checked' : ''}>` };
  if (typeof v === 'number') return { icon: I.number, html: `<div class="metadata-input-longtext">${e(v)}</div>` };
  if (v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:]+)?$/.test(v))) {
    return { icon: I.calendar, html: `<div class="metadata-input-longtext"><time datetime="${e(isoDate(v))}">${e(formatDate(isoDate(v)))}</time></div>` };
  }
  if (Array.isArray(v)) return { icon: I.list, html: `<div class="multi-select-container">${v.map(x => `<span class="multi-select-pill">${e(typeof x === 'object' ? JSON.stringify(x) : x)}</span>`).join('')}</div>` };
  if (v && typeof v === 'object') return { icon: I.text, html: `<div class="metadata-input-longtext">${e(JSON.stringify(v))}</div>` };
  const s = String(v ?? '');
  if (/^https?:\/\/\S+$/.test(s)) return { icon: I.link, html: `<div class="metadata-input-longtext"><a class="external-link" href="${e(s)}" target="_blank" rel="noopener nofollow">${e(s)}</a></div>` };
  return { icon: I.text, html: `<div class="metadata-input-longtext">${e(s)}</div>` };
}

function properties(n, ctx) {
  const rows = Object.entries(n.fm).filter(([k, v]) => !HIDDEN_PROPS.has(k.toLowerCase()) && v !== null && v !== undefined && v !== '');
  if (!rows.length) return '';
  return `<div class="metadata-container" tabindex="-1">
<div class="metadata-properties-heading"><div class="metadata-properties-title">Properties</div></div>
<div class="metadata-content">
${rows.map(([k, v]) => { const p = propValue(k, v, ctx); return `<div class="metadata-property" data-property-key="${e(k)}"><div class="metadata-property-key"><span class="metadata-property-icon">${p.icon}</span><span class="metadata-property-key-input">${e(k)}</span></div><div class="metadata-property-value">${p.html}</div></div>`; }).join('\n')}
</div>
</div>`;
}

function backlinks(n) {
  const list = n.backlinks || [];
  return `<div class="embedded-backlinks">
<div class="backlink-pane">
<div class="tree-item-self"><div class="tree-item-inner">Linked mentions</div><div class="tree-item-flair">${list.length}</div></div>
${list.length ? `<div class="search-result-container">${list.map(b => `<div class="tree-item search-result"><a class="tree-item-self search-result-file-title" href="${e(b.url)}"><div class="tree-item-inner">${e(b.title)}</div></a><div class="search-result-file-matches"><div class="search-result-file-match">${e(b.excerpt.length > 160 ? b.excerpt.slice(0, 157).replace(/\s+\S*$/, "") + "…" : b.excerpt)}</div></div></div>`).join('')}</div>`
    : '<div class="search-empty-state">No backlinks found.</div>'}
</div>
</div>`;
}

export function notePage(n, ctx) {
  const body = `<div class="inline-title" role="heading" aria-level="1">${e(n.title)}</div>
${properties(n, ctx)}
<article class="note-content">
${n.html}
</article>
<footer class="mod-footer">${backlinks(n)}</footer>`;
  return layout({ title: `${n.title} · ${ctx.title}`, ctx, body, description: n.excerpt, canonical: ctx.siteUrl ? ctx.siteUrl + n.url : '', bodyClass: 'is-note' + (n.fm.cssclasses ? ' ' + [].concat(n.fm.cssclasses).map(String).join(' ') : '') });
}

function postList(posts, ctx) {
  if (!posts.length) return '<p class="search-empty-state">Nothing published yet.</p>';
  return `<ul class="post-list">
${posts.map(p => `<li class="post-item">
<a class="post-title internal-link" href="${e(p.url)}">${e(p.title)}</a>
<div class="post-meta">${p.date ? `<time datetime="${e(p.date)}">${e(formatDate(p.date))}</time>` : ''}${p.tags.length ? ` <span class="post-tags">${p.tags.map(t => `<a class="tag" href="${ctx.base}/tags/${tagSlug(t)}/">#${e(t)}</a>`).join(' ')}</span>` : ''}</div>
<p class="post-excerpt">${e(p.excerpt)}${p.excerpt.length >= 220 ? '…' : ''}</p>
</li>`).join('\n')}
</ul>`;
}

export function indexPage(posts, ctx) {
  const body = `<div class="inline-title" role="heading" aria-level="1">${e(ctx.title)}</div>
${ctx.description ? `<p class="blog-description">${e(ctx.description)}</p>` : ''}
${postList(posts, ctx)}
${ctx.tags.length ? `<h2 id="tags">Tags</h2><p class="tag-cloud">${ctx.tags.map(t => `<a class="tag" href="${ctx.base}/tags/${tagSlug(t)}/">#${e(t)}</a>`).join(' ')}</p>` : ''}`;
  return layout({ title: ctx.title, ctx, body, description: ctx.description, canonical: ctx.siteUrl ? ctx.siteUrl + ctx.base + '/' : '', bodyClass: 'is-index' });
}

export function tagPage(tag, posts, ctx) {
  const body = `<div class="inline-title" role="heading" aria-level="1"><span class="tag tag-title">#${e(tag)}</span></div>
<p class="blog-description">${posts.length} ${posts.length === 1 ? 'note' : 'notes'} tagged #${e(tag)} · <a class="internal-link" href="${ctx.base}/">all notes</a></p>
${postList(posts, ctx)}`;
  return layout({ title: `#${tag} · ${ctx.title}`, ctx, body, bodyClass: 'is-tag' });
}

export function feedXml(posts, ctx) {
  const site = ctx.siteUrl || '';
  const updated = (posts[0] && (posts[0].updated || posts[0].date)) || new Date().toISOString().slice(0, 10);
  // relative links in the content become absolute, so feed readers can follow them
  const abs = html => site ? html.replace(/(href|src)="\//g, `$1="${site}/`) : html;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${e(ctx.title)}</title>
${ctx.description ? `<subtitle>${e(ctx.description)}</subtitle>` : ''}
<id>${e(site + ctx.base + '/')}</id>
<link href="${e(site + ctx.base + '/')}"/>
<link rel="self" href="${e(site + ctx.base + '/feed.xml')}"/>
<updated>${updated}T00:00:00Z</updated>
<author><name>${e(ctx.siteName || ctx.title)}</name></author>
${posts.map(p => `<entry>
<title>${e(p.title)}</title>
<id>${e(site + p.url)}</id>
<link href="${e(site + p.url)}"/>
<updated>${p.updated || p.date}T00:00:00Z</updated>
<published>${p.date}T00:00:00Z</published>
${p.tags.map(t => `<category term="${e(t)}"/>`).join('')}
<summary>${e(p.excerpt)}</summary>
<content type="html">${e(abs(p.html))}</content>
</entry>`).join('\n')}
</feed>
`;
}

export { ICON_LINK };
