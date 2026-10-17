// Google Play listing text (apps/mobile/android/PlayStore): Play Console's length limits, and wording reviewers reject.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "apps", "mobile", "android", "PlayStore");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8").replace(/\n$/, "");
const meta = (f) => read(path.join("metadata", "android", "en-GB", f));
const len = (s) => [...s].length;

test("listing fields fit Play Console's limits", () => {
  const limits = { "title.txt": 30, "short_description.txt": 80, "full_description.txt": 4000, "changelogs/default.txt": 500 };
  for (const [f, max] of Object.entries(limits)) assert.ok(len(meta(f)) <= max, `${f} is over ${max} characters`);
});

test("listing says it's independent, names its sources, is free, and never calls itself a beta", () => {
  const d = meta("full_description.txt");
  assert.match(d, /isn't made, endorsed or supported by Lewisham Council/);
  // Google's rules for apps that communicate government information: sources, and no claim to represent it.
  assert.match(d, /doesn't represent the council or any government body/);
  assert.match(d, /lewisham\.gov\.uk/);
  assert.match(d, /Free, with no in-app purchases/);
  for (const f of ["title.txt", "short_description.txt", "full_description.txt", "changelogs/default.txt"]) {
    assert.doesNotMatch(meta(f), /\b(beta|trial|demo version)\b/i, f);
  }
});

test("the title and short description don't lead with the council's name", () => {
  assert.doesNotMatch(meta("title.txt"), /lewisham|council/i);
  assert.doesNotMatch(meta("short_description.txt"), /^lewisham|council/i);
});

test("privacy and support URLs are the pages built from site/PRIVACY.md and site/SUPPORT.md, as on iOS", async () => {
  const ios = (f) => fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "ios", "AppStore", "metadata", "en-GB", f), "utf8").trim();
  assert.strictEqual(read("privacy_url.txt"), "https://voucherboard.mariusrubin.com/privacy.html");
  assert.strictEqual(read("support_url.txt"), "https://voucherboard.mariusrubin.com/support.html");
  assert.strictEqual(read("privacy_url.txt"), ios("privacy_url.txt"));
  assert.strictEqual(read("support_url.txt"), ios("support_url.txt"));
  const { renderPages } = await import(require("node:url").pathToFileURL(path.join(__dirname, "..", "scripts", "render-pages.mjs")).href);
  const pages = renderPages();
  for (const f of ["privacy.html", "support.html"]) assert.ok(pages[f], f);
});

test("the upload script only ever makes draft releases", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "android", "scripts", "play-upload.sh"), "utf8");
  assert.match(s, /status: "draft"/);
  assert.doesNotMatch(s, /"(inProgress|completed|halted)"/);
  assert.doesNotMatch(s, /userFraction|:validate\b|reviews/);
});

test("the app icon is a 512 × 512 32-bit PNG under 1,024 KB", () => {
  const f = path.join(DIR, "metadata", "android", "en-GB", "images", "icon.png");
  const b = fs.readFileSync(f);
  assert.strictEqual(b.subarray(1, 4).toString(), "PNG");
  assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [512, 512]);
  assert.deepStrictEqual([b[24], b[25]], [8, 6], "8-bit RGBA");
  assert.ok(b.length <= 1024 * 1024);
});
