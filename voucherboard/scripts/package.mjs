// Builds dist/voucherboard-<version>.zip containing only what the browser needs.
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const out = `dist/voucherboard-${version}.zip`;
mkdirSync("dist", { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-qr", out, "manifest.json", "src", "guide", "icons"], { stdio: "inherit" });
console.log(out);
