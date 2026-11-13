# Releasing the engine

Updated 2026-11-13. This repo is the public build tool. It has no GitHub Actions workflow of its own and is never
deployed anywhere by itself: a **content repo** checks it out during that repo's build
(`templates/github/site-build.yml`, step "Engine (public)") and runs its tests there. So "releasing" the engine
means: the commit is on GitHub, where content repos fetch it.

```
this repo (GitHub, branch main, or the tag/commit a content repo names in its ENGINE_REF variable)
   └─ checked out by the content repo's workflow ─ npm ci ─ npm test ─ node build.mjs ─▶ that repo's dist
```

## The rule: push the engine before the content

When a change needs both (a new option in the engine, and a content repo that sets it), push **this repo to GitHub
first**, then the content repo. The content repo's build takes the engine from GitHub at build time. If the content
arrives first, it is built with the old engine, which ignores options it does not know: nothing fails, the site
just comes out with the old behaviour. (Example, 2026-11-13: the options `indexStyle`, `theme`, `tags` and `feed`
are in commit `a9f66ec`; a content repo that sets them needs that commit or a later one on GitHub.)

The same holds for the vault: the content repo's build also takes the vault from GitHub.

## Checklist

1. `npm test` (the suite includes a fixture vault of private notes that must not appear in the output).
2. Try a build: `node build.mjs --content examples/content --vault test/fixtures/vault --out /tmp/engine-try`.
3. Update `README.md` ("Use", the options table) and `docs/blog.md` when an option or a rule changed.
4. Commit and push. The maintainer's backup remote is `forgejo`; GitHub (`origin`) is the one content repos read.
5. Then rebuild the content repo: push it, or start its workflow by hand (Actions -> Build site -> Run workflow, or
   `gh workflow run site-build.yml -R OWNER/CONTENT-REPO`). A push here does **not** rebuild any site by itself.

## Gates

There is no gate in this repo. The gates run in the content repo's workflow, and the first of them is this repo's
own `npm test`: if the engine's tests fail there, that site is not built and nothing is deployed.

## Pinning (a content repo's protection against a bad engine change)

A content repo may set its repository variable `ENGINE_REF` to a tag or commit id of this repo. Its builds then
keep using that version until the variable is changed. Without it, every build uses the newest `main`.
There are no tags in this repo yet (2026-11-13), so today a pin would be a commit id.

## Rollback

`git revert <commit>` and push; then rebuild the content repo. Or set the content repo's `ENGINE_REF` to the last
good commit id and rebuild.

## The workflow template and AWS

`templates/github/site-build.yml` is copied into a content repo; changing it here changes nothing until it is
copied again. Its deploy job needs an AWS role that the content repo creates (this repo ships no AWS code); the
role's trust must match `repo:OWNER/CONTENT-REPO:ref:refs/heads/main`, which is why the deploy job names no GitHub
`environment` (details in [blog.md](blog.md), "One-time setup").

The maintainer's overview of the whole pipeline across his sites is a note outside this repo
(`~/Library/Knowledge/Context/tools/release-pipeline.md` on his Mac).
