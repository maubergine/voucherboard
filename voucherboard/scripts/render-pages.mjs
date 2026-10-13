#!/usr/bin/env node
// Renders PRIVACY.md, SUPPORT.md and ACCESSIBILITY.md (the sources of truth) into docs/, which GitHub
// Pages serves at https://voucherboard.mariusrubin.com/. The App Store listing links to these pages. Uses the guide's
// renderer and the site's shared shell; the guide itself (docs/guide/) is rendered by render-guide.mjs.
//
// Usage:
//   node scripts/render-pages.mjs          # writes docs/index.html, privacy.html, support.html, accessibility.html
//   node scripts/render-pages.mjs --check  # exits 1 if any page is out of date, writes nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./render-guide.mjs";
import { shell } from "./lib/site.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const DOCS = path.join(ROOT, "docs");

// Repo-relative links in the sources point at the other page, not the Markdown file.
const LINKS = { "PRIVACY.md": "privacy.html", "SUPPORT.md": "support.html", "ACCESSIBILITY.md": "accessibility.html" };
const INDEX_MD = `# Voucherboard

A free planner for Lewisham's visitor parking permit site, for iPhone and as a browser extension. It's an independent
app by Marius Rubin, an individual developer, and isn't made or endorsed by Lewisham Council or its suppliers.

- [Guide](guide/): how to use the browser extension
- [Privacy policy](PRIVACY.md)
- [Support](SUPPORT.md)
- [Accessibility statement](ACCESSIBILITY.md)
`;

function page(md, source) {
  const fixed = md.replace(/\]\((PRIVACY|SUPPORT|ACCESSIBILITY)\.md(#[^)]*)?\)/g, (_, f, hash) => `](${LINKS[f + ".md"]}${hash || ""})`)
    .replace(/\]\(docs\/guide\/README\.md(#[^)]*)?\)/g, (_, hash) => `](guide/${hash || ""})`);
  const { html } = renderMarkdown(fixed);
  const title = (/^#\s+(.+)$/m.exec(md) || [, "Voucherboard"])[1];
  return shell({ title, body: html, source });
}

export function renderPages() {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  return {
    "index.html": page(INDEX_MD, "scripts/render-pages.mjs"),
    "privacy.html": page(read("PRIVACY.md"), "PRIVACY.md"),
    "support.html": page(read("SUPPORT.md"), "SUPPORT.md"),
    "accessibility.html": page(read("ACCESSIBILITY.md"), "ACCESSIBILITY.md"),
    ".nojekyll": ""
  };
}

function main() {
  const check = process.argv.includes("--check");
  const pages = renderPages();
  const stale = Object.entries(pages).filter(([f, s]) => (fs.existsSync(path.join(DOCS, f)) ? fs.readFileSync(path.join(DOCS, f), "utf8") : null) !== s);
  if (check) {
    if (stale.length) {
      console.error(`docs/${stale.map(([f]) => f).join(", docs/")} out of date. Run: node scripts/render-pages.mjs`);
      process.exit(1);
    }
    console.log("docs/ pages are up to date.");
    return;
  }
  for (const [f, s] of Object.entries(pages)) fs.writeFileSync(path.join(DOCS, f), s);
  console.log(`Wrote ${Object.keys(pages).length} files to ${DOCS}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
