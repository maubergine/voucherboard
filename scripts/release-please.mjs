#!/usr/bin/env node
// Runs release-please in manifest mode (release-please-config.json, .release-please-manifest.json) for every platform:
// first tags and GitHub releases for merged release pull requests, then opens or updates one release pull request per
// platform. It does what googleapis/release-please-action does, plus additional-paths, which release-please 17 lacks:
// each commit's files are extended (scripts/lib/release-paths.mjs) so a change to a shared file counts for every
// platform that ships it. Drop this for the action once release-please supports additional-paths.
//   node scripts/release-please.mjs            release.yml, with GITHUB_TOKEN set to the release App's token
//   node scripts/release-please.mjs --dry-run [--branch B]  what it would release and open, read-only (GH_TOKEN, or
//                                              gh auth token), from main or a pushed branch B (its config and commits)
// Writes <component>_release=true, <component>_tag and <component>_version to $GITHUB_OUTPUT for each release made.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { GitHub, Manifest } from "release-please";
import { loadConfig, withAdditional } from "./lib/release-paths.mjs";

const DRY = process.argv.includes("--dry-run");
const b = process.argv.indexOf("--branch");
const BRANCH = DRY && b > 0 ? process.argv[b + 1] : undefined;
const [owner, repo] = (process.env.GITHUB_REPOSITORY || "maubergine/voucherboard").split("/");
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  || (DRY ? execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() : "");
if (!token) { console.error("GITHUB_TOKEN is needed."); process.exit(1); }

const config = loadConfig();
const componentOf = Object.fromEntries(Object.entries(config.packages).map(([p, c]) => [p, c.component]));

const github = await GitHub.create({ owner, repo, token });
const commits = github.mergeCommitIterator.bind(github);
github.mergeCommitIterator = async function* (...args) {
  for await (const c of commits(...args)) yield c.files ? { ...c, files: withAdditional(c.files, config) } : c;
};
const load = () => Manifest.fromManifest(github, BRANCH || github.repository.defaultBranch, "release-please-config.json", ".release-please-manifest.json");

const out = [];
if (DRY) {
  for (const r of (await (await load()).buildReleases()).filter(Boolean)) console.log(`Would release ${r.tag.toString()}`);
  for (const pr of await (await load()).buildPullRequests())
    console.log(`Would open or update ${pr.headRefName}: ${pr.title.toString()}`);
} else {
  for (const r of (await (await load()).createReleases()).filter(Boolean)) {
    const c = componentOf[r.path];
    out.push(`${c}_release=true`, `${c}_tag=${r.tagName}`, `${c}_version=${r.version}`);
    console.log(`Released ${r.tagName}: ${r.url}`);
  }
  for (const pr of (await (await load()).createPullRequests()).filter(Boolean))
    console.log(`Release pull request #${pr.number}: ${pr.title} (${pr.headBranchName})`);
}
out.push(`releases_created=${out.length > 0}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out.join("\n") + "\n");
console.log(out.join("\n"));
