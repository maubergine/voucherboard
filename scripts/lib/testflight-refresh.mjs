// Which TestFlight upload to refresh, before its build expires (TestFlight builds expire 90 days after upload).
// uploads: successful deployments, any order, as { env, url, at (ISO time), runId }: "app-store" ones were approved by
// the owner; "app-store-refresh" ones re-uploaded an approved one. The newest is the build testers have. Once it's
// `days` old, and only if nothing has been uploaded since, it's due: the same URL again, from the archive its run saved.
export const DAY_MS = 86400000;

export function refreshDue(uploads, now, days) {
  const all = (uploads || []).filter((u) => u.url && u.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!all.length) return { due: false, why: "Nothing has been uploaded to TestFlight yet." };
  const last = all[0];
  const age = Math.floor((now - Date.parse(last.at)) / DAY_MS);
  if (age < days) return { due: false, last, age, why: `The newest upload, ${last.url}, is ${age} days old: refreshed from ${days}.` };
  if (!all.some((u) => u.env === "app-store" && u.url === last.url))
    throw new Error(`${last.url} was never approved in app-store, so it isn't refreshed`);
  return { due: true, last, age, why: `The newest upload, ${last.url}, is ${age} days old, and nothing has been uploaded since.` };
}

// The workflow run of a deployment status (its log URL, .../actions/runs/<id>/job/<id>), or "".
export const runOf = (status) => (/\/actions\/runs\/(\d+)/.exec(status?.log_url || status?.target_url || "") || [])[1] || "";

// Whether a run's archive can be re-signed without approval: a run of this repository's own main, by push, dispatch or
// schedule, of a workflow that calls ios-release.yml. (The run comes from a deployment status's log URL.)
const CALLERS = ["release.yml", "testflight.yml", "testflight-refresh.yml"].map((f) => `.github/workflows/${f}`);
export const trustedRun = (run, repo) =>
  run?.repository?.full_name === repo && run?.head_repository?.full_name === repo && run.head_branch === "main" &&
  ["push", "workflow_dispatch", "schedule"].includes(run.event) && CALLERS.includes(String(run.path).split("@")[0]);

// What an upload's URL says was built: a release tag (its version too) or a commit.
// Only this repository's URLs, whole: the result goes into $GITHUB_OUTPUT.
export function builtFrom(url, repo) {
  const base = `https://github.com/${repo}/`;
  if (typeof url !== "string" || !url.startsWith(base)) return null;
  const rest = url.slice(base.length);
  const tag = /^releases\/tag\/(ios-v(\d+\.\d+\.\d+))$/.exec(rest);
  if (tag) return { ref: tag[1], version: tag[2] };
  const commit = /^commit\/([0-9a-f]{40})$/.exec(rest);
  return commit ? { ref: commit[1], version: "" } : null;
}
