// Writes SHA256SUMS for every voucherboard-*.zip in a folder (default dist/), in sha256sum's format, so
// `sha256sum -c SHA256SUMS` (or `shasum -a 256 -c`) checks them. Every release carries one, covering all its zips.
//   node scripts/checksums.mjs [dir]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist"));
const zips = readdirSync(dir).filter((f) => /^voucherboard-.*\.zip$/.test(f)).sort();
if (!zips.length) { console.error(`No voucherboard-*.zip in ${dir}`); process.exit(1); }
const sums = zips.map((f) => `${createHash("sha256").update(readFileSync(path.join(dir, f))).digest("hex")}  ${f}`);
writeFileSync(path.join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(sums.join("\n"));
