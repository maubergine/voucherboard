# Releasing

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) on `main`. Config:
`voucherboard/release.config.cjs`. semantic-release runs with `working-directory: voucherboard`
in `.github/workflows/release.yml`; the git repository root is one directory up from there, but
git commands resolve fine from a subdirectory, and every asset path in the config
(`package.json`, `manifest.json`, `CHANGELOG.md`, `dist/*.zip`) is relative to `voucherboard/`.

## How a release happens

1. Commits land on `main` (directly, or via a merge — though this repo currently doesn't accept
   PRs from anyone but the owner; see `CONTRIBUTING.md`).
2. `.github/workflows/release.yml` runs on push to `main` (or manually via
   `workflow_dispatch`), only when `github.repository == 'maubergine/voucherboard'`,
   `github.ref == 'refs/heads/main'`, and `github.actor == github.repository_owner`.
3. Tests run first (`npm ci`, `npm run validate-manifest`, `npm test`). If they fail, nothing is
   released.
4. `npx semantic-release` (in `voucherboard/`):
   - Analyses commit messages since the last release tag to decide whether to release, and
     whether it's a patch, minor or major bump.
   - Generates release notes and updates `voucherboard/CHANGELOG.md`.
   - Bumps `voucherboard/package.json` (and the lockfile) — `npmPublish` is `false`, so nothing
     is published to npm; this only bumps the version field.
   - Runs `node scripts/set-manifest-version.mjs <version>`, which sets `manifest.json`'s
     `version` and `version_name` (`"<version> beta"` — see below), then `npm run package` to
     rebuild `dist/voucherboard-<version>.zip` (manifest at the root, for the Chrome Web Store) and
     `dist/voucherboard-<version>-unpacked.zip` (a `voucherboard/` folder, for Load unpacked).
   - Commits `package.json`, `package-lock.json`, `manifest.json` and `CHANGELOG.md` with
     `chore(release): <version> [skip ci]`, and tags `v<version>`.
   - Creates a GitHub Release with both zips attached.
5. If a release was published, `.github/workflows/release.yml`'s `chrome-web-store` job uploads
   the zip to the Chrome Web Store (see below).

## Commit types → version bump

Commit-analyzer uses the Angular preset (semantic-release's default):

| Commit prefix | Bump |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| any type with a `BREAKING CHANGE:` footer, or `!` after the type (`feat!:`) | major |
| `docs:`, `chore:`, `refactor:`, `style:`, `test:`, `ci:`, `build:`, `perf:` | no release by default (`perf:` bumps patch) |

Commit messages are linted by `.github/workflows/commitlint.yml`
(`@commitlint/config-conventional`) on every push and pull request, so a malformed type won't
silently fail to release — it fails CI instead. There's deliberately no local commit-msg hook;
linting is CI-only, plus `npm run commitlint` if you want to check locally.

## `version_name` while in beta

`manifest.json`'s `version_name` is set to `"<version> beta"` by
`voucherboard/scripts/set-manifest-version.mjs` for as long as the extension is pre-1.0. When
Voucherboard comes out of beta, edit that script to drop the `" beta"` suffix (e.g. only append
it when `version.startsWith("0.")`, or remove it outright) as part of the release that ships
1.0.0.

## First release: continuing from 0.1.0

`voucherboard/package.json` and `manifest.json` already say `0.1.0` — that version was shipped
without semantic-release. Before the release workflow runs for the first time, the repo owner
must tag that commit on `main` so semantic-release treats it as the release history's starting
point, rather than releasing `1.0.0` from scratch:

```sh
git checkout main
git pull
git tag v0.1.0 <sha-of-the-0.1.0-commit>
git push origin v0.1.0
```

After that, the next release will be computed from commits after `v0.1.0` (e.g. the first
`fix:` produces `v0.1.1`, the first `feat:` produces `v0.2.0`).

## Setting up the release app and `release` environment

The release job pushes the `chore(release)` commit and the tag to `main`. The default
`GITHUB_TOKEN` can't bypass the `main` ruleset, so the job uses a GitHub App owned by you:

1. `Settings → Developer settings → GitHub Apps → New GitHub App` on your account. Name it
   `voucherboard-release`, untick Webhook, set repository permissions Contents, Issues and Pull
   requests to Read and write, and "Only on this account". Create it.
2. Note its Client ID. Generate a private key (downloads a `.pem`).
3. Install the app on `maubergine/voucherboard` only.
4. `Settings → Environments → New environment` named `release`. Under "Deployment branches and
   tags" choose "Selected branches" and add `main`. Add variable `RELEASE_APP_CLIENT_ID` (the
   Client ID) and secret `RELEASE_APP_PRIVATE_KEY` (the whole `.pem`). Delete the downloaded file.
