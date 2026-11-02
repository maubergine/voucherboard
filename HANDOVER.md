# Handover: per-platform releases (PR #67)

Delete this file before merging.

## Goal

Each platform (Chrome, Firefox, Safari, iOS) gets its own version, moved only by changes that touch it. One repo. Shared changes still release everywhere. iOS test builds go to TestFlight without a version bump.

## Where it's got to

- PR https://github.com/maubergine/voucherboard/pull/67, branch `ci/per-platform-releases`. Open, not merged. No repo settings changed.
- One commit, `build:` (not `feat`/`fix`, so merging releases nothing), including this file.
- `npm test`: 282 pass, 0 fail (re-run 2 Nov 2026). CI: test, commitlint, CodeQL, Simulator and macOS builds pass.
- Read-only release-please dry run (`npm run release:dry-run`) bootstrapped from f3dc7ef, opened nothing.
- iOS 0.13.2 reached App Store Connect (2 Nov 2026), so all four platforms are in sync at 0.13.2.
- Not exercised: signing, store uploads, the automatic TestFlight flow. The first iOS change after merge is its first live run.

## Owner decisions

1. All four seeded at 0.13.2. iOS 0.13.2 uploaded from `v0.13.2` by the old `release.yml` (`force=ios`), confirmed 2 Nov 2026, so no `release-as`. iOS package is `apps/mobile/ios` (shared: `apps/mobile/www`, `council`), leaving `apps/mobile/android` for its own package.
2. Chrome/Firefox/Safari test builds: CI run artefacts only. No trusted-testers item.
3. One release PR per platform.
4. Keep admin bypass on rulesets.
5. Dependabot updates release with whatever they touch. Today that's nothing (npm dev tools and actions only; a test checks).
6. iOS flow: every push to `main` touching iOS paths uploads a TestFlight build at the pending release-PR version (e.g. 0.13.3 (timestamp), then more 0.13.3 builds). Merging the iOS release PR tags `ios-v0.13.3`; that tag's build is the final one, submitted by hand. `[skip testflight]` in a commit message opts out.

## Design

- release-please manifest mode, `separate-pull-requests`, tags `chrome-v*`, `firefox-v*`, `safari-v*`, `ios-v*`. Old `v*` tags and root `CHANGELOG.md` frozen at 0.13.2.
- Paths decide versions, not scopes. Version files: `extension/manifest.json`, `apps/firefox/version.json`, `MARKETING_VERSION` in `apps/safari/project.yml` and `apps/mobile/ios/project.yml`.
- semantic-release and `release.config.cjs` removed. commitlint `scope-enum` at warning level.
- TestFlight builds use main's commit, taking only a validated version string from the iOS release branch. `testflight.yml` (manual) restricted to `main` or that branch, owner only.

## Deviations to review

- **`scripts/release-please.mjs` instead of the action.** release-please has no `additional-paths` (upstream PR #2534 open), so the wrapper runs the pinned `release-please@17.11.2` and adds stand-in files listing shared paths. It runs with the release App's token: review it. Swap to the action once upstream ships the option.
- `" beta"` suffix: `npm run package` adds it to the Chrome zips (release-please can't keep it in `manifest.json`).
- Safari's copied manifest takes `MARKETING_VERSION`, so `updates.js` compares Safari versions and reads only `safari-v*` releases.
- `ios-v*` releases have no files and no `SHA256SUMS`.
- Guide "latest release" links point at the `chrome-v`/`safari-v` lists.

## After merge (settings, not in the PR)

1. Tag ruleset "protect release tags": add `refs/tags/chrome-v*`, `firefox-v*`, `safari-v*`, `ios-v*` (keep `v*`); add a **creation** rule. Bypass: release App (5110513) and admin.
2. Branch ruleset "protect default branch": remove the App 5110513 bypass; keep admin.
3. Open question: `app-store` needs approval for every upload, so each automatic TestFlight build waits. Option: a main-only `testflight` environment with no reviewers (small workflow change). Cost: any commit reaching `main` can use signing material unapproved.

## Also worth checking

- `xcode-27` runner (used by `ios.yml`, `safari.yml` on fork PRs): owner confirmed GitHub-hosted (2 Nov 2026).
