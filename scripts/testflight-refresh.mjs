#!/usr/bin/env node
// ios-release.yml's check job, for testflight-refresh.yml: whether the newest TestFlight upload is due a refresh
// (scripts/lib/testflight-refresh.mjs), and how: re-signing the archive its run saved (artefact ios-archive, no
// approval: the app-store-refresh environment), or, with that gone, rebuilding its release tag (approval: app-store).
//   node scripts/testflight-refresh.mjs
// Env: GITHUB_REPOSITORY, GH_TOKEN (deployments: read, actions: read), DAYS (default 60), run in a full checkout.
// Writes due, url, sha, version, archive_run to $GITHUB_OUTPUT, and why to the log and $GITHUB_STEP_SUMMARY.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { builtFrom, refreshDue, runOf, trustedRun } from "./lib/testflight-refresh.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "maubergine/voucherboard";
const OWNER = REPO.split("/")[0];
const DAYS = Number(process.env.DAYS || 60);
if (!(DAYS >= 1 && DAYS <= 89)) { console.error(`DAYS must be 1 to 89, not ${process.env.DAYS}`); process.exit(2); }
const gh = (p) => JSON.parse(execFileSync("gh", ["api", p], { encoding: "utf8", maxBuffer: 64 << 20 }));
const git = (...a) => { try { return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

const uploads = [];
for (const env of ["app-store", "app-store-refresh"]) {
  for (const d of gh(`repos/${REPO}/deployments?environment=${env}&per_page=30`)) {
    const s = gh(`repos/${REPO}/deployments/${d.id}/statuses?per_page=1`)[0];
    // A job's deployment is recorded as made by whoever ran it: only the owner's count (the jobs are owner only).
    if (s?.state === "success" && s.creator?.login === OWNER && d.creator?.login === OWNER) uploads.push({ env, url: s.environment_url, at: s.created_at, runId: runOf(s) });
  }
}

const r = refreshDue(uploads, Date.now(), DAYS);
const out = { due: r.due, url: "", sha: "", version: "", archive_run: "" };
let how = "";
if (r.due) {
  const from = builtFrom(r.last.url, REPO);
  if (!from) throw new Error(`Can't tell what ${r.last.url} built`);
  out.url = r.last.url;
  out.sha = git("rev-parse", "-q", "--verify", `${from.ref}^{commit}`);
  out.version = from.version;
  if (r.last.runId && !trustedRun(gh(`repos/${REPO}/actions/runs/${r.last.runId}`), REPO))
    throw new Error(`Run ${r.last.runId}, which uploaded ${r.last.url}, isn't a run of main's release workflows, so its archive isn't re-signed`);
  // The re-sign checks the archive's attestation (ios-release.yml).
  if (r.last.runId) {
    const a = gh(`repos/${REPO}/actions/runs/${r.last.runId}/artifacts?name=ios-archive`).artifacts?.[0];
    if (a && !a.expired) out.archive_run = r.last.runId;
  }
  if (out.archive_run) how = `Re-signs the archive from run ${out.archive_run} with a new build number. No approval needed.`;
  else if (out.version && out.sha) how = `Its archive is gone, so this rebuilds ${from.ref}, after approval of app-store.`;
  else throw new Error(`The archive of ${r.last.url} is gone and it isn't a release tag, so it can't be rebuilt at its version. Upload a new build: testflight.yml, or release.yml with upload=ios.`);
}

const ok = { due: /^(true|false)$/, url: /^https:\/\/[\w./-]+$|^$/, sha: /^[0-9a-f]{40}$|^$/, version: /^\d+\.\d+\.\d+$|^$/, archive_run: /^\d+$|^$/ };
for (const [k, v] of Object.entries(out)) if (!ok[k].test(String(v))) throw new Error(`Bad ${k}: ${JSON.stringify(v)}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${v}\n`).join(""));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### TestFlight refresh\n\n${r.why} ${r.due ? how : "Nothing to do."}\n`);
console.log(`${r.why} ${how}`.trim());
