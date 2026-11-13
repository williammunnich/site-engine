# Publishing a blog post

The blog is an Obsidian vault in its own private git repo. The site build reads it and publishes only the notes
you mark. This page is the how-to; the rules themselves are in the [README](../README.md#blog-rules).

## Write

1. Open the vault in Obsidian (*Open folder as vault*).
2. Write or paste the day's notes into `daily/YYYY-MM-DD.md`. New daily notes start with `publish: false`,
   so nothing goes public by accident.
3. Paste images straight in. Obsidian saves them to `attachments/` and writes `![[image.png]]`.
   `![[image.png|300]]` sets the width.

## Publish

Either turn on the `publish` property of the note, or move the note into `posts/`. Then add, if you like:

| Property | Used for |
|---|---|
| `title` | The page title (default: the file name) |
| `date` | Sorting and the date shown (default: from a daily-note file name, else the file date) |
| `tags` | Tag pills and `/blog/tags/<tag>/` pages; `#inline-tags` in the text count too |
| `description` | The summary on the index page and in the feed (default: the first 220 characters) |
| `slug` | The URL: `/blog/<slug>/` (default: the file name) |

To take a post down, set `publish: false` (or `draft: true`), or move it out of `posts/`, and push again.

Check before pushing:

```sh
node build.mjs --content examples/content --vault <vault> --out /tmp/blog-preview
cd /tmp/blog-preview && python3 -m http.server 8000      # http://localhost:8000/blog/
```

## Push

```sh
cd <vault>
git add -A && git commit -m "Post: <title>" && git push
```

The vault's `notify-site` workflow sends `devlog-updated` to the content repo, whose `site-build` workflow rebuilds
the site. Until deploys are switched on, the build result is a downloadable `dist` artifact on the workflow run.

## One-time setup

All three are done once, with the GitHub CLI signed in to the account that owns the repos. Replace the repo names
with yours.

**1. Let the site build read the vault (read-only deploy key).**

```sh
ssh-keygen -t ed25519 -N "" -C "site build reads vault" -f /tmp/vault_deploy_key
gh repo deploy-key add /tmp/vault_deploy_key.pub -R OWNER/VAULT-REPO --title "site build (read-only)"
gh secret set DEVLOG_DEPLOY_KEY -R OWNER/CONTENT-REPO < /tmp/vault_deploy_key
rm /tmp/vault_deploy_key /tmp/vault_deploy_key.pub
```

**2. Let a vault push trigger the build.** Create a fine-grained personal access token (GitHub → Settings →
Developer settings → Fine-grained tokens) with access to the content repo only and the permission
*Contents: Read and write*, then:

```sh
gh secret set SITE_DISPATCH_TOKEN -R OWNER/VAULT-REPO     # paste the token
```

**3. Install the build workflow in the content repo** by copying `templates/github/site-build.yml` to
`.github/workflows/site-build.yml` there, and set `VAULT_REPO` and `SITE_URL` (and, to pin the engine, `ENGINE_REF`):

```sh
gh variable set VAULT_REPO -R OWNER/CONTENT-REPO --body OWNER/VAULT-REPO
gh variable set SITE_URL -R OWNER/CONTENT-REPO --body https://example.com
```

**Deploying** needs an IAM role that trusts GitHub's OIDC provider for the content repo's `main` branch, with
permission to sync the site bucket and invalidate the distribution. Set `AWS_ROLE_ARN`, `SITE_BUCKET`, `DIST_ID`,
then `DEPLOY_ENABLED=true`. Until then nothing is deployed.

The role's trust policy must allow exactly the subject `repo:OWNER/CONTENT-REPO:ref:refs/heads/main` (and the
audience `sts.amazonaws.com`). That is the subject GitHub sends because the template's deploy job names no GitHub
`environment`; do not add one, or the subject changes to `repo:OWNER/CONTENT-REPO:environment:NAME` and a
branch-locked role refuses the run. This engine ships no AWS code: the role is made in the content repo (for
williammunnich.com: `bash aws/setup.sh oidc` there). When the engine and the content both changed, push the engine
first: see [release.md](release.md).
