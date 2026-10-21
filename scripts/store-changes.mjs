#!/usr/bin/env node
// Works out whether each store has something new to upload, so release.yml only asks for approval when it does.
// The baseline is what the store was last sent: the newest successful deployment to its environment. Timestamps never
// count, only content.
//   chrome: the latest release's store zip against the zip last uploaded, file by file (SHA-256), with manifest.json's
//           version, version_name and key left out.
//   ios:    git diff between the latest release tag and what was last uploaded (a tag, or a commit for a test build
//           from testflight.yml), over the files that go into the app (project.yml's copy list).
//           Signed builds differ every time, so the inputs are compared, not the IPA. package.json's version and
//           store listing text don't count.
//   firefox: git diff from the release last handed over, over what goes into the Firefox zip (src, guide, icons and
//           its build scripts), plus manifest.json without its version fields.
//   safari: git diff between the latest release tag and the tag last signed, over what goes into the Safari app
//           (apps/safari, src, guide, icons, and manifest.json without version, version_name and key).
//
// Paths are matched in both layouts (voucherboard/... before the 2026 restructure, extension/ and apps/ after), and a
// file that only moved, unchanged, doesn't count.
//
// Usage: node scripts/store-changes.mjs [chrome] [ios] [firefox] [safari]  (all by default; run from anywhere in the repo)
// Env:   GITHUB_REPOSITORY, GH_TOKEN (deployments: read), VB_FORCE (none|chrome|ios|firefox|safari|all),
//        VB_<STORE>_TAG (the release to compare and upload, e.g. VB_IOS_TAG; default the latest tag).
// Every store's candidate is a release tag. Writes <store>=true|false and <store>_tag to $GITHUB_OUTPUT, and a table to $GITHUB_STEP_SUMMARY.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { summaryTable } from "./lib/store-summary.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "maubergine/voucherboard";
const FORCE = process.env.VB_FORCE || "none";
const ENVS = { chrome: "chrome-web-store", ios: "app-store", firefox: "firefox-amo", safari: "safari" };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20, ...opts });
const git = (...args) => sh("git", args).trim();
const gh = (...args) => JSON.parse(sh("gh", ["api", ...args]));
const forced = (store) => FORCE === store || FORCE === "all";
const latestTag = () => git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0];

// Files changed between two commits under paths, by their new name. Exact renames (R100) don't count: a move alone
// isn't a change.
const changed = (base, ref, paths) => git("diff", "--name-status", "-M", base, ref, "--", ...paths).split("\n").filter(Boolean)
  .filter((l) => !l.startsWith("R100\t")).map((l) => l.split("\t").at(-1));
// A file at a ref, from the first of paths that exists there ("" if none).
const showFirst = (ref, ...paths) => {
  for (const p of paths) { try { return sh("git", ["show", `${ref}:${p}`], { stdio: ["ignore", "pipe", "ignore"] }); } catch {} }
  return "";
};

// The newest deployment whose latest status is success: { sha, url }, or null if there's none.
function lastUploaded(env) {
  for (const d of gh(`repos/${REPO}/deployments?environment=${env}&per_page=30`)) {
    const [s] = gh(`${d.statuses_url.replace("https://api.github.com/", "")}?per_page=1`);
    if (s && s.state === "success") return { sha: d.sha, url: s.environment_url || "" };
  }
  return null;
}

// path -> sha256 of a zip's files. manifest.json is compared without its version fields.
function zipFiles(zip) {
  const out = new Map();
  for (const name of sh("unzip", ["-Z1", zip]).split("\n").filter((n) => n && !n.endsWith("/"))) {
    let buf = execFileSync("unzip", ["-p", zip, name], { maxBuffer: 64 << 20 });
    if (name === "manifest.json") {
      const { version, version_name, key, ...m } = JSON.parse(buf.toString("utf8"));
      buf = Buffer.from(JSON.stringify(m));
    }
    out.set(name, createHash("sha256").update(buf).digest("hex"));
  }
  return out;
}

