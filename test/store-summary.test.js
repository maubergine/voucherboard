// The store uploads table in $GITHUB_STEP_SUMMARY (scripts/lib/store-summary.mjs).
const test = require("node:test");
const assert = require("node:assert/strict");

let lib;
test.before(async () => { lib = await import("../scripts/lib/store-summary.mjs"); });

const ENVS = { chrome: "chrome-web-store", ios: "app-store" };
// Splits a Markdown table row on its live pipes (those after an even run of backslashes), then unescapes each cell.
function cells(row) {
  const out = [];
  let cur = "", bs = 0;
  for (const ch of row) {
    if (ch === "|" && bs % 2 === 0) { out.push(cur); cur = ""; } else cur += ch;
    bs = ch === "\\" ? bs + 1 : 0;
  }
  out.push(cur);
  return out.slice(1, -1).map((c) => c.trim().replace(/\\([\\|])/g, "$1"));
}

test("one row per store, after the header", () => {
  const t = lib.summaryTable({ chrome: { changed: true, reason: "src changed" }, ios: { changed: false, reason: "no change" } }, ENVS);
  assert.deepEqual(t.slice(0, 2), ["| Store | Upload | Why |", "| --- | --- | --- |"]);
  assert.deepEqual(cells(t[2]), ["chrome-web-store", "yes, after approval", "src changed"]);
  assert.deepEqual(cells(t[3]), ["app-store", "no", "no change"]);
});

test("a reason with pipes or backslashes stays in its own cell, unchanged", () => {
  for (const reason of ["a | b", "C:\\dir\\| x", "ends in \\", "\\\\|"]) {
    const [, , row] = lib.summaryTable({ chrome: { changed: false, reason } }, ENVS);
    assert.deepEqual(cells(row), ["chrome-web-store", "no", reason], row);
  }
});
