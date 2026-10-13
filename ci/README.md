# Local CI

`ci/local.sh` runs the GitHub workflows themselves with [act](https://github.com/nektos/act): the Ubuntu jobs in
Docker, the unsigned Xcode builds on this Mac. It runs only workflows that sign, upload and publish nothing.

Needs act (`brew install act`), Docker, and for `safari` and `ios`, macOS with Xcode 27 or later (`VB_XCODE`, default
`/Applications/Xcode.app`; your `xcode-select` setting isn't changed).

```sh
ci/local.sh                  # commitlint.yml and ci.yml, as a pull request into origin/main: about 80 s
ci/local.sh all              # adds the site build, the release dry run, and safari.yml and ios.yml on a Mac
ci/local.sh stores           # which stores a release would offer (read-only, uses `gh auth token`)
ci/local.sh --help
```

| Job | Runs | Notes |
| --- | --- | --- |
| `commitlint` | `commitlint.yml` | Commits since `--base` (default `origin/main`). Skipped when there are none. |
| `ci` | `ci.yml` | The zips and `SHA256SUMS` are copied to `dist/local-ci/`. |
| `site` | `pages.yml` build job | Builds the website; the deploy job never runs locally. |
| `safari` | `safari.yml` | On this Mac (act's `-self-hosted`). |
| `ios` | `ios.yml` | On this Mac. |
| `release` | semantic-release `--dry-run` | Not a workflow: a throwaway clone, no token, only the commit analyser and notes generator. Shows the next version. |
| `stores` | `store-changes.mjs` | Not a workflow: reads deployments and release assets. |

The Ubuntu jobs run as `linux/amd64`, like GitHub's runners, also on Apple silicon (emulated, so slower).
`VB_ARCH=linux/arm64` runs them natively. Act runs the working tree, uncommitted changes included. The Ubuntu image is pinned by digest in `ci/local.sh` and
`.actrc` (for running `act` directly). `.actrc` has no mapping for the `xcode-27` runner, so a bare `act` run skips
`safari.yml` and `ios.yml` ("Skipping unsupported platform"); `ci/local.sh` maps it to this Mac, and skips them
off macOS.

## Workflow changes for act

- `ci.yml` and `pages.yml` skip their artifact uploads under act (act's artifact server can't take v7) and copies the zips to `/vb-out`
  instead, which `ci/local.sh` mounts.
- `.github/actions/setup-xcode` selects Xcode with `xcode-select` on GitHub, and only sets `DEVELOPER_DIR` under act.

## What can't run locally

| Workflow | Step | Needs |
| --- | --- | --- |
| `release.yml` | semantic-release publish (tag, release commit, GitHub release) | `release` environment: GitHub App key |
| `chrome-release.yml` | Chrome Web Store CRX signing and draft upload | `chrome-web-store` environment |
| `firefox-release.yml` | addons.mozilla.org validation | `firefox-amo` environment: AMO JWT |
| `ios-release.yml`, `testflight.yml` | sign, archive, upload to TestFlight | `app-store` environment |
| `safari-release.yml` | Developer ID signing, notarisation, attach to the release | `safari` environment |
| `pages.yml` | deploy the website | `github-pages` environment |

`ci/local.sh` never runs these. Under a bare `act push`, `release.yml` runs only its test job: the release job
requires the repository owner as actor, and every upload depends on it.