function storeZip(tag, dir) {
  const d = path.join(dir, tag);
  sh("gh", ["release", "download", tag, "--repo", REPO, "--pattern", "voucherboard-*.zip", "--dir", d]);
  // voucherboard-chrome-<version>.zip; voucherboard-<version>.zip before the rename.
  const f = readdirSync(d).find((n) => /^voucherboard-(chrome-)?\d[\w.-]*\.zip$/.test(n) && !n.endsWith("-unpacked.zip"));
  if (!f) throw new Error(`${tag} has no store zip`);
  return path.join(d, f);
}

function chrome() {
  const tag = process.env.VB_CHROME_TAG || latestTag();
  if (!tag) return { changed: false, reason: "No release yet." };
  const out = { tag };
  if (forced("chrome")) return { ...out, changed: true, reason: `Forced: uploads ${tag}.` };
  const last = lastUploaded(ENVS.chrome);
  // Older deployments have no URL: the first tag after the deployed commit is the release that run made.
  const base = last && ((/\/releases\/tag\/(v[\d.]+)$/.exec(last.url) || [])[1]
    || git("tag", "--contains", last.sha, "--list", "v*", "--sort=v:refname").split("\n")[0]);
  if (!base) return { ...out, changed: true, reason: `Nothing uploaded before: uploads ${tag}.` };
  if (base === tag) return { ...out, changed: false, reason: `${tag} is already uploaded.` };
  const dir = mkdtempSync(path.join(tmpdir(), "vb-cws-"));
  try {
    const a = zipFiles(storeZip(base, dir)), b = zipFiles(storeZip(tag, dir));
    const diff = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();
    return diff.length
      ? { ...out, changed: true, reason: `${tag} changes ${list(diff)} since ${base}.` }
      : { ...out, changed: false, reason: `${tag} has the same files as ${base}, apart from the version.` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// What goes into the app: the iOS sources and project, the engine and council pages, and the src files project.yml
// copies, in both layouts.
function iosPaths(ref) {
  const yml = showFirst(ref, "apps/mobile/ios/project.yml", "voucherboard/mobile/ios/project.yml"); // "" before the app existed
  const src = new Set([...(/for f in ([\w ]+); do/.exec(yml) || [, ""])[1].split(" ").filter(Boolean),
    ...[...yml.matchAll(/\$SRC\/(\w+)\.js"/g)].map((m) => m[1])]);
  return ["apps/mobile", "voucherboard/mobile"].flatMap((m) => [`${m}/ios`, `${m}/www`, `${m}/council`, `:(exclude)${m}/ios/AppStore`])
    .concat([...src].flatMap((f) => [`extension/src/${f}.js`, `voucherboard/src/${f}.js`]),
      [":(exclude,glob)**/*.md", ":(exclude,glob)**/.gitignore"]);
}

function ios() {
  const tag = process.env.VB_IOS_TAG || latestTag();
  if (!tag) return { changed: false, reason: "No release yet." };
  const out = { tag };
  if (forced("ios")) return { ...out, changed: true, reason: `Forced: uploads ${tag}.` };
  const last = lastUploaded(ENVS.ios);
  // The deployment URL names a release tag, or a commit (testflight.yml's test builds, and uploads before 0.8).
  const base = last && ((/\/releases\/tag\/(v[\d.]+)$/.exec(last.url) || /\/commit\/([0-9a-f]{40})$/.exec(last.url) || [])[1] || last.sha);
  if (!base) return { ...out, changed: true, reason: `Nothing uploaded before: uploads ${tag}.` };
  if (base === tag) return { ...out, changed: false, reason: `${tag} is already uploaded.` };
  try { git("cat-file", "-e", `${base}^{commit}`); } catch { return { ...out, changed: true, reason: `Last upload ${base.slice(0, 7)} isn't in the history.` }; }
  const short = /^v/.test(base) ? base : base.slice(0, 7);
  const diff = changed(base, tag, [...new Set([...iosPaths(base), ...iosPaths(tag)])]);
  return diff.length
    ? { ...out, changed: true, reason: `${tag} changes ${list(diff)} since ${short}.` }
    : { ...out, changed: false, reason: `${tag} has the same app files as ${short}.` };
}

// What goes into the extension, in both layouts.
const EXT_PATHS = ["src", "guide", "icons"].flatMap((d) => [`extension/${d}`, `voucherboard/${d}`]);
// What goes into the Firefox zip (scripts/package-firefox.mjs), and the manifest without its version fields.
const FIREFOX_PATHS = [...EXT_PATHS, "scripts/package-firefox.mjs", "scripts/lib/firefox-manifest.mjs",
  "voucherboard/scripts/package-firefox.mjs", "voucherboard/scripts/lib/firefox-manifest.mjs", ":(exclude,glob)**/*.md"];
const manifestAt = (ref) => {
  try {
    const { version, version_name, key, ...m } = JSON.parse(showFirst(ref, "extension/manifest.json", "voucherboard/manifest.json"));
    return JSON.stringify(m);
  } catch { return ""; }
};

function firefox() {
  const tag = process.env.VB_FIREFOX_TAG || latestTag();
  if (!tag) return { changed: false, reason: "No release yet." };
  const out = { tag };
  if (forced("firefox")) return { ...out, changed: true, reason: `Forced: builds ${tag}.` };
  const last = lastUploaded(ENVS.firefox);
  const base = last && (/\/releases\/tag\/(v[\d.]+)$/.exec(last.url) || [])[1];
  if (!base) return { ...out, changed: true, reason: `Nothing handed over before: builds ${tag}.` };
  if (base === tag) return { ...out, changed: false, reason: `${tag} is already handed over.` };
  const diff = changed(base, tag, FIREFOX_PATHS);
  if (manifestAt(base) !== manifestAt(tag)) diff.push("extension/manifest.json");
  return diff.length
    ? { ...out, changed: true, reason: `${tag} changes ${list(diff)} since ${base}.` }
    : { ...out, changed: false, reason: `${tag} has the same Firefox files as ${base}, apart from the version.` };
}

// The Safari app is built from a release tag, and attached to that release. Compared by its inputs, like iOS, because
// notarised builds differ every time.
const SAFARI_PATHS = ["apps/safari", "voucherboard/safari", ...EXT_PATHS, ":(exclude,glob)**/*.md", ":(exclude,glob)**/.gitignore"];

function safari() {
  const tag = process.env.VB_SAFARI_TAG || latestTag();
  if (!tag) return { changed: false, reason: "No release yet." };
  const out = { tag };
  if (forced("safari")) return { ...out, changed: true, reason: `Forced: signs ${tag}.` };
  const last = lastUploaded(ENVS.safari);
  const base = last && (/\/releases\/tag\/(v[\d.]+)$/.exec(last.url) || [])[1];
  if (!base) return { ...out, changed: true, reason: `Nothing signed before: signs ${tag}.` };
  if (base === tag) return { ...out, changed: false, reason: `${tag} is already signed.` };
  try { git("cat-file", "-e", `${base}^{commit}`); } catch { return { ...out, changed: true, reason: `Last signed ${base} isn't in the history.` }; }
  const diff = changed(base, tag, SAFARI_PATHS);
  if (manifestAt(base) !== manifestAt(tag)) diff.push("extension/manifest.json");
  return diff.length
    ? { ...out, changed: true, reason: `${tag} changes ${list(diff)} since ${base}.` }
    : { ...out, changed: false, reason: `${tag} has the same Safari files as ${base}, apart from the version.` };
}

const list = (a) => (a.length > 5 ? `${a.slice(0, 5).join(", ")} and ${a.length - 5} more` : a.join(", "));

const stores = process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "ios", "firefox", "safari"];
const results = {};
for (const s of stores) {
  if (s === "chrome") results.chrome = chrome();
  else if (s === "ios") results.ios = ios();
  else if (s === "firefox") results.firefox = firefox();
  else if (s === "safari") results.safari = safari();
  else throw new Error(`Unknown store: ${s}`);
}

const lines = Object.entries(results).flatMap(([s, r]) => [`${s}=${r.changed}`, ...(r.tag ? [`${s}_tag=${r.tag}`] : [])]);
const table = summaryTable(results, ENVS);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Store uploads\n\n" + table.join("\n") + "\n");
console.log(lines.join("\n"));
for (const [s, r] of Object.entries(results)) console.log(`${s}: ${r.reason}`);
