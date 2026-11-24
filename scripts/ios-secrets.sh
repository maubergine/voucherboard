#!/usr/bin/env bash
# Copies the iOS app's TestFlight signing material from 1Password into a GitHub environment's variables and secrets,
# as ios-release.yml reads them. Where it is in 1Password: apps/mobile/ios/op.env (gitignored; copy op.env.example).
#
#   scripts/ios-secrets.sh <environment> [--check]
#
#   <environment>  the GitHub environment to set them in
#   --check        read and check everything, set nothing
#
# Files come out of 1Password with `op read --out-file`, which keeps their bytes (`op read` to stdout turns binary
# .p12 and .mobileprovision files into UTF-8). Each is checked before anything is set: the .p12 opens with its
# password and holds an Apple Distribution certificate, each profile is an App Store one for its bundle id and team,
# and the .p8 is a PEM key. Secrets go to gh on stdin, never as arguments. Temp files are removed on exit.
set -euo pipefail

repo=maubergine/voucherboard
root=$(cd "$(dirname "$0")/.." && pwd)
refs="$root/apps/mobile/ios/op.env"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

env_name="" check=false
for a in "$@"; do
  case "$a" in
    --check) check=true ;;
    -h|--help) usage ;;
    -*) die "unknown option: $a" ;;
    *) [ -z "$env_name" ] || die "one environment at a time"; env_name="$a" ;;
  esac
done
[ -n "$env_name" ] || usage

command -v op > /dev/null || die "the 1Password CLI is missing: brew install 1password-cli"
command -v gh > /dev/null || die "the GitHub CLI is missing: brew install gh && gh auth login"
command -v openssl > /dev/null || die "openssl is missing"
[ -f "$refs" ] || die "no apps/mobile/ios/op.env: cp apps/mobile/ios/op.env.example apps/mobile/ios/op.env, then edit it"
# shellcheck source=../apps/mobile/ios/op.env.example
. "$refs"

bundle=$(sed -nE 's/^ *APP_BUNDLE_ID: *([^ #]+).*/\1/p' "$root/apps/mobile/ios/project.yml")
[ -n "$bundle" ] || die "APP_BUNDLE_ID not found in apps/mobile/ios/project.yml"

if ! $check; then
  gh api "repos/$repo/environments/$env_name" > /dev/null 2>&1 \
    || die "no $env_name environment in $repo, or gh can't see it (gh auth status)"
fi

t=$(mktemp -d "${TMPDIR:-/tmp}/vb-secrets.XXXXXX")
chmod 700 "$t"
trap 'rm -rf "$t"' EXIT

# A text field, without a trailing newline or carriage return.
field() { op read -n "$1" | tr -d '\r'; }
# A file attachment, byte for byte.
file() { op read --force --out-file "$2" "$1" > /dev/null; }
# Base64 on one line (GNU base64 wraps at 76 columns; macOS doesn't).
b64() { base64 < "$1" | tr -d '\n'; }

say "Reading from 1Password"
for v in VB_OP_TEAM_ID VB_OP_P12 VB_OP_P12_PASSWORD VB_OP_PROFILE_APP VB_OP_PROFILE_SHARE VB_OP_PROFILE_LIVE \
         VB_OP_ASC_KEY_ID VB_OP_ASC_ISSUER_ID VB_OP_ASC_P8; do
  op read "${!v}" > /dev/null 2>&1 || die "can't read $v (${!v}): fix it in apps/mobile/ios/op.env"
done
team=$(field "$VB_OP_TEAM_ID")
key_id=$(field "$VB_OP_ASC_KEY_ID")
issuer=$(field "$VB_OP_ASC_ISSUER_ID")
VB_P12_PW=$(field "$VB_OP_P12_PASSWORD")
export VB_P12_PW
file "$VB_OP_P12" "$t/dist.p12"
file "$VB_OP_ASC_P8" "$t/key.p8"
for p in APP SHARE LIVE; do v="VB_OP_PROFILE_$p"; file "${!v}" "$t/$p.mobileprovision"; done

