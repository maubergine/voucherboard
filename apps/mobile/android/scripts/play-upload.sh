#!/usr/bin/env bash
# Uploads a signed app bundle to Google Play's internal testing track as a DRAFT release
# (.github/workflows/android-play.yml, docs/GOOGLE_PLAY.md step 8). It never sets a release to inProgress or completed,
# and never sends anything for review: the owner starts the rollout in Play Console.
#
# Usage: ACCESS_TOKEN=... play-upload.sh <app-release.aab> <release-notes.txt>
#   ACCESS_TOKEN  an OAuth token with the androidpublisher scope (CI gets one through Workload Identity Federation)
#   PACKAGE       optional; defaults to com.mariusrubin.voucherboard
#   DRY_RUN=1     print the requests instead of sending them
set -euo pipefail

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
[ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] && usage 0
[ $# -eq 2 ] || usage 1
aab=$1 notes_file=$2
package=${PACKAGE:-com.mariusrubin.voucherboard}
track=internal
for t in curl jq; do command -v "$t" > /dev/null || { echo "error: $t is needed" >&2; exit 1; }; done
[ -f "$aab" ] || { echo "error: no bundle at $aab" >&2; exit 1; }
[ -f "$notes_file" ] || { echo "error: no release notes at $notes_file" >&2; exit 1; }
[ -n "${ACCESS_TOKEN:-}" ] || [ -n "${DRY_RUN:-}" ] || { echo "error: ACCESS_TOKEN is not set" >&2; exit 1; }

notes=$(cat "$notes_file")
[ "${#notes}" -le 500 ] || { echo "error: release notes are over 500 characters" >&2; exit 1; }

api="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$package"
upload="https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/$package"

# call METHOD URL [curl args...]: prints the body; on a non-2xx status, logs the body to stderr and fails.
call() {
  if [ -n "${DRY_RUN:-}" ]; then echo "DRY RUN: $1 $2" >&2; echo '{"id":"dry-run","versionCode":0}'; return; fi
  local out status body
  out=$(curl -sS -w '\n%{http_code}' -X "$1" "$2" -H "Authorization: Bearer $ACCESS_TOKEN" "${@:3}")
  status=${out##*$'\n'}
  body=${out%$'\n'*}
  if [ "${status:0:1}" != "2" ]; then
    printf '%s\n' "$body" >&2
    echo "::error::$1 ${2%%\?*} returned $status: $(jq -r '.error.message // empty' <<<"$body" 2>/dev/null)" >&2
    return 1
  fi
  printf '%s' "$body"
}

edit=$(call POST "$api/edits" -H "Content-Type: application/json" -d '{}' | jq -r .id)
# An edit that isn't committed is thrown away, so a failure part-way leaves Play Console as it was.
cleanup() { [ -n "${committed:-}" ] || call DELETE "$api/edits/$edit" > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Uploading $(basename "$aab") to edit $edit"
code=$(call POST "$upload/edits/$edit/bundles?uploadType=media" \
  -H "Content-Type: application/octet-stream" --data-binary @"$aab" | jq -r .versionCode)
echo "Uploaded version code $code"

release=$(jq -n --arg code "$code" --arg notes "$notes" --arg track "$track" \
  '{track: $track, releases: [{status: "draft", versionCodes: [$code], releaseNotes: [{language: "en-GB", text: $notes}]}]}')
# The only status this script ever sends.
[ "$(jq -r '.releases[0].status' <<<"$release")" = "draft" ] || { echo "error: release isn't a draft" >&2; exit 1; }
call PUT "$api/edits/$edit/tracks/$track" -H "Content-Type: application/json" -d "$release" > /dev/null
echo "Draft release on the $track track"

# A draft needs no review, so there's nothing to hold back; changesNotSentForReview keeps it that way if Play would
# otherwise group this edit with pending changes and send them.
call POST "$api/edits/$edit:commit?changesNotSentForReview=true" > /dev/null
committed=1
echo "Committed. Start the rollout to internal testing in Play Console."
