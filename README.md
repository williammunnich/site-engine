# site-engine

A small static-site builder for a personal site. It copies a content folder as is, and turns an
[Obsidian](https://obsidian.md) vault into a blog that looks like Obsidian's default reading view, in light and dark.

| Light | Dark | Phone |
|---|---|---|
| <img src="docs/screenshots/blog-post-light.png" width="300" alt="A post in the light theme"> | <img src="docs/screenshots/blog-post-dark.png" width="300" alt="The same post in the dark theme"> | <img src="docs/screenshots/blog-post-mobile.png" width="150" alt="The post on a phone"> |

The site's own content (pages, images, settings) lives in a separate, private repo. The vault is a third repo.
This repo holds only the engine, so it can be public.

```
content repo (private)          vault repo (private)            site-engine (this repo, public)
  site/        -> copied as is    posts/, daily/, attachments/    build.mjs
  blog.config.json                 notes with publish: true        lib/ (markdown, blog, templates)
                                                                   blog/theme/ (obsidian.css, theme.js)
                        \                  |                      /
                         `--- node build.mjs --content … --vault … --out dist ---> dist/ (S3 + CloudFront)
```

## Use

Needs Node 20 or later.

```sh
npm ci
npm test
node build.mjs --content <content-dir> --vault <vault-dir> --out dist --site-url https://example.com
```

- `<content-dir>/site/**` is copied to `dist/` unchanged.
- With `--vault`, published notes become `dist/blog/`: an index (newest first), one page per post at
  `/blog/<slug>/`, tag pages at `/blog/tags/<tag>/`, an Atom feed at `/blog/feed.xml`, and the blog's URLs are
  added to `dist/sitemap.xml` if the content has one. Pages use folder URLs (`/blog/<slug>/index.html`).
- `<content-dir>/blog.config.json` sets `title`, `description`, `siteName` (shown in the header breadcrumb),
  `homeUrl`, `base` (default `/blog`), `siteUrl` and `allowHtml` (default false). `--blog-title` and
  `--blog-description` override it.

Try it with the bundled example: `npm run build:example`, then `cd examples/dist && python3 -m http.server 8000`
and open http://localhost:8000/blog/. Add `?theme=dark` or `?theme=light` to a blog URL to preview a theme.

## Blog rules

A note is published only if it is in `posts/` or its properties say `publish: true`, and never if they say
`publish: false` or `draft: true`. `templates/`, `.obsidian/`, `.trash/` and other dot-folders are never read.

Everything that points at another note is resolved against the published notes only:

| In the note | Published target | Private or missing target |
|---|---|---|
| `[[Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` | link to `/blog/<slug>/#heading` | plain text |
| `[text](Note.md)` | link | text, no link |
| `![[Note]]` | the note, embedded (one level) | nothing |
| `![[image.png]]`, `![[image.png|300]]`, `![](attachments/x.png)` | image, copied to `/blog/assets/` with a content hash | "missing" text |
| backlinks ("Linked mentions") | listed | never listed |

Attachments are copied only when a published note uses them. `%%comments%%` are removed. Raw HTML in a note is
escaped unless `allowHtml` is on.

The slug is the `slug` property or the file name (`My Post.md` → `my-post`). The date is the `date` property,
or a daily-note file name (`YYYY-MM-DD` or `MM-DD-YYYY`), or the file's modified time.

## The Obsidian look

`blog/theme/obsidian.css` is written from scratch for this project. It uses the default theme's variable values
(base colors, accent `hsl(258 88% 66%)`, heading scale, 700px line width, the system font stack) and the same class
names Obsidian uses for the reading view, so most Obsidian CSS snippets apply too. It covers headings, lists, task
lists, tables, code blocks, quotes, highlights, tags (also nested `#a/b`), callouts (every standard type and alias,
`-`/`+` folding with no JavaScript), the Properties block, embeds and "Linked mentions". The callout icons are
[Lucide](https://lucide.dev) icons (ISC license), the set Obsidian uses. Light and dark follow the system; the
header button switches and remembers the choice in `localStorage` (`theme.js`). No fonts or scripts load from
other sites.

Not supported yet: Mermaid, math, Dataview, block references (`^id`), canvas files and a graph view.

## Automatic rebuilds

`templates/github/site-build.yml` is a GitHub Actions workflow for the content repo. It checks out the content repo,
this engine and the vault (with a read-only deploy key), runs the tests, builds, and uploads `dist` as an artifact.
Its deploy job (S3 sync and CloudFront invalidation through an OIDC role) runs only when the repo variable
`DEPLOY_ENABLED` is `true`. The vault triggers it with a `repository_dispatch` event called `devlog-updated`.
Setup steps are in [docs/blog.md](docs/blog.md).

## Files

| Path | What it is |
|---|---|
| `build.mjs` | Command line entry point: copies the content, builds the blog, updates the sitemap |
| `lib/blog.mjs` | Reads the vault, applies the publish rule, resolves links, writes pages, tags, feed, assets |
| `lib/markdown.mjs` | markdown-it with Obsidian syntax: wikilinks, embeds, tags, callouts, tasks, highlights, comments |
| `lib/templates.mjs` | Page HTML: header, inline title, Properties, note, Linked mentions; index, tag pages, Atom feed |
| `lib/icons.mjs` | Lucide icons for callouts |
| `blog/theme/` | `obsidian.css` and `theme.js`, copied into `dist/blog/` |
| `test/` | `node --test` suite and a fixture vault full of private notes that must not leak |
| `examples/content/` | A tiny content folder for trying the build |
| `templates/github/site-build.yml` | The build-and-deploy workflow for the content repo |
| `tools/make-png.py` | Writes small solid PNGs for fixtures, with no dependencies |

## License

[MIT](LICENSE)
