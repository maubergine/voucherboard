// semantic-release config, run from the repository root (.github/workflows/release.yml).
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
        // Keep extension/manifest.json's version (and version_name, "X.Y.Z beta" pre-1.0) in step with
        // package.json, then build the Chrome and Firefox zips and SHA256SUMS for the release.
        // safari-release.yml adds the Safari zip later and rewrites SHA256SUMS.
        prepareCmd: "node scripts/set-manifest-version.mjs ${nextRelease.version} && npm run dist",
        // Tell the workflow a release happened, for the changes job's `needs.release.outputs`.
        publishCmd:
          'echo "released=true" >> "$GITHUB_OUTPUT" && echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"',
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["package.json", "package-lock.json", "extension/manifest.json", "CHANGELOG.md"],
        message: "chore(release): ${nextRelease.version} [skip ci]",
      },
    ],
    ["@semantic-release/github", { assets: ["dist/voucherboard-*.zip", "dist/SHA256SUMS"] }],
  ],
};