5. Add the app to the `main` ruleset's bypass list.

Only a workflow running on `main` can read the key, and only you can change `main`.

## Setting up the `chrome-web-store` environment and secrets

The Chrome Web Store publish job runs in a GitHub environment called `chrome-web-store`
(`Settings → Environments → New environment`). Add the repo owner as a required reviewer on
that environment, so every Chrome Web Store publish needs manual approval in the Actions UI.

Add these environment secrets (`Settings → Environments → chrome-web-store → Add secret`):

| Secret | What it is |
| --- | --- |
| `CWS_EXTENSION_ID` | The extension's ID on the Chrome Web Store (from the Developer Dashboard URL). |
| `CWS_CLIENT_ID` | OAuth 2.0 client ID for a Google Cloud project with the Chrome Web Store API enabled. |
| `CWS_CLIENT_SECRET` | That client's secret. |
| `CWS_REFRESH_TOKEN` | A refresh token for that client, authorised for the Chrome Web Store account that owns the extension. |

To get the OAuth client and refresh token:

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project,
   enable the "Chrome Web Store API", and create an OAuth 2.0 Client ID (application type
   "Desktop app" works well for this).
2. Follow Google's
   [Chrome Web Store API authentication guide](https://developer.chrome.com/docs/webstore/using-api)
   to run the one-time OAuth flow (authorise as the Google account that owns the extension in
   the Developer Dashboard) and exchange the authorisation code for a refresh token.
3. Store the client ID, client secret and refresh token as the secrets above. The refresh token
   doesn't expire under normal use, but can be revoked from the Google account's security
   settings — if publishing starts failing with an auth error, generate a new one.

If any of the four secrets is missing, the `chrome-web-store` job posts a `::notice::` and skips
the publish steps cleanly (the job doesn't fail) — see the "Check Chrome Web Store secrets are
configured" step in `.github/workflows/release.yml`.

## Verified uploads (signed CRX) — optional, not set up here

The Chrome Web Store API upload above ships an unsigned `.zip`, which is what the Store expects
for normal (non-enterprise) listings. This repo's `.pem` (the extension's private signing key)
is never used in CI and must stay out of git (`.gitignore` covers `*.pem`).

If "verified uploads" / a self-signed `.crx` is ever needed (e.g. for enterprise policy
deployment outside the Store), that would be a separate, clearly-labelled optional workflow
step that reads the key from a GitHub Actions environment secret (never committed), runs
`chrome`'s `--pack-extension`/`--pack-extension-key` (or an equivalent packer) to produce a
signed `.crx`, and uploads that as a release asset alongside the zip. That step doesn't exist
today — add it deliberately, and audit who can trigger the workflow, before ever putting the
key in CI.

## Manual repo settings the owner must apply (public repo)

These aren't (and can't be) set from a workflow file — apply them once in the GitHub UI after
making the repo public:

- **Actions → General**
  - "Fork pull request workflows" → require approval for all external contributors (or "for
    first-time contributors", but "all" is safer for a repo with no accepted PRs).
  - "Workflow permissions" → default to read-only (`GITHUB_TOKEN` read-only unless a workflow
    explicitly asks for more, as ours do per-job).
  - Disallow GitHub Actions from creating or approving pull requests.
- **Rulesets → New ruleset, target `main`**
  - Restrict updates and deletions of the branch.
  - Block force pushes.
  - Require the CI status check (`CI / test`) to pass before merging.
  - Bypass list: the owner and the `voucherboard-release` app only.
- **Collaborators and teams** — none added; the owner (`@maubergine`) is the sole maintainer, so
  only the owner can change `.github/workflows`. Fork PRs can't change the workflows that run:
  `pull_request_target` always uses `main`'s copy, and `pull_request` runs from forks need approval
  and get a read-only token with no secrets.
- **Features** — disable the Wiki and Projects tabs if unused.
- **Code security**
  - Enable private vulnerability reporting (`Settings → Code security`).
  - Enable secret scanning and push protection.
- **Pull Requests** (`Settings → General → Pull Requests`) — check for any option to restrict or
  disable pull requests entirely; GitHub doesn't currently offer a hard "no PRs" toggle for
  public repos, which is why `.github/workflows/close-external-prs.yml` exists as the
  enforcement mechanism. As a temporary fallback (e.g. while first setting the repo up), an
  interaction limit (`Settings → General → Interaction limits`) can restrict who can open PRs
  *and* issues for a set period — note it restricts both, so don't leave it on if issues should
  stay open to everyone.
