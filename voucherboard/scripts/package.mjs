// Builds two zips, each containing only what the browser needs:
//   dist/voucherboard-<version>.zip           manifest at the root, for the Chrome Web Store
//   dist/voucherboard-<version>-unpacked.zip  a voucherboard/ folder, to unzip and "Load unpacked"
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const FILES = ["manifest.json", "src", "guide", "icons"];
const EXCLUDE = ["-x", "*.DS_Store", "*/README.md"];
const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const store = path.resolve(`dist/voucherboard-${version}.zip`), unpacked = path.resolve(`dist/voucherboard-${version}-unpacked.zip`);
mkdirSync("dist", { recursive: true });
for (const f of [store, unpacked]) rmSync(f, { force: true });

const tmp = mkdtempSync(path.join(tmpdir(), "vb-pack-"));
try {
  // The store zip drops "key": the Chrome Web Store rejects it and assigns the same id itself.
  // The unpacked zip keeps it, so the extension id (and its saved data) doesn't depend on the folder.
  const storeDir = path.join(tmp, "store");
  mkdirSync(storeDir);
  const { key, ...forStore } = JSON.parse(readFileSync("manifest.json", "utf8"));
  writeFileSync(path.join(storeDir, "manifest.json"), `${JSON.stringify(forStore, null, 2)}\n`);
  for (const f of FILES.slice(1)) symlinkSync(path.resolve(f), path.join(storeDir, f), "dir");
  execFileSync("zip", ["-qr", store, ...FILES, ...EXCLUDE], { cwd: storeDir, stdio: "inherit" });

  // Zip through a symlink named voucherboard, so every entry sits under voucherboard/.
  symlinkSync(process.cwd(), path.join(tmp, "voucherboard"), "dir");
  execFileSync("zip", ["-qr", unpacked, ...FILES.map((f) => `voucherboard/${f}`), ...EXCLUDE], { cwd: tmp, stdio: "inherit" });
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log(path.relative(process.cwd(), store));
console.log(path.relative(process.cwd(), unpacked));
