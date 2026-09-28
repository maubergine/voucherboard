// Builds two zips, each containing only what the browser needs:
//   dist/voucherboard-<version>.zip           manifest at the root, for the Chrome Web Store
//   dist/voucherboard-<version>-unpacked.zip  a voucherboard/ folder, to unzip and "Load unpacked"
import { readFileSync, mkdirSync, rmSync, mkdtempSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const FILES = ["manifest.json", "src", "guide", "icons"];
const EXCLUDE = ["-x", "*.DS_Store", "*/README.md"];
const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const store = path.resolve(`dist/voucherboard-${version}.zip`), unpacked = path.resolve(`dist/voucherboard-${version}-unpacked.zip`);
mkdirSync("dist", { recursive: true });
for (const f of [store, unpacked]) rmSync(f, { force: true });

execFileSync("zip", ["-qr", store, ...FILES, ...EXCLUDE], { stdio: "inherit" });

// Zip through a symlink named voucherboard, so every entry sits under voucherboard/.
const tmp = mkdtempSync(path.join(tmpdir(), "vb-pack-"));
try {
  symlinkSync(process.cwd(), path.join(tmp, "voucherboard"), "dir");
  execFileSync("zip", ["-qr", unpacked, ...FILES.map((f) => `voucherboard/${f}`), ...EXCLUDE], { cwd: tmp, stdio: "inherit" });
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log(path.relative(process.cwd(), store));
console.log(path.relative(process.cwd(), unpacked));
