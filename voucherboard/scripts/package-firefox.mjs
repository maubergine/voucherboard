// Builds dist/voucherboard-firefox-<version>.zip for addons.mozilla.org: the same files as the Chrome store zip,
// with the manifest from scripts/lib/firefox-manifest.mjs.
//   node scripts/package-firefox.mjs          the zip
//   node scripts/package-firefox.mjs --dir D  the same files unzipped in D, for web-ext lint and web-ext run
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { firefoxManifest } from "./lib/firefox-manifest.mjs";

const FILES = ["manifest.json", "src", "guide", "icons"];
const SKIP = /(^|\/)(\.DS_Store|README\.md)$/;
const manifest = firefoxManifest(JSON.parse(readFileSync("manifest.json", "utf8")));

function stage(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const f of FILES.slice(1)) cpSync(f, path.join(dir, f), { recursive: true, filter: (s) => !SKIP.test(s) });
}

const i = process.argv.indexOf("--dir");
if (i > 0) {
  const dir = path.resolve(process.argv[i + 1] || "dist/firefox");
  rmSync(dir, { recursive: true, force: true });
  stage(dir);
  console.log(path.relative(process.cwd(), dir));
} else {
  const out = path.resolve(`dist/voucherboard-firefox-${manifest.version}.zip`);
  mkdirSync("dist", { recursive: true });
  rmSync(out, { force: true });
  const tmp = mkdtempSync(path.join(tmpdir(), "vb-firefox-"));
  try {
    stage(tmp);
    execFileSync("zip", ["-qrX", out, ...FILES], { cwd: tmp, stdio: "inherit" });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(path.relative(process.cwd(), out));
}
