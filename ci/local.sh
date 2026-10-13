#!/usr/bin/env bash
# Runs the GitHub workflows locally with act (https://github.com/nektos/act): the Ubuntu jobs in Docker, and the unsigned
# Xcode builds on this Mac. Only workflows that sign, upload and publish nothing are allowed. See ci/README.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Ubuntu runner image, pinned by digest. Also in .actrc, for running act directly.
UBUNTU=catthehacker/ubuntu:act-latest@sha256:c58e2b364da03b0c804c7d660f2ecbedf2f221a382b9baa0b344b0144780ff43
# GitHub's ubuntu-latest is x86_64. On Apple silicon Docker emulates it (Rosetta or QEMU): slower, but the same
# architecture as CI. VB_ARCH=linux/arm64 runs natively instead.
ARCH="${VB_ARCH:-linux/amd64}"
OUT="$ROOT/dist/local-ci"
BASE=origin/main
JOBS=()

usage() {
  cat <<EOF
Usage: ci/local.sh [options] [job...]

Workflows, run by act (default: commitlint ci):
  commitlint  .github/workflows/commitlint.yml, as a pull request into --base
  ci          .github/workflows/ci.yml: tests, guide check, Chrome and Firefox zips, web-ext lint.
              The zips and SHA256SUMS are copied to dist/local-ci/.
  site        .github/workflows/pages.yml's build job: the website, without deploying it
  safari      .github/workflows/safari.yml on this Mac (macOS, Xcode 27+): unsigned build and bundle checks
  ios         .github/workflows/ios.yml on this Mac: unsigned Simulator build and bundle checks

Extras (no workflow runs these on their own):
  release     semantic-release --dry-run on this branch, in a throwaway clone: the next version and its notes
  stores      store-changes.mjs: which stores a release would offer (read-only GitHub API, via gh)

  all         commitlint ci site release safari ios (safari and ios are skipped off macOS)

Options:
  --base REF  What this branch merges into (default origin/main).
  -h, --help  Show this help.

Environment:
  VB_ARCH     Container architecture for the Ubuntu jobs (default linux/amd64, as GitHub; linux/arm64 is faster on
              Apple silicon).
  VB_XCODE    Xcode for safari and ios (default /Applications/Xcode.app). Your xcode-select setting isn't changed.

Never run: release.yml, the store workflows (*-release.yml), signing, notarisation and the website deploy. They need the owner's
credentials; the summary lists them.
EOF
}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

while (($#)); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --base) BASE="${2:?--base needs a ref}"; shift ;;
    all) JOBS+=(commitlint ci site release safari ios) ;;
    commitlint|ci|site|safari|ios|release|stores) JOBS+=("$1") ;;
    *) usage >&2; die "Unknown argument: $1" ;;
  esac
  shift
done
((${#JOBS[@]})) || JOBS=(commitlint ci)

need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"; }
need git ""
need node "Install Node.js 22 or later."
cd "$ROOT"

# A pull_request event into BASE, so the workflows lint and test what a pull request would.
EVENT="$(mktemp -t vb-event)"
trap 'rm -f "$EVENT"' EXIT
base_sha=$(git merge-base "$BASE" HEAD) || die "No merge base with $BASE."
cat >"$EVENT" <<EOF
{ "pull_request": { "number": 0, "base": { "ref": "${BASE#origin/}", "sha": "$base_sha" },
  "head": { "ref": "$(git rev-parse --abbrev-ref HEAD)", "sha": "$(git rev-parse HEAD)" } } }
EOF

act_run() { # act_run WORKFLOW [act args...]
  act pull_request -W ".github/workflows/$1" -e "$EVENT" --pull=false "${@:2}"
}

RESULTS=()
run() { # run NAME COMMAND...
  local rc=0; "${@:2}" || rc=$?
  case $rc in 0) RESULTS+=("$1|pass") ;; 3) RESULTS+=("$1|skipped") ;; *) RESULTS+=("$1|FAIL") ;; esac
}

