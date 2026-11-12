// Markdown with Obsidian's extensions: [[wikilinks]], ![[embeds]], #tags, callouts, task lists, ==highlights==,
// %%comments%% and heading anchors. Everything that points at another note goes through `env.resolve`, so only
// published notes ever become links (see lib/blog.mjs).
import MarkdownIt from 'markdown-it';
import { escapeHtml, slugify, tagSlug } from './util.mjs';
import { calloutIcon, calloutColorType, FOLD_ICON } from './icons.mjs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

export function stripComments(src) {
  // %%…%% comments (inline or across lines) are never published, like in Obsidian's reading view
  return src.replace(/%%[\s\S]*?%%/g, '');
}

export function createMarkdown({ allowHtml = false } = {}) {
  const md = new MarkdownIt({ html: allowHtml, linkify: true, typographer: false, breaks: false });

  // ---------- [[wikilinks]] and ![[embeds]]
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src, pos = state.pos;
    const embed = src.charCodeAt(pos) === 0x21 /* ! */;
    const start = embed ? pos + 1 : pos;
    if (src.slice(start, start + 2) !== '[[') return false;
    const end = src.indexOf(']]', start + 2);
    if (end < 0) return false;
    const inner = src.slice(start + 2, end);
    if (!inner || inner.includes('\n') || inner.includes('[[')) return false;
    if (!silent) {
      const t = state.push('wikilink', '', 0);
      t.meta = { embed, raw: inner };
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, idx, _o, env) => {
    const { embed, raw } = tokens[idx].meta;
    const [targetPart, ...rest] = raw.split('|');
    const display = rest.join('|').trim();
    const [target, ...hashParts] = targetPart.split('#');
    const heading = hashParts.join('#').trim();
    const name = target.trim();
    if (embed) return renderEmbed(name, heading, display, env);
    const label = display || (name ? name + (heading ? ' > ' + heading.replace(/^\^/, '') : '') : heading);
    if (!name && heading) return `<a class="internal-link" href="#${escapeHtml(slugify(heading))}">${escapeHtml(label)}</a>`;
    const r = env.resolve ? env.resolve(name) : null;
    if (!r) return `<span class="internal-link is-unresolved">${escapeHtml(label)}</span>`;   // private or missing: text only
    env.links && env.links.add(r.id);
    const href = r.url + (heading && !heading.startsWith('^') ? '#' + slugify(heading) : '');
    return `<a class="internal-link" data-href="${escapeHtml(name)}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  };

  function renderEmbed(name, heading, display, env) {
    if (IMAGE_EXT.test(name) || /\.(pdf|mp3|mp4|webm|m4a|wav|ogg|mov)$/i.test(name)) {
      const url = env.attachment ? env.attachment(name) : null;
      if (!url) return `<span class="internal-embed is-unresolved">${escapeHtml(name)}</span>`;
      if (IMAGE_EXT.test(name)) {
        let w = '', h = '', alt = name.replace(/\.[^.]+$/, '');
        const m = /^(\d+)(?:x(\d+))?$/.exec(display || '');
        if (m) { w = m[1]; h = m[2] || ''; } else if (display) alt = display;
        return `<span class="internal-embed media-embed image-embed"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''} loading="lazy"></span>`;
      }
      if (/\.(mp3|m4a|wav|ogg)$/i.test(name)) return `<span class="internal-embed media-embed"><audio controls src="${escapeHtml(url)}"></audio></span>`;
      if (/\.(mp4|webm|mov)$/i.test(name)) return `<span class="internal-embed media-embed"><video controls src="${escapeHtml(url)}"></video></span>`;
      return `<a class="internal-link" href="${escapeHtml(url)}">${escapeHtml(display || name)}</a>`;
    }
    // a note embed: only a published note is shown (one level deep); a private one leaves nothing behind
    const r = env.resolve ? env.resolve(name) : null;
    if (!r || !env.embedNote || (env.depth || 0) >= 1) return r ? `<a class="internal-link" href="${escapeHtml(r.url)}">${escapeHtml(display || name)}</a>` : '';
    env.links && env.links.add(r.id);
    const body = env.embedNote(r.id, env);
    return `<div class="internal-embed markdown-embed inline-embed"><div class="markdown-embed-title">${escapeHtml(r.title)}</div>` +
      `<a class="markdown-embed-link" href="${escapeHtml(r.url)}" aria-label="Open">↗</a><div class="markdown-embed-content">${body}</div></div>`;
  }

  // ---------- ==highlight==
  md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
    const src = state.src, pos = state.pos;
    if (src.slice(pos, pos + 2) !== '==') return false;
    const end = src.indexOf('==', pos + 2);
    if (end < 0 || end === pos + 2) return false;
    if (!silent) {
      state.push('mark_open', 'mark', 1);
      const old = state.posMax; state.pos = pos + 2; state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = old;
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });

  // ---------- #tags (not inside words, not pure numbers like #1)
  const TAG_RE = /^#([\p{L}\p{N}_\-/]+)/u;
  md.inline.ruler.push('tag', (state, silent) => {
    const pos = state.pos, src = state.src;
    if (src.charCodeAt(pos) !== 0x23) return false;
    if (pos > 0 && !/\s|[([{,;]/.test(src[pos - 1])) return false;
    const m = TAG_RE.exec(src.slice(pos));
    if (!m || /^\d+$/.test(m[1])) return false;
    const tag = m[1].replace(/\/+$/, '');
    if (!silent) { const t = state.push('obsidian_tag', '', 0); t.meta = { tag }; }
    state.pos = pos + 1 + m[1].length;
    return true;
  });
  md.renderer.rules.obsidian_tag = (tokens, idx, _o, env) => {
    const tag = tokens[idx].meta.tag;
    env.tags && env.tags.add(tag);
    return `<a href="${escapeHtml((env.base || '/blog') + '/tags/' + tagSlug(tag) + '/')}" class="tag">#${escapeHtml(tag)}</a>`;
  };

  // ---------- callouts:  > [!type]± Title
  md.core.ruler.after('block', 'callouts', state => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open') continue;
      const p = toks[i + 1], inl = toks[i + 2];
      if (!p || p.type !== 'paragraph_open' || !inl || inl.type !== 'inline') continue;
      const m = /^\[!([^\]\s]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/.exec(inl.content);
      if (!m) continue;
      const type = m[1].toLowerCase();
      toks[i].meta = { callout: type, fold: m[2], title: m[3].trim() };
      inl.content = inl.content.slice(m[0].length);
      if (!inl.content.trim()) { p.hidden = true; toks[i + 3].hidden = true; inl.content = ''; }
    }
  });
  const quoteStack = [];
  md.renderer.rules.blockquote_open = (tokens, idx, _o, env) => {
    const meta = tokens[idx].meta;
    quoteStack.push(meta && meta.callout ? meta : null);
    if (!meta || !meta.callout) return '<blockquote>\n';
    const type = meta.callout, color = calloutColorType(type);
    const titleText = meta.title || type.charAt(0).toUpperCase() + type.slice(1);
    const title = `<div class="callout-icon">${calloutIcon(color)}</div><div class="callout-title-inner">${md.renderInline(titleText, env)}</div>`;
    const attrs = `class="callout${meta.fold ? ' is-collapsible' : ''}" data-callout="${escapeHtml(color)}" data-callout-type="${escapeHtml(type)}"`;
    if (meta.fold) {
      return `<details ${attrs}${meta.fold === '+' ? ' open' : ''}><summary class="callout-title">${title}<div class="callout-fold">${FOLD_ICON}</div></summary><div class="callout-content">\n`;
    }
    return `<div ${attrs}><div class="callout-title">${title}</div><div class="callout-content">\n`;
  };
  md.renderer.rules.blockquote_close = () => {
    const meta = quoteStack.pop();
    if (!meta) return '</blockquote>\n';
    return meta.fold ? '</div></details>\n' : '</div></div>\n';
  };

  // ---------- task lists: - [ ] / - [x]
  md.core.ruler.push('tasks', state => {
    const toks = state.tokens;
    for (let i = 2; i < toks.length; i++) {
      const inl = toks[i];
      if (inl.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
      const m = /^\[([ xX\-/>!?])\]\s+/.exec(inl.content);
      if (!m || !inl.children.length || inl.children[0].type !== 'text') continue;
      const done = m[1] !== ' ';
      inl.children[0].content = inl.children[0].content.replace(/^\[.\]\s+/, '');
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" class="task-list-item-checkbox" disabled${done ? ' checked' : ''}> `;
      inl.children.unshift(box);
      toks[i - 2].attrJoin('class', 'task-list-item' + (done ? ' is-checked' : ''));
      toks[i - 2].attrSet('data-task', m[1]);
      // the list itself
      for (let j = i - 3; j >= 0; j--) {
        if (toks[j].type === 'bullet_list_open' || toks[j].type === 'ordered_list_open') {
          if (toks[j].level === toks[i - 2].level - 1) { if (!/contains-task-list/.test(toks[j].attrGet('class') || '')) toks[j].attrJoin('class', 'contains-task-list'); break; }
        }
      }
    }
  });

  // ---------- heading anchors (for [[note#Heading]])
  md.core.ruler.push('heading_ids', state => {
    const seen = new Map();
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'heading_open') continue;
      const text = toks[i + 1].children.filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('');
      let id = slugify(text) || 'section';
      const n = seen.get(id) || 0; seen.set(id, n + 1);
      if (n) id += '-' + n;
      toks[i].attrSet('id', id);
    }
  });

  // ---------- links and images: external links open in a new tab; relative images come from the vault
  const defaultLinkOpen = md.renderer.rules.link_open || ((t, i, o, _e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx], href = t.attrGet('href') || '';
    if (/^https?:\/\//i.test(href)) {
      t.attrJoin('class', 'external-link'); t.attrSet('target', '_blank'); t.attrSet('rel', 'noopener nofollow');
    } else if (/\.md(#.*)?$/i.test(decodeURI(href)) && env.resolve) {
      // [text](Other%20note.md): the same rule as wikilinks, so private notes stay text
      const [p, h] = decodeURI(href).split('#');
      const r = env.resolve(p.replace(/\.md$/i, ''));
      if (r) { env.links && env.links.add(r.id); t.attrSet('href', r.url + (h ? '#' + slugify(h) : '')); t.attrJoin('class', 'internal-link'); }
      else { t.attrSet('href', '#'); t.attrJoin('class', 'internal-link is-unresolved'); t.meta = { dead: true }; }
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };
  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const t = tokens[idx], src = t.attrGet('src') || '';
    if (!/^(https?:|data:|\/)/i.test(src) && env.attachment) {
      const url = env.attachment(decodeURI(src));
      if (!url) return `<span class="internal-embed is-unresolved">${escapeHtml(t.content || src)}</span>`;
      t.attrSet('src', url);
    }
    t.attrSet('loading', 'lazy');
    return defaultImage(tokens, idx, opts, env, self);
  };

  // ---------- code blocks: Obsidian wraps them and labels the language
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const lang = (tokens[idx].info || '').trim().split(/\s+/)[0];
    const html = defaultFence(tokens, idx, opts, env, self);
    return `<div class="code-block">${lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''}${html}</div>`;
  };

  md.renderer.rules.table_open = () => '<div class="table-wrapper"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  return md;
}
