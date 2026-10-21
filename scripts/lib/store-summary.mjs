// The table store-changes.mjs writes to $GITHUB_STEP_SUMMARY: one row per store, whether it uploads, and why.
export const cell = (s) => String(s).replace(/[\\|]/g, "\\$&");
export const summaryTable = (results, envs) => ["| Store | Upload | Why |", "| --- | --- | --- |",
  ...Object.entries(results).map(([s, r]) => `| ${envs[s]} | ${r.changed ? "yes, after approval" : "no"} | ${cell(r.reason)} |`)];
