#!/usr/bin/env node
// The version a TestFlight build of main gets: the one the open iOS release pull request proposes, read from
// apps/mobile/ios/project.yml on release-please's branch. Only the number is taken from that branch; the build is
// always of the commit on main.
//   node scripts/testflight.mjs pending  release.yml, after release-please: whether this push gets a TestFlight build
//   node scripts/testflight.mjs version  testflight.yml: the pending version, or nothing if no iOS release is pending
// Env: GITHUB_REPOSITORY, GH_TOKEN (pull-requests: read), and for pending BEFORE and AFTER (the push's range) and
// IOS_RELEASED ("true" when this push released iOS: ios-release.yml uploads the tag instead).
// Writes version=<x.y.z or empty> to $GITHUB_OUTPUT, and why to the log and $GITHUB_STEP_SUMMARY.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { SKIP_TESTFLIGHT, loadConfig, marketingVersion, releaseBranch, touches } from "./lib/release-paths.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "maubergine/voucherboard";
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const BRANCH = releaseBranch("ios");

function pendingVersion() {
  const open = JSON.parse(sh("gh", ["api", `repos/${REPO}/pulls?state=open&head=${REPO.split("/")[0]}:${BRANCH}`]));
  if (!open.length) return { version: "", why: "No iOS release pull request is open, so no version is pending." };
  const yml = sh("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/${REPO}/contents/apps/mobile/ios/project.yml?ref=${BRANCH}`]);
  const version = marketingVersion(yml);
  if (!version) throw new Error(`No MARKETING_VERSION in project.yml on ${BRANCH}`);
  return { version, why: `iOS release pull request #${open[0].number} proposes ${version}.` };
}

function pending() {
  if (process.env.IOS_RELEASED === "true") return { version: "", why: "This push released iOS: ios-release.yml uploads the tag." };
  const after = process.env.AFTER || "HEAD";
  let before = process.env.BEFORE || "";
  try { if (/^0+$/.test(before)) throw 0; sh("git", ["cat-file", "-e", `${before}^{commit}`]); } catch { before = `${after}^`; }
  const files = sh("git", ["diff", "--name-only", before, after]).split("\n").filter(Boolean);
  if (!touches(files, "ios", loadConfig())) return { version: "", why: "This push changes nothing in the iOS app." };
  if (SKIP_TESTFLIGHT.test(sh("git", ["log", "--format=%B", `${before}..${after}`])))
    return { version: "", why: "A commit in this push says [skip testflight]." };
  return pendingVersion();
}

const mode = process.argv[2];
if (!["pending", "version"].includes(mode)) { console.error("Usage: testflight.mjs pending|version"); process.exit(2); }
const r = mode === "pending" ? pending() : pendingVersion();
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${r.version}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### TestFlight\n\n${r.version ? `Builds main at ${r.version}, after approval. ` : "No build. "}${r.why}\n`);
console.log(`version=${r.version}\n${r.why}`);