ubuntu() {
  need act "Install it with: brew install act"
  docker info >/dev/null 2>&1 || die "Docker isn't running."
  docker pull -q --platform "$ARCH" "$UBUNTU" >/dev/null || die "Couldn't pull $UBUNTU for $ARCH."
}
linux_act() { act_run "$1" -P "ubuntu-latest=$UBUNTU" --container-architecture "$ARCH" "${@:2}"; }

job_commitlint() {
  say "commitlint.yml (act)"
  # GitHub never runs a pull request with no commits, and commitlint rejects an empty range.
  if [[ "$base_sha" == "$(git rev-parse HEAD)" ]]; then echo "No commits since $BASE."; return 3; fi
  ubuntu; linux_act commitlint.yml
}

job_ci() {
  say "ci.yml (act)"; ubuntu
  rm -rf "$OUT"; mkdir -p "$OUT"
  linux_act ci.yml --container-options "-v $OUT:/vb-out"
}

# xcode-27 maps to this Mac only here; .actrc leaves it out, so a bare act run skips these jobs on any machine.
job_site() { say "pages.yml build (act)"; ubuntu; linux_act pages.yml -j build; }

mac() {
  [[ "$(uname)" == Darwin ]] || { echo "Skipped: needs macOS with Xcode."; return 3; }
  need act "Install it with: brew install act"
}
job_safari() { say "safari.yml (act, on this Mac)"; mac || return; act_run safari.yml -P xcode-27=-self-hosted; }
job_ios() { say "ios.yml (act, on this Mac)"; mac || return; act_run ios.yml -P xcode-27=-self-hosted; }

# semantic-release in a throwaway clone, releasing from this branch to a throwaway bare copy, with only the commit
# analyser and notes generator loaded and no token: it can't reach GitHub.
job_release() {
  say "semantic-release --dry-run"
  local tmp; tmp="$(mktemp -d -t vb-release)"
  local branch; branch=$(git rev-parse --abbrev-ref HEAD)
  (
    trap 'rm -rf "$tmp"' EXIT
    git clone -q --no-local "$ROOT" "$tmp/work" && git -C "$tmp/work" checkout -q -B "$branch" HEAD
    git clone -q --bare "$tmp/work" "$tmp/origin.git"
    cd "$tmp/work" && npm ci --no-audit --no-fund --loglevel=error --ignore-scripts
    env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ACTIONS -u CI npx semantic-release --dry-run --no-ci --branches "$branch" \
      --repository-url "file://$tmp/origin.git" \
      --plugins @semantic-release/commit-analyzer,@semantic-release/release-notes-generator
  )
}

job_stores() {
  say "store-changes.mjs (read-only)"
  need gh "Install it with: brew install gh"
  GH_TOKEN="$(gh auth token)" || die "Run gh auth login."
  GH_TOKEN="$GH_TOKEN" GITHUB_REPOSITORY=maubergine/voucherboard node scripts/store-changes.mjs
}

for j in "${JOBS[@]}"; do run "$j" "job_$j"; done

say "Summary"
for r in "${RESULTS[@]}"; do printf '  %-11s %s\n' "${r%%|*}" "${r#*|}"; done
[[ -n "$(ls -A "$OUT" 2>/dev/null)" ]] && echo "  Zips and SHA256SUMS: ${OUT#"$ROOT/"}/"
cat <<'EOF'

Not run (owner's credentials, a store, Apple's notary service, or the live site):
  release.yml          publish: tag, release commit, GitHub release  release environment (GitHub App key)
  chrome-release.yml   CRX signing, Chrome Web Store draft upload    chrome-web-store environment
  firefox-release.yml  addons.mozilla.org validation                 firefox-amo environment (AMO JWT)
  ios-release.yml      sign, archive, upload to TestFlight           app-store environment
  testflight.yml       manual TestFlight test build                  app-store environment
  safari-release.yml   Developer ID signing, notarisation, attach    safari environment
  pages.yml            deploy to GitHub Pages                        github-pages environment
EOF
[[ " ${RESULTS[*]} " != *"|FAIL"* ]]
