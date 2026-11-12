/**
 * @file markdown.mjs
 * Markdown with Obsidian's extensions: [[wikilinks]], ![[embeds]], #tags, callouts, task lists, ==highlights==,
 * %%comments%% and heading anchors. Everything that points at another note goes through `env.resolve`, so only
 * published notes ever become links (see lib/blog.mjs).
 *
 * Project: site-engine
 * @author Claude (Anthropic), written for and prompted by William Munnich
 * @date Last edited 2026-11-12
 */
import MarkdownIt from 'markdown-it';
import { escapeHtml, slugify, tagSlug } from './util.mjs';
import { calloutIcon, calloutColorType, FOLD_ICON } from './icons.mjs';

/** File endings that are embedded as images. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

/**
 * Removes Obsidian %%comments%% from note text before it is rendered.
 * @param {string} src - The note's Markdown.
 * @returns {string} The Markdown without comments.
 */
export function stripComments(src) {
  // %%…%% comments (inline or across lines) are never published, like in Obsidian's reading view
  return src.replace(/%%[\s\S]*?%%/g, '');
}

/**
 * Creates the markdown-it renderer with the Obsidian rules added. The render `env` may carry
 * resolve(name), attachment(name), embedNote(id, env), base, depth, and the `links` and `tags` sets
 * that rendering fills in.
 * @param {Object} [o] - Options.
 * @param {boolean} [o.allowHtml] - Lets raw HTML in notes through instead of escaping it.
 * @returns {MarkdownIt} The configured renderer.
 */
export function createMarkdown({ allowHtml = false } = {}) {
  const md = new MarkdownIt({ html: allowHtml, linkify: true, typographer: false, breaks: false });

  // ---------- [[wikilinks]] and ![[embeds]]
  /** Inline rule: recognises [[target]] and ![[target]] on one line and emits a `wikilink` token. */
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
  /**
   * Renders a wikilink token. Splits "target#heading|display", hands embeds to renderEmbed, links to
   * published notes, and leaves private or missing targets as plain text.
   * @param {Object[]} tokens - The token list.
   * @param {number} idx - Index of the wikilink token.
   * @param {Object} _o - markdown-it options (unused).
   * @param {Object} env - The render environment.
   * @returns {string} HTML for the link, the embed, or the unresolved text.
   */
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

  /**
   * Renders ![[name]]: an image, audio, video or file link for attachments, or the body of a published note.
   * @param {string} name - The embedded file or note name.
   * @param {string} heading - The part after "#" (not used for the output).
   * @param {string} display - The part after "|": image size ("300" or "300x200"), alt text, or link text.
   * @param {Object} env - The render environment.
   * @returns {string} HTML for the embed; an empty string for a private or missing note.
   */
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
  /** Inline rule: wraps ==text== in <mark> and renders the text inside it as inline Markdown. */
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
  /** Matches a tag at the start of the remaining text: "#" followed by letters, digits, "_", "-" or "/". */
  const TAG_RE = /^#([\p{L}\p{N}_\-/]+)/u;
  /** Inline rule: recognises a #tag after white space or an opening bracket and emits an `obsidian_tag` token. */
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
  /**
   * Renders a tag as a link to its tag page and records it in env.tags.
   * @param {Object[]} tokens - The token list.
   * @param {number} idx - Index of the tag token.
   * @param {Object} _o - markdown-it options (unused).
   * @param {Object} env - The render environment.
   * @returns {string} The tag link HTML.
   */
  md.renderer.rules.obsidian_tag = (tokens, idx, _o, env) => {
    const tag = tokens[idx].meta.tag;
    env.tags && env.tags.add(tag);
    return `<a href="${escapeHtml((env.base || '/blog') + '/tags/' + tagSlug(tag) + '/')}" class="tag">#${escapeHtml(tag)}</a>`;
  };

  // ---------- callouts:  > [!type]± Title
  /** Core rule: marks a blockquote whose first line is "[!type]" as a callout and removes that marker line from its text. */
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
  /** Open blockquotes, innermost last: the callout's meta, or null for a plain quote, so the closing tag matches. */
  const quoteStack = [];
  /**
   * Opens a plain blockquote, a callout box, or a foldable callout (<details>).
   * @param {Object[]} tokens - The token list.
   * @param {number} idx - Index of the blockquote_open token.
   * @param {Object} _o - markdown-it options (unused).
   * @param {Object} env - The render environment, used to render the callout title.
   * @returns {string} The opening HTML.
   */
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
  /**
   * Closes whatever blockquote_open opened last.
   * @returns {string} The closing HTML.
   */
  md.renderer.rules.blockquote_close = () => {
    const meta = quoteStack.pop();
    if (!meta) return '</blockquote>\n';
    return meta.fold ? '</div></details>\n' : '</div></div>\n';
  };

  // ---------- task lists: - [ ] / - [x]
  /** Core rule: turns "- [ ]" and "- [x]" list items into disabled checkboxes and classes the item and its list. */
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
  /** Core rule: gives every heading an id from its text; repeats get "-1", "-2" and so on. */
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
  /** The renderer's own link_open rule, or a plain token render when it has none. */
  const defaultLinkOpen = md.renderer.rules.link_open || ((t, i, o, _e, s) => s.renderToken(t, i, o));
  /**
   * Opens a link: external links get a new-tab target, links to .md files follow the wikilink rule.
   * @param {Object[]} tokens - The token list.
   * @param {number} idx - Index of the link_open token.
   * @param {Object} opts - markdown-it options.
   * @param {Object} env - The render environment.
   * @param {Object} self - The renderer.
   * @returns {string} The opening <a> tag.
   */
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
  /**
   * Renders an image; a relative source is looked up in the vault and copied through env.attachment.
   * @param {Object[]} tokens - The token list.
   * @param {number} idx - Index of the image token.
   * @param {Object} opts - markdown-it options.
   * @param {Object} env - The render environment.
   * @param {Object} self - The renderer.
   * @returns {string} The <img> tag, or unresolved text when the file is not in the vault.
   */
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
  /**
   * Wraps a fenced code block in a div and labels its language.
   * @param {Object[]} tokens - The token list.
   * @param {number} idx - Index of the fence token.
   * @param {Object} opts - markdown-it options.
   * @param {Object} env - The render environment.
   * @param {Object} self - The renderer.
   * @returns {string} The wrapped code block HTML.
   */
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const lang = (tokens[idx].info || '').trim().split(/\s+/)[0];
    const html = defaultFence(tokens, idx, opts, env, self);
    return `<div class="code-block">${lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : ''}${html}</div>`;
  };

  /** Tables are wrapped in a div so wide ones can scroll. */
  md.renderer.rules.table_open = () => '<div class="table-wrapper"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  return md;
}
