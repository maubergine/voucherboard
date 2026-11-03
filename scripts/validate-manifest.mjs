// Fails CI if manifest.json isn't valid JSON, has a version_name (package.mjs adds it), or breaks a Chrome or Chrome
// Web Store rule (scripts/lib/chrome-manifest.mjs). Its version is Chrome's, which release-please keeps.
import { readFileSync } from "node:fs";
import { validateManifest } from "./lib/chrome-manifest.mjs";

let manifestRaw;
try {
  manifestRaw = readFileSync("extension/manifest.json", "utf8");
} catch (err) {
  console.error(`Cannot read manifest.json: ${err.message}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (err) {
  console.error(`manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

if ("version_name" in manifest) {
  console.error(`manifest.json has version_name "${manifest.version_name}": remove it, npm run package adds "<version> beta"`);
  process.exit(1);
}

// "key" stays in the repo manifest for unpacked installs; npm run package strips it from the store zip.
const STRIPPED_KEY = "key: remove before uploading to the Chrome Web Store";
const { errors, warnings } = validateManifest(manifest, { rootDir: "extension" });
for (const w of warnings) if (w !== STRIPPED_KEY) console.warn(`manifest.json warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`manifest.json: ${e}`);
  process.exit(1);
}

console.log(`manifest.json OK: version ${manifest.version}`);
