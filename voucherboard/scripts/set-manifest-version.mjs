// Called by semantic-release (release.config.cjs, @semantic-release/exec prepareCmd)
// with the next release version, e.g.: node scripts/set-manifest-version.mjs 0.2.0
// Sets manifest.json's version and version_name. version_name stays "<version> beta"
// while the extension is pre-1.0; drop the " beta" suffix once it ships out of beta.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: set-manifest-version.mjs <version>");
  process.exit(1);
}

const path = "manifest.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.version = version;
manifest.version_name = `${version} beta`;
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json set to ${version} (${manifest.version_name})`);
