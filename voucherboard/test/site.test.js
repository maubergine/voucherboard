// The Pages site (docs/, https://voucherboard.mariusrubin.com/): rendered pages match their sources, every page
// has the shared nav, and every link between pages resolves to a file in docs/.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const T = require("../src/terms.js");

const DOCS = path.join(__dirname, "..", "..", "docs");
const SITE = "https://voucherboard.mariusrubin.com/";
const PAGES = ["index.html", "install.html", "privacy.html", "support.html", "accessibility.html", "guide/index.html"];
const load = (f) => import(pathToFileURL(path.join(__dirname, "..", "scripts", f)).href);
const read = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");

// A URL on the site -> the file in docs/ it serves.
const fileFor = (rel) => { const p = rel.split("#")[0]; return path.join(DOCS, p === "" || p.endsWith("/") ? p + "index.html" : p); };

test("docs/ pages are up to date with their Markdown sources", async () => {
  const { renderPages } = await load("render-pages.mjs");
  for (const [f, s] of Object.entries(renderPages())) assert.strictEqual(read(f), s, `run \`node scripts/render-pages.mjs\` to regenerate docs/${f}`);
});

test("every page has the site nav, and every relative link or image resolves to a file in docs/", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<nav aria-label="Site">/, `${page} has the nav`);
    for (const [, ref] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:|#)/.test(ref)) continue;
      const target = fileFor(path.posix.join(path.posix.dirname(page), ref) + (ref.endsWith("/") ? "/" : ""));
      assert.ok(fs.existsSync(target), `${page} links to ${ref}, which is missing`);
    }
  }
});

test("the index and nav link to the install page and the guide", () => {
  const index = read("index.html");
  for (const href of ['href="install.html"', 'href="guide/"']) assert.ok(index.includes(href), `index has ${href}`);
  assert.ok(read("guide/index.html").includes('href="../install.html"'), "guide nav links to install");
});

test("the install page covers every platform, with each browser's steps in the guide, and never calls the apps beta", () => {
  const html = read("install.html");
  const guide = read("guide/index.html");
  for (const id of ["chrome-or-brave", "microsoft-edge", "firefox", "safari-on-a-mac"]) {
    assert.ok(html.includes(`href="guide/#${id}"`), `install links to guide/#${id}`);
    assert.match(guide, new RegExp(`<h3 id="${id}">`), `guide has #${id}`);
  }
  for (const id of ["iphone-and-ipad", "android"]) assert.match(html, new RegExp(`<h2 id="${id}">`), `install has #${id}`);
  assert.match(guide, /chromewebstore\.google\.com\/detail\/voucherboard-beta\/cldhejnblckejbeebjidikhebdfnncak/);
  assert.match(guide, /Allow extensions from other stores/);
  assert.match(guide, /Voucherboard for Safari/);
  const apps = html.slice(html.indexOf('id="iphone-and-ipad"'), html.indexOf('id="help"'));
  assert.doesNotMatch(apps, /beta/i);
});

test("the terms' links point at pages that exist", () => {
  for (const url of [`${SITE}guide/`, T.PRIVACY_URL, T.SUPPORT_URL, T.ACCESSIBILITY_URL]) {
    assert.ok(url.startsWith(SITE), url);
    assert.ok(fs.existsSync(fileFor(url.slice(SITE.length))), `${url} has no file in docs/`);
  }
});
