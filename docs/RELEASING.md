# Releasing

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/), driven by
[Conventional Commits](https://www.conventionalcommits.org/) on `main`. Config:
`voucherboard/release.config.cjs`. semantic-release runs with `working-directory: voucherboard`
in `.github/workflows/release.yml`; the git repository root is one directory up from there, but
git commands resolve fine from a subdirectory, and every asset path in the config
(`package.json`, `manifest.json`, `CHANGELOG.md`, `dist/*.zip`) is relative to `voucherboard/`.

## How a release happens

1. Commits land on `main`, directly or by merging a pull request (see `CONTRIBUTING.md`).
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
5. If a release was published, `.github/workflows/release.yml`'s `chrome-web-store` job waits
   for the owner's approval, then uploads it to the Chrome Web Store (see below).

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

## Chrome Web Store publishing

`.github/workflows/release.yml`'s `chrome-web-store` job uploads the release to the Chrome Web
Store with the [v2 API](https://developer.chrome.com/docs/webstore/using-api) and submits it for
review. It runs in the `chrome-web-store` environment, so it waits for the owner's approval.

1. Downloads the `release-zip` artifact the `release` job built and tested.
2. If `CWS_VERIFIED_CRX` is `true`, unzips the store zip and signs it with Chrome
   (`--pack-extension` under `xvfb-run`) using the `CWS_CRX_KEY` secret. The key is written to
   `$RUNNER_TEMP` and deleted when the step ends.
3. Exchanges GitHub's OIDC token for a short-lived Google access token as the publisher's service
   account (Workload Identity Federation, `google-github-actions/auth`). No Google credential is
   stored in GitHub.
4. `POST upload/v2/publishers/<id>/items/<id>:upload` with the CRX (or the zip), then polls
   `:fetchStatus` while the upload is `IN_PROGRESS`, then `POST …:publish`.

If any of the four variables is missing, the job posts a `::notice::` and skips cleanly.

### Google Cloud

1. Create a dedicated project, enable the **Chrome Web Store API**, and create a service account
   (e.g. `cws-publisher`). Give it **no** IAM roles and **no** JSON key: Chrome Web Store access
   isn't IAM-controlled.
2. Developer Dashboard → **Account**: add the service account's email. This grants it API
   access to every item under the publisher (one service account per publisher).
3. Workload Identity Federation, limited to this repo's `chrome-web-store` environment:

   ```sh
   gcloud iam workload-identity-pools create github --location=global
   gcloud iam workload-identity-pools providers create-oidc github \
     --location=global --workload-identity-pool=github \
     --issuer-uri=https://token.actions.githubusercontent.com \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
     --attribute-condition="assertion.sub=='repo:maubergine/voucherboard:environment:chrome-web-store'"
   gcloud iam service-accounts add-iam-policy-binding cws-publisher@<project-id>.iam.gserviceaccount.com \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/github/attribute.repository/maubergine/voucherboard"
   ```

### The `chrome-web-store` environment

`Settings → Environments → chrome-web-store`:

- Required reviewers: the owner. Prevent self-review: off. Allow administrators to bypass: off.
- Deployment branches: `main` only.

| Name | Kind | Value |
| --- | --- | --- |
| `CWS_PUBLISHER_ID` | variable | Developer Dashboard → Account |
| `CWS_EXTENSION_ID` | variable | `cldhejnblckejbeebjidikhebdfnncak` |
| `GCP_WIF_PROVIDER` | variable | `projects/<project-number>/locations/global/workloadIdentityPools/github/providers/github` |
| `CWS_SERVICE_ACCOUNT` | variable | `cws-publisher@<project-id>.iam.gserviceaccount.com` |
| `CWS_VERIFIED_CRX` | variable | `true` once opted in to Verified CRX uploads; unset or `false` uploads the zip |
| `CWS_CRX_KEY` | secret | The CRX signing key's PEM, needed only when `CWS_VERIFIED_CRX` is `true` |

## Verified CRX uploads

With [Verified CRX uploads](https://developer.chrome.com/docs/webstore/update) on, the store
accepts only packages signed with the owner's key, so a compromised Google account or API token
can't ship code on its own.

- **Key:** a dedicated RSA-2048 key, separate from the manifest's `key` (that's Google's public
  key). Kept in the owner's password manager with an offline backup, and in the `CWS_CRX_KEY`
  secret. Never in git (`.gitignore` covers `*.pem` and `*.crx`), never in a Google account.
  Losing it blocks releases until CWS support resets it (up to a week).

  ```sh
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out cws-signing.pem
  openssl rsa -in cws-signing.pem -pubout   # the public key for the dashboard
  ```

- **Checking a CRX:** Chrome refuses to install a CRX the store hasn't signed
  (`CRX_REQUIRED_PROOF_MISSING`), so test the code with Load unpacked, and the signature by
  uploading the CRX in the dashboard (it only makes a draft).
- **Turning it on:**
  1. Release once with `CWS_VERIFIED_CRX` unset, to prove the v2 upload and publish work.
  2. Dashboard → **Package → Verified CRX Uploads → Opt in**, with the public key.
  3. Set `CWS_VERIFIED_CRX` to `true`. From then on, manual dashboard uploads must be signed CRXs
     too.

## Manual repo settings the owner must apply (public repo)

These aren't (and can't be) set from a workflow file — apply them once in the GitHub UI after
making the repo public:

- **Actions → General**
  - "Fork pull request workflows" → require approval for all external contributors, so no
    outside code runs in CI until the owner has looked at it.
  - "Workflow permissions" → default to read-only (`GITHUB_TOKEN` read-only unless a workflow
    explicitly asks for more, as ours do per-job).
  - Disallow GitHub Actions from creating or approving pull requests.
- **Rulesets → New ruleset, target `main`**
  - Restrict updates and deletions of the branch.
  - Block force pushes.
  - Require the CI status check (`CI / test`) to pass before merging.
  - Bypass list: the owner and the `voucherboard-release` app only.
- **Collaborators and teams** — none added; the owner (`@maubergine`) is the sole maintainer, so
  only the owner can change `.github/workflows`. Fork PR runs (`pull_request`) need approval and
  get a read-only token with no secrets; no workflow uses `pull_request_target`. A merged PR runs
  with `main`'s secrets in the next release, so review changes to `.github/`, `package.json`,
  `release.config.cjs`, `scripts/` and `manifest.json` line by line, and squash-merge so the
  commit message (which sets the version bump) is the owner's.
- **Features** — disable the Wiki and Projects tabs if unused.
- **Code security**
  - Enable private vulnerability reporting (`Settings → Code security`).
  - Enable secret scanning and push protection.
- **Pull Requests** (`Settings → General → Pull Requests`) — allow squash merging, so outside
  contributions land as one commit with a message the owner writes.
