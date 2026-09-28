// Fails CI if manifest.json isn't valid JSON or its version drifts from package.json.
import { readFileSync } from "node:fs";

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

console.log(`manifest.json OK: version ${manifest.version} (${manifest.version_name})`);