say "Checking"
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] || die "team id isn't a 10-character Team ID"
[[ "$key_id" =~ ^[A-Z0-9]{10}$ ]] || die "the API key's username isn't a 10-character Key ID"
[[ "$issuer" =~ ^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$ ]] || die "issuer id isn't a UUID"

head -n 1 "$t/key.p8" | grep -qx -- '-----BEGIN PRIVATE KEY-----' || die "AuthKey.p8 isn't a PEM private key"
! grep -q $'\r' "$t/key.p8" || die "AuthKey.p8 has Windows line endings: re-attach the file Apple gave you"

# OpenSSL 3 needs -legacy for older .p12 ciphers; LibreSSL (macOS) has no such flag.
p12() { openssl pkcs12 -in "$t/dist.p12" -passin env:VB_P12_PW "$@" 2> /dev/null \
        || openssl pkcs12 -legacy -in "$t/dist.p12" -passin env:VB_P12_PW "$@" 2> /dev/null; }
p12 -nokeys -clcerts -out "$t/cert.pem" || die "dist.p12 doesn't open with its password"
p12 -nocerts -nodes -out /dev/null || die "dist.p12 holds no private key"
subject=$(openssl x509 -in "$t/cert.pem" -noout -subject)
[[ "$subject" == *"Apple Distribution"* ]] || die "dist.p12 isn't an Apple Distribution certificate ($subject)"
[[ "$subject" == *"$team"* ]] || echo "warning: the certificate's subject doesn't name team $team: $subject" >&2
openssl x509 -in "$t/cert.pem" -noout -checkend 0 > /dev/null || die "the certificate has expired"
openssl x509 -in "$t/cert.pem" -noout -checkend $((30 * 86400)) > /dev/null \
  || echo "warning: the certificate expires within 30 days: $(openssl x509 -in "$t/cert.pem" -noout -enddate)" >&2

now=$(date -u +%s)
for p in APP SHARE LIVE; do
  case $p in APP) id=$bundle ;; SHARE) id=$bundle.share ;; LIVE) id=$bundle.live ;; esac
  f="$t/$p.mobileprovision" x="$t/$p.plist"
  security cms -D -i "$f" > "$x" 2> /dev/null || die "the $p profile isn't a provisioning profile"
  appid=$(plutil -extract Entitlements.application-identifier raw "$x")
  [ "$appid" = "$team.$id" ] || die "the $p profile is for $appid, not $team.$id"
  if [ "$(plutil -extract Entitlements.get-task-allow raw "$x" 2> /dev/null || echo false)" = true ] \
     || plutil -extract ProvisionedDevices raw "$x" > /dev/null 2>&1; then
    die "the $p profile is a development or ad hoc profile: use an App Store Connect one"
  fi
  exp=$(plutil -extract ExpirationDate raw "$x")
  left=$(( ($(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$exp" +%s) - now) / 86400 ))
  [ "$left" -ge 0 ] || die "the $p profile expired on $exp"
  [ "$left" -ge 30 ] || echo "warning: the $p profile expires in $left days ($exp)" >&2
  echo "  $p profile: $id, $left days left"
done
echo "  certificate: $(openssl x509 -in "$t/cert.pem" -noout -enddate)"
echo "  team $team, API key $key_id"

if $check; then say "All good. Nothing set (--check)."; exit 0; fi

say "Setting $env_name in $repo"
g=(--repo "$repo" --env "$env_name")
gh variable set APPLE_TEAM_ID "${g[@]}" --body "$team"
gh variable set ASC_KEY_ID "${g[@]}" --body "$key_id"
gh variable set ASC_ISSUER_ID "${g[@]}" --body "$issuer"
gh secret set ASC_KEY_P8 "${g[@]}" < "$t/key.p8"
b64 "$t/dist.p12" | gh secret set IOS_DIST_CERT_P12 "${g[@]}"
printf '%s' "$VB_P12_PW" | gh secret set IOS_DIST_CERT_PASSWORD "${g[@]}"
for p in APP SHARE LIVE; do b64 "$t/$p.mobileprovision" | gh secret set "IOS_PROFILE_$p" "${g[@]}"; done
say "Done. Run it again for the other environment, and after renewing anything in 1Password."
