// Which platform releases a file belongs to, from release-please-config.json: each package's folder (less its
// exclude-paths) and its additional-paths. release-please 17 only knows the folder, so scripts/release-please.mjs adds
// the shared files with withAdditional() (upstream: googleapis/release-please#2534). testflight.mjs uses the same paths.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG = path.join(ROOT, "release-please-config.json");
// A stand-in file under a package for a shared file it uses. No real file is ever named this.
export const MARK = "_additional-path_";
// release-please's branch for a component's release pull request (BranchName.ofComponentTargetBranch).
export const releaseBranch = (component, target = "main") => `release-please--branches--${target}--components--${component}`;

export const loadConfig = (file = CONFIG) => JSON.parse(readFileSync(file, "utf8"));
const under = (file, p) => file === p || file.startsWith(`${p}/`);

// { component: { path, additional, exclude } }
export function components(config) {
  return Object.fromEntries(Object.entries(config.packages).map(([p, c]) => [c.component,
    { path: p, additional: c["additional-paths"] || [], exclude: c["exclude-paths"] || [] }]));
}

// The components whose release a file counts towards.
export function owners(file, config) {
  return Object.entries(components(config))
    .filter(([, c]) => (under(file, c.path) || c.additional.some((a) => under(file, a))) && !c.exclude.some((e) => under(file, e)))
    .map(([name]) => name);
}

export const touches = (files, component, config) => files.some((f) => owners(f, config).includes(component));

// A commit's files, plus a stand-in under each package for every file in its additional-paths, so release-please's
// split by folder counts the commit for that package too.
export function withAdditional(files, config) {
  const extra = [];
  for (const c of Object.values(components(config)))
    for (const f of files) if (!under(f, c.path) && c.additional.some((a) => under(f, a))) extra.push(`${c.path}/${MARK}/${f}`);
  return extra.length ? [...files, ...extra] : files;
}

// MARKETING_VERSION in an XcodeGen project.yml.
export const marketingVersion = (yml) => (/^\s*MARKETING_VERSION:\s*"?(\d+\.\d+\.\d+)"?/m.exec(yml || "") || [])[1] || "";

// vbVersion in the Android app's build.gradle.kts.
export const gradleVersion = (kts) => (/^val vbVersion = "(\d+\.\d+\.\d+)"/m.exec(kts || "") || [])[1] || "";

// A push opts out of its TestFlight build with this in any of its commit messages.
export const SKIP_TESTFLIGHT = /\[skip testflight\]/i;
