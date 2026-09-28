// semantic-release config. Run with cwd = voucherboard/ (see .github/workflows/release.yml):
// the git repo root is one directory up, but git commands resolve fine from a subdirectory,
// and every relative asset path below (package.json, manifest.json, CHANGELOG.md, dist/*.zip)
// is relative to this directory, which is what we want.
//
// First release: tag v0.1.0 on main (see docs/RELEASING.md) so semantic-release continues
// versioning from the version already shipped, instead of starting over at 1.0.0.
module.exports = {
  branches: ["main"],
  repositoryUrl: "https://github.com/maubergine/voucherboard.git",
  tagFormat: "v${version}",
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    ["@semantic-release/npm", { npmPublish: false }],
    [
      "@semantic-release/exec",
      {
        // Keep manifest.json's version (and version_name, "X.Y.Z beta" pre-1.0) in step with
        // package.json, then rebuild the release zip so dist/*.zip matches the new version.
        prepareCmd: "node scripts/set-manifest-version.mjs ${nextRelease.version} && npm run package",
        // Tell the workflow a release happened, for the Chrome Web Store job's `needs.release.outputs`.
        publishCmd:
          'echo "released=true" >> "$GITHUB_OUTPUT" && echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"',
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["package.json", "package-lock.json", "manifest.json", "CHANGELOG.md"],
        message: "chore(release): ${nextRelease.version} [skip ci]",
      },
    ],
    ["@semantic-release/github", { assets: ["dist/*.zip"] }],
  ],
};
