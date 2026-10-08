#!/usr/bin/env node
// Renders PRIVACY.md and SUPPORT.md (the sources of truth) into docs/, which GitHub Pages serves at
// https://maubergine.github.io/voucherboard/. The App Store listing links to these pages. Uses the guide's renderer.
//
// Usage:
//   node scripts/render-pages.mjs          # writes docs/index.html, privacy.html, support.html
//   node scripts/render-pages.mjs --check  # exits 1 if any page is out of date, writes nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./render-guide.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const DOCS = path.join(ROOT, "docs");

// Repo-relative links in the sources point at the other page, not the Markdown file.
const LINKS = { "PRIVACY.md": "privacy.html", "SUPPORT.md": "support.html" };
const INDEX_MD = `# Voucherboard

A free planner for Lewisham's visitor parking permit site, for iPhone and as a browser extension. It's an independent
app by Marius Rubin, an individual developer, and isn't made or endorsed by Lewisham Council or its suppliers.

- [Privacy policy](PRIVACY.md)
- [Support](SUPPORT.md)
`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(md, source) {
  const fixed = md.replace(/\]\((PRIVACY|SUPPORT)\.md(#[^)]*)?\)/g, (_, f, hash) => `](${LINKS[f + ".md"]}${hash || ""})`);
  const { html } = renderMarkdown(fixed);
  const title = (/^#\s+(.+)$/m.exec(md) || [, "Voucherboard"])[1];
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f6f8fb;--surface:#fff;--ink:#212121;--ink-blue:#1e3c83;--muted:#5b616b;--line:#d6dbe3;--accent:#2b4972;--accent-ink:#fff;--accent-soft:rgba(43,73,114,.08)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#151a24;--surface:#1c2331;--ink:#e7ebf3;--ink-blue:#9db4e8;--muted:#a7afc0;--line:#333d52;--accent:#7fa0e0;--accent-ink:#0c1220;--accent-soft:rgba(127,160,224,.12)}}
:root[data-theme="dark"]{--bg:#151a24;--surface:#1c2331;--ink:#e7ebf3;--ink-blue:#9db4e8;--muted:#a7afc0;--line:#333d52;--accent:#7fa0e0;--accent-ink:#0c1220;--accent-soft:rgba(127,160,224,.12)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
.top{background:var(--accent);color:var(--accent-ink)}
.top a{color:inherit;text-decoration:none;font-weight:700}
.in{max-width:760px;margin:0 auto;padding:16px}
main{max-width:760px;margin:0 auto;padding:8px 16px 48px}
h1{color:var(--ink-blue);font-size:26px;margin:16px 0 6px}
h2{color:var(--accent);font-size:20px;margin:32px 0 10px;padding-top:8px;border-top:1px solid var(--line)}
h3{color:var(--ink-blue);font-size:17px;margin:22px 0 8px}
a{color:var(--ink-blue)}
ul,ol{padding-left:22px}
li{margin:4px 0}
code{background:var(--accent-soft);border-radius:4px;padding:1px 5px;font-size:.9em;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
.tblwrap{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
footer{max-width:760px;margin:0 auto;padding:0 16px 40px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<div class="top"><div class="in"><a href="./">Voucherboard</a></div></div>
<main>
${html}
</main>
<footer>Generated from <code>${esc(source)}</code>. <a href="privacy.html">Privacy</a> · <a href="support.html">Support</a></footer>
</body>
</html>
`;
}

export function renderPages() {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  return {
    "index.html": page(INDEX_MD, "scripts/render-pages.mjs"),
    "privacy.html": page(read("PRIVACY.md"), "PRIVACY.md"),
    "support.html": page(read("SUPPORT.md"), "SUPPORT.md"),
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
