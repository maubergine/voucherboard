#!/usr/bin/env node
// Renders guide/README.md (the source of truth) into guide/index.html: a single self-contained page,
// styled to match src/app.css, with a generated table of contents. No dependencies, no network.
//
// Usage:
//   node scripts/render-guide.mjs          # writes guide/index.html
//   node scripts/render-guide.mjs --check  # exits 1 if index.html is out of date, writes nothing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
export const GUIDE_DIR = path.join(REPO, "guide");
export const SOURCE_MD = path.join(GUIDE_DIR, "README.md");
export const OUTPUT_HTML = path.join(GUIDE_DIR, "index.html");

// ---------- inline markdown (within a line/paragraph): code, images, links, bold, italic ----------
// Escapes for safe HTML text, but leaves an already-valid entity (e.g. "&lt;" typed straight into the
// markdown source) alone, so it isn't double-escaped into "&amp;lt;".
function escHtml(s) {
  return String(s)
    .replace(/&(?!(?:amp|lt|gt|quot|#39|#x27|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function inline(raw) {
  // Protect code spans first (on the RAW text), so `**not bold**` inside code stays literal, and its
  // content is escaped exactly once, below, when it's put back.
  const codeStash = [];
  let s = raw.replace(/`([^`]+)`/g, (_, code) => { codeStash.push(code); return `\u0000${codeStash.length - 1}\u0000`; });

  s = escHtml(s);

  // Images: ![alt](src)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);

  // Links: [text](href) — external http(s) links open in a new tab; in-page #anchors don't.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const external = /^https?:\/\//i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
  });

  // Bold, then italic (bold's ** consumed first so *italic* doesn't misfire on it).
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escHtml(codeStash[+i])}</code>`);
  return s;
}

// ---------- block-level markdown ----------
function isTableSep(line) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line); }
function splitRow(line) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()); }
function isImageOnlyLine(line) { return /^!\[[^\]]*\]\([^)\s]+\)$/.test(line.trim()); }

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const toc = []; // { level, id, text }
  const out = [];
  const used = new Set();
  const uniqueId = (base) => { let id = base || "section", n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Heading
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      const level = h[1].length, text = h[2];
      const id = uniqueId(slugify(text));
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      if (level >= 2 && level <= 3) toc.push({ level, id, text: inline(text) });
      i++; continue;
    }

    // Blockquote note: consecutive lines starting with ">"
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote class="note"><p>${buf.map(inline).join(" ")}</p></blockquote>`);
      continue;
    }

    // Table: a "| ... |" row immediately followed by a separator row
    if (line.includes("|") && lines[i + 1] && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows.push(splitRow(lines[i])); i++; }
      out.push('<div class="tblwrap"><table>');
      out.push("<thead><tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead>");
      out.push("<tbody>" + rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody>");
      out.push("</table></div>");
      continue;
    }

    // A soft-wrapped continuation line: not blank, and not the start of any other block type.
    const isContinuation = (l) => l.trim() && !/^(#{1,6})\s/.test(l) && !/^[-*]\s+/.test(l) && !/^\d+\.\s+/.test(l) && !/^>\s?/.test(l);

    // Unordered list (items may wrap onto following, unmarked lines — same rule commonmark uses)
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || (items.length && isContinuation(lines[i])))) {
        if (/^[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^[-*]\s+/, "").trim());
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push("<ul>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>");
      continue;
    }

    // Ordered list (same wrapping rule). Each item keeps its own source number via a "value" attribute,
    // since a "loose" list — one whose items are separated by other blocks, such as a screenshot after
    // each step — renders here as several single-item <ol>s rather than one continuous list.
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\d+\.\s+/.test(lines[i]) || (items.length && isContinuation(lines[i])))) {
        const m = /^(\d+)\.\s+(.*)$/.exec(lines[i]);
        if (m) items.push({ n: +m[1], text: m[2].trim() });
        else items[items.length - 1].text += " " + lines[i].trim();
        i++;
      }
      out.push("<ol>" + items.map((it) => `<li value="${it.n}">${inline(it.text)}</li>`).join("") + "</ol>");
      continue;
    }

    // Paragraph: consecutive non-blank, non-special lines. A block of only images renders as stacked figures.
    const buf = [];
    while (i < lines.length && isContinuation(lines[i])) { buf.push(lines[i].trim()); i++; }
    if (buf.every(isImageOnlyLine)) {
      out.push(buf.map((l) => `<p class="fig">${inline(l)}</p>`).join(""));
    } else {
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
  }

  return { html: out.join("\n"), toc };
}

function tocHtml(toc) {
  // Nest h3s under the preceding h2.
  let html = '<nav class="toc" aria-label="Table of contents"><b>Contents</b><ul>';
  let openSub = false;
  for (const item of toc) {
    if (item.level === 2) {
      if (openSub) { html += "</ul></li>"; openSub = false; }
      html += `<li><a href="#${item.id}">${item.text}</a>`;
    } else {
      if (!openSub) { html += "<ul>"; openSub = true; }
      html += `<li><a href="#${item.id}">${item.text}</a></li>`;
    }
  }
  if (openSub) html += "</ul></li>";
  html += "</ul></nav>";
  return html;
}

// ---------- page shell: inline CSS only, tokens from src/app.css, light + dark ----------
function pageHtml(bodyHtml, tocNav, title) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<meta name="description" content="How to use Voucherboard: a beta visitor-voucher planner for Lewisham's parking permit site.">
<style>
:root{
  --bg:#f6f8fb; --surface:#ffffff; --ink:#212121; --ink-blue:#1e3c83; --muted:#5b616b;
  --line:#d6dbe3; --accent:#2b4972; --accent-dark:#202c53; --accent-ink:#ffffff; --accent-soft:rgba(43,73,114,.08);
  --warn-soft:#fcf8e3; --warn-ink:#8a6d3b;
  --f-body:"Nunito Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#151a24; --surface:#1c2331; --ink:#e7ebf3; --ink-blue:#9db4e8; --muted:#a7afc0;
    --line:#333d52; --accent:#7fa0e0; --accent-dark:#5f80c4; --accent-ink:#0c1220; --accent-soft:rgba(127,160,224,.12);
    --warn-soft:#3a3320; --warn-ink:#e8d089;
  }
}
:root[data-theme="dark"]{
  --bg:#151a24; --surface:#1c2331; --ink:#e7ebf3; --ink-blue:#9db4e8; --muted:#a7afc0;
  --line:#333d52; --accent:#7fa0e0; --accent-dark:#5f80c4; --accent-ink:#0c1220; --accent-soft:rgba(127,160,224,.12);
  --warn-soft:#3a3320; --warn-ink:#e8d089;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--f-body);-webkit-text-size-adjust:100%}
.top{background:var(--accent);color:var(--accent-ink)}
.top .in{max-width:900px;margin:0 auto;padding:18px 20px}
.top b{font-size:20px}
.top span{display:block;opacity:.85;font-size:13px;margin-top:2px}
.wrap{max-width:900px;margin:0 auto;padding:0 20px 60px;display:grid;grid-template-columns:200px minmax(0,1fr);gap:32px;align-items:start}
@media (max-width:760px){.wrap{grid-template-columns:1fr;padding:0 16px 48px}}
.toc{position:sticky;top:16px;font-size:13.5px;padding-top:24px}
.toc b{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-size:11px;margin-bottom:8px}
.toc ul{list-style:none;margin:0;padding:0}
.toc>ul>li{margin-bottom:6px}
.toc ul ul{padding-left:14px;margin-top:4px}
.toc a{color:var(--ink-blue);text-decoration:none}
.toc a:hover{text-decoration:underline}
main{min-width:0;padding-top:24px}
h1{color:var(--ink-blue);font-size:26px;margin:0 0 6px}
h2{color:var(--accent);font-size:20px;margin:36px 0 10px;padding-top:8px;border-top:1px solid var(--line)}
h2:first-of-type{border-top:0}
h3{color:var(--ink-blue);font-size:16px;margin:22px 0 8px}
p{margin:10px 0}
ul,ol{margin:10px 0;padding-left:22px}
li{margin:4px 0}
a{color:var(--ink-blue)}
code{background:var(--accent-soft);border-radius:4px;padding:1px 5px;font-size:.9em;font-family:ui-monospace,Menlo,monospace}
strong{color:var(--ink)}
blockquote.note{margin:14px 0;padding:10px 14px;background:var(--warn-soft);color:var(--warn-ink);border-radius:6px;border-left:3px solid var(--warn-ink)}
blockquote.note p{margin:0}
.tblwrap{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
th{background:var(--accent-soft)}
p.fig{margin:14px 0}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block;box-shadow:0 6px 18px -10px rgba(20,30,60,.35)}
footer.end{max-width:900px;margin:0 auto;padding:24px 20px 48px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<div class="top"><div class="in"><b>Voucherboard guide</b><span>Beta &middot; an independent tool for Lewisham's visitor parking permits</span></div></div>
<div class="wrap">
${tocNav}
<main>
${bodyHtml}
</main>
</div>
<footer class="end">Generated from <code>guide/README.md</code> by <code>scripts/render-guide.mjs</code>. Don't edit this file directly — edit the source and rerun the script.</footer>
</body>
</html>
`;
}

export function render() {
  const md = fs.readFileSync(SOURCE_MD, "utf8");
  const { html, toc } = renderMarkdown(md);
  const titleMatch = /^#\s+(.+)$/m.exec(md);
  const title = titleMatch ? titleMatch[1] : "Voucherboard guide";
  return pageHtml(html, tocHtml(toc), title);
}

function main() {
  const check = process.argv.includes("--check");
  const rendered = render();
  if (check) {
    const current = fs.existsSync(OUTPUT_HTML) ? fs.readFileSync(OUTPUT_HTML, "utf8") : null;
    if (current !== rendered) {
      console.error("guide/index.html is out of date. Run: node scripts/render-guide.mjs");
      process.exit(1);
    }
    console.log("guide/index.html is up to date.");
    return;
  }
  fs.writeFileSync(OUTPUT_HTML, rendered);
  console.log("Wrote " + OUTPUT_HTML);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
