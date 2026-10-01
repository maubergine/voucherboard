// Fails CI if manifest.json isn't valid JSON, its version drifts from package.json, or it breaks
// a Chrome or Chrome Web Store rule (scripts/lib/chrome-manifest.mjs).
import { readFileSync } from "node:fs";
import { validateManifest } from "./lib/chrome-manifest.mjs";

let manifestRaw;
try {
  manifestRaw = readFileSync("manifest.json", "utf8");
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

const { version: pkgVersion } = JSON.parse(readFileSync("package.json", "utf8"));

if (manifest.version !== pkgVersion) {
  console.error(`manifest.json version "${manifest.version}" does not match package.json version "${pkgVersion}"`);
  process.exit(1);
}

if (!manifest.version_name || !manifest.version_name.startsWith(manifest.version)) {
  console.error(`manifest.json version_name "${manifest.version_name}" does not start with version "${manifest.version}"`);
  process.exit(1);
}

// "key" stays in the repo manifest for unpacked installs; npm run package strips it from the store zip.
const STRIPPED_KEY = "key: remove before uploading to the Chrome Web Store";
const { errors, warnings } = validateManifest(manifest, { rootDir: "." });
for (const w of warnings) if (w !== STRIPPED_KEY) console.warn(`manifest.json warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`manifest.json: ${e}`);
  process.exit(1);
}

console.log(`manifest.json OK: version ${manifest.version} (${manifest.version_name})`);
