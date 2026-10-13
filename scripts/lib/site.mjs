// The page shell every page of https://voucherboard.mariusrubin.com/ shares (built by render-pages.mjs, deployed by pages.yml):
// inline CSS only, light and dark, the same top bar and nav. Used by render-pages.mjs and render-guide.mjs.
export const SITE_URL = "https://voucherboard.mariusrubin.com/";

// Nav links, relative to the site root.
export const NAV = [["install.html", "Install"], ["guide/", "Guide"], ["support.html", "Support"], ["privacy.html", "Privacy"], ["accessibility.html", "Accessibility"]];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LIGHT = "--bg:#f6f8fb;--surface:#fff;--ink:#212121;--ink-blue:#1e3c83;--muted:#5b616b;--line:#d6dbe3;--accent:#2b4972;--accent-ink:#fff;--accent-soft:rgba(43,73,114,.08);--warn-soft:#fcf8e3;--warn-ink:#8a6d3b";
const DARK = "--bg:#151a24;--surface:#1c2331;--ink:#e7ebf3;--ink-blue:#9db4e8;--muted:#a7afc0;--line:#333d52;--accent:#7fa0e0;--accent-ink:#0c1220;--accent-soft:rgba(127,160,224,.12);--warn-soft:#3a3320;--warn-ink:#e8d089";

// base: the path from this page to the site root ("" or "../"). toc: a <nav class="toc"> to show beside the content.
export function shell({ title, description, body, source, base = "", toc = "" }) {
  const nav = NAV.map(([href, label]) => `<a href="${base}${href}">${label}</a>`).join("");
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ""}<style>
:root{${LIGHT}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
.top{background:var(--accent);color:var(--accent-ink)}
.top .in{max-width:${toc ? 960 : 760}px;margin:0 auto;padding:14px 16px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 18px}
.top a{color:inherit;text-decoration:none}
.top .brand{font-weight:700;font-size:18px;margin-right:auto}
.top nav{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14px}
.top nav a{opacity:.9}
.top nav a:hover{opacity:1;text-decoration:underline}
main{max-width:760px;margin:0 auto;padding:8px 16px 48px;min-width:0}
.wrap{max-width:960px;margin:0 auto;padding:0 16px 48px;display:grid;grid-template-columns:200px minmax(0,1fr);gap:32px;align-items:start}
.wrap main{max-width:none;margin:0;padding:8px 0 0}
@media (max-width:760px){.wrap{grid-template-columns:1fr;gap:0}}
.toc{position:sticky;top:16px;font-size:13.5px;padding-top:24px}
@media (max-width:760px){.toc{position:static}}
.toc b{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-size:11px;margin-bottom:8px}
.toc ul{list-style:none;margin:0;padding:0}
.toc>ul>li{margin-bottom:6px}
.toc ul ul{padding-left:14px;margin-top:4px}
.toc a{text-decoration:none}
.toc a:hover{text-decoration:underline}
h1{color:var(--ink-blue);font-size:26px;margin:16px 0 6px}
h2{color:var(--accent);font-size:20px;margin:32px 0 10px;padding-top:8px;border-top:1px solid var(--line)}
h3{color:var(--ink-blue);font-size:17px;margin:22px 0 8px}
a{color:var(--ink-blue)}
ul,ol{padding-left:22px}
li{margin:4px 0}
code{background:var(--accent-soft);border-radius:4px;padding:1px 5px;font-size:.9em;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
blockquote.note{margin:14px 0;padding:10px 14px;background:var(--warn-soft);color:var(--warn-ink);border-radius:6px;border-left:3px solid var(--warn-ink)}
blockquote.note p{margin:0}
.tblwrap{overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
p.fig{margin:14px 0}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block;box-shadow:0 6px 18px -10px rgba(20,30,60,.35)}
footer{max-width:${toc ? 960 : 760}px;margin:0 auto;padding:0 16px 40px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<div class="top"><div class="in"><a class="brand" href="${base || "./"}">Voucherboard</a><nav aria-label="Site">${nav}</nav></div></div>
${toc ? `<div class="wrap">\n${toc}\n<main>\n${body}\n</main>\n</div>` : `<main>\n${body}\n</main>`}
<footer>Generated from <code>${esc(source)}</code>. Don't edit the HTML: edit the source and rerun the script.</footer>
</body>
</html>
`;
}
