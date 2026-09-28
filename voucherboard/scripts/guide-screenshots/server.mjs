// Static file server for the guide-screenshot harness. No dependencies.
// Serves this folder (the harness pages and the fetch-stub script) plus the real src/*.js and the
// anonymised test/fixtures/*.html, so capture.mjs can drive a real Chrome tab against them. Nothing here
// talks to the real council site: harness-boot.js intercepts every council-shaped fetch client-side.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..", "..");
const PORT = process.env.PORT ? +process.env.PORT : 8891;

const ROOTS = [
  { prefix: "/fixtures/", dir: path.join(REPO, "test", "fixtures") },
  { prefix: "/src/", dir: path.join(REPO, "src") },
  { prefix: "/", dir: __dirname } // harness-boot.js, index.html, buy.html
];
const MIME = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(u.pathname);
    if (pathname === "/") pathname = "/index.html";
    for (const { prefix, dir } of ROOTS) {
      if (!pathname.startsWith(prefix)) continue;
      const rel = pathname.slice(prefix === "/" ? 1 : prefix.length);
      const file = path.join(dir, rel);
      if (!file.startsWith(dir)) break; // no escaping the root
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(fs.readFileSync(file));
        return;
      }
    }
    res.writeHead(404); res.end("not found: " + pathname);
  } catch (e) {
    res.writeHead(500); res.end("server error: " + (e && e.stack || e));
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`guide-screenshot harness on http://127.0.0.1:${PORT}`));
