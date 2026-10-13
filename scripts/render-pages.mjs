#!/usr/bin/env node
// Builds the website (https://voucherboard.mariusrubin.com/) from site/ (INSTALL.md, PRIVACY.md, SUPPORT.md,
// ACCESSIBILITY.md, CNAME) and the guide (extension/guide). pages.yml deploys the result; nothing built is committed.
// The App Store listing links to these pages.
//
// Usage:
//   node scripts/render-pages.mjs [--out DIR]   # writes the site to DIR (default build/site), replacing it
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown, renderSite, GUIDE_DIR } from "./render-guide.mjs";
import { shell } from "./lib/site.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "site");

// Repo-relative links in the sources point at the other page, not the Markdown file.
const LINKS = { "INSTALL.md": "install.html", "PRIVACY.md": "privacy.html", "SUPPORT.md": "support.html", "ACCESSIBILITY.md": "accessibility.html" };
const INDEX_MD = `# Voucherboard

A free planner for Lewisham's visitor parking permit site, for iPhone and as a browser extension. It's an independent
app by Marius Rubin, an individual developer, and isn't made or endorsed by Lewisham Council or its suppliers.

- [Install](INSTALL.md): browser extension, iPhone and Android
- [Guide](guide/): how to use the browser extension
- [Privacy policy](PRIVACY.md)
- [Support](SUPPORT.md)
- [Accessibility statement](ACCESSIBILITY.md)
`;

function page(md, source) {
  const fixed = md.replace(/\]\((PRIVACY|SUPPORT|ACCESSIBILITY|INSTALL)\.md(#[^)]*)?\)/g, (_, f, hash) => `](${LINKS[f + ".md"]}${hash || ""})`)
    .replace(/\]\((?:\.\.\/)?extension\/guide\/README\.md(#[^)]*)?\)/g, (_, hash) => `](guide/${hash || ""})`);
  const { html } = renderMarkdown(fixed);
  const title = (/^#\s+(.+)$/m.exec(md) || [, "Voucherboard"])[1];
  return shell({ title, body: html, source });
}

export function renderPages() {
  const read = (f) => fs.readFileSync(path.join(SITE, f), "utf8");
  return {
    "index.html": page(INDEX_MD, "scripts/render-pages.mjs"),
    "install.html": page(read("INSTALL.md"), "site/INSTALL.md"),
    "privacy.html": page(read("PRIVACY.md"), "site/PRIVACY.md"),
    "support.html": page(read("SUPPORT.md"), "site/SUPPORT.md"),
    "accessibility.html": page(read("ACCESSIBILITY.md"), "site/ACCESSIBILITY.md"),
    "guide/index.html": renderSite(),
    CNAME: read("CNAME")
  };
}

// Writes the whole site into out: the pages, and the guide's screenshots.
export function buildSite(out) {
  fs.rmSync(out, { recursive: true, force: true });
  for (const [f, s] of Object.entries(renderPages())) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.writeFileSync(path.join(out, f), s);
  }
  fs.cpSync(path.join(GUIDE_DIR, "img"), path.join(out, "guide", "img"), { recursive: true, filter: (f) => !path.basename(f).startsWith(".") });
}

function main() {
  const i = process.argv.indexOf("--out");
  const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(ROOT, "build", "site"));
  buildSite(out);
  console.log(`Wrote the site to ${path.relative(process.cwd(), out) || "."}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
