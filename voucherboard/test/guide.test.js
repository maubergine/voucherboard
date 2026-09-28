// Checks the guide is one source (README.md) rendered two ways, with no drift: index.html must be
// exactly what the renderer produces from the current README.md, every image it references must exist,
// and the rendered page must load nothing over the network (terms.js promises no network but the council
// site; a link the user might click, like a GitHub issues link, is fine — a resource load is not).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const GUIDE_DIR = path.join(__dirname, "..", "guide");
const SOURCE_MD = path.join(GUIDE_DIR, "README.md");
const OUTPUT_HTML = path.join(GUIDE_DIR, "index.html");

async function loadRenderer() {
  return import(pathToFileURL(path.join(__dirname, "..", "scripts", "render-guide.mjs")).href);
}

test("guide/index.html is up to date with guide/README.md", async () => {
  const { render } = await loadRenderer();
  const expected = render();
  const actual = fs.readFileSync(OUTPUT_HTML, "utf8");
  assert.strictEqual(actual, expected, "run `node scripts/render-guide.mjs` to regenerate guide/index.html");
});

test("every image guide/README.md references exists in guide/img", () => {
  const md = fs.readFileSync(SOURCE_MD, "utf8");
  const refs = [...md.matchAll(/!\[[^\]]*\]\((img\/[^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "the guide should reference at least one screenshot");
  for (const ref of refs) {
    const file = path.join(GUIDE_DIR, ref);
    assert.ok(fs.existsSync(file), `${ref} is referenced in README.md but missing from guide/img`);
  }
});

test("guide/index.html makes no http(s) resource loads (a clickable link is fine)", () => {
  const html = fs.readFileSync(OUTPUT_HTML, "utf8");
  // Tags that fetch a resource from their src/href: script, img, iframe, source, link. "a" is excluded —
  // a link the reader might click isn't a network request the page itself makes.
  const resourceTag = /<(script|img|iframe|source|link)\b[^>]*\b(?:src|href)\s*=\s*"https?:\/\/[^"]*"/i;
  assert.ok(!resourceTag.test(html), "found an http(s) src/href on a resource-loading tag");
  assert.ok(!/url\(\s*['"]?https?:\/\//i.test(html), "found an external url() in the page's CSS");
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), "found an external <script src>");
});

test("renderMarkdown produces an id for every heading, with no duplicates", async () => {
  const { renderMarkdown } = await loadRenderer();
  const md = fs.readFileSync(SOURCE_MD, "utf8");
  const { html } = renderMarkdown(md);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 5);
  assert.strictEqual(new Set(ids).size, ids.length, "heading ids must be unique");
});

test("every in-page #anchor link in the guide matches a heading id", async () => {
  const { renderMarkdown } = await loadRenderer();
  const md = fs.readFileSync(SOURCE_MD, "utf8");
  const { html } = renderMarkdown(md);
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length > 0);
  for (const a of anchors) assert.ok(ids.has(a), `#${a} has no matching heading`);
});

test("a numbered list split across other blocks (e.g. a screenshot after each step) keeps its numbers", async () => {
  const { renderMarkdown } = await loadRenderer();
  const { html } = renderMarkdown("1. First\n\n![x](img/a.png)\n\n2. Second\n\n3. Third\n");
  assert.deepStrictEqual([...html.matchAll(/<li value="(\d+)"/g)].map((m) => m[1]), ["1", "2", "3"]);
});

test("renderMarkdown does not double-escape an HTML entity or a code span written in the source", async () => {
  const { renderMarkdown } = await loadRenderer();
  const { html } = renderMarkdown("Every `<day>` and &amp; here.");
  assert.match(html, /<code>&lt;day&gt;<\/code>/);
  assert.match(html, /&amp; here/);
  assert.doesNotMatch(html, /&amp;amp;/);
  assert.doesNotMatch(html, /&amp;lt;/);
});
