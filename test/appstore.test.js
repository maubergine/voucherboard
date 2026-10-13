// App Store listing text (apps/mobile/ios/AppStore): App Store Connect's length limits, and wording App Review rejects.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "apps", "mobile", "ios", "AppStore");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\n$/, "");
const meta = (f) => read(path.join("metadata", "en-GB", f));

test("listing fields fit App Store Connect's limits", () => {
  const limits = { "name.txt": 30, "subtitle.txt": 30, "keywords.txt": 100, "promotional_text.txt": 170, "description.txt": 4000, "release_notes.txt": 4000 };
  for (const [f, max] of Object.entries(limits)) assert.ok([...meta(f)].length <= max, `${f} is over ${max} characters`);
  assert.ok([...read("review_information/notes.txt")].length <= 4000, "review notes are over 4000 characters");
});

test("keywords are comma separated, with no spaces or repeats of the name", () => {
  const k = meta("keywords.txt").split(",");
  assert.ok(k.every((w) => w && w === w.trim()), "no spaces around commas");
  assert.strictEqual(new Set(k).size, k.length);
  assert.ok(!k.includes(meta("name.txt").toLowerCase()), "the app name is indexed already");
});

test("listing says it's independent, free, and never calls itself a beta (guideline 2.2)", () => {
  const d = meta("description.txt");
  assert.match(d, /isn't made, endorsed or supported by Lewisham Council/);
  assert.match(d, /Free, with no in-app purchases/);
  for (const f of fs.readdirSync(path.join(DIR, "metadata", "en-GB"))) assert.doesNotMatch(meta(f), /\b(beta|trial|demo version)\b/i, f);
});

test("privacy and support URLs are the pages built from site/PRIVACY.md and site/SUPPORT.md", async () => {
  assert.strictEqual(meta("privacy_url.txt"), "https://voucherboard.mariusrubin.com/privacy.html");
  assert.strictEqual(meta("support_url.txt"), "https://voucherboard.mariusrubin.com/support.html");
  const { renderPages } = await import(require("node:url").pathToFileURL(path.join(__dirname, "..", "scripts", "render-pages.mjs")).href);
  const pages = renderPages();
  for (const f of ["privacy.html", "support.html", "accessibility.html"]) assert.ok(pages[f], f);
});
