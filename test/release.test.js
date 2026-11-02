// Per-platform releases: release-please-config.json, the paths each platform's release counts
// (scripts/lib/release-paths.mjs), the TestFlight opt-out, and the store workflows' "already sent" check
// (scripts/lib/deployed.mjs). No network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CommitSplit } = require("release-please/build/src/util/commit-split");
const { CommitExclude } = require("release-please/build/src/util/commit-exclude");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const config = JSON.parse(read("release-please-config.json"));
const manifest = JSON.parse(read(".release-please-manifest.json"));
let lib, dep;
test.before(async () => {
  lib = await import("../scripts/lib/release-paths.mjs");
  dep = await import("../scripts/lib/deployed.mjs");
});

test("four platforms, each released on its own, as <platform>-v<version>, through approved pull requests", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(config.packages).map(([p, c]) => [c.component, p])),
    { chrome: "extension", firefox: "apps/firefox", safari: "apps/safari", ios: "apps/mobile/ios" });
  assert.deepEqual(Object.keys(manifest).sort(), Object.keys(config.packages).sort());
  assert.equal(config["separate-pull-requests"], true);
  assert.equal(config["include-component-in-tag"], true);
  assert.equal(config["tag-separator"], "-");
  assert.equal(config["include-v-in-tag"], true);
  assert.match(config["bootstrap-sha"], /^f3dc7ef[0-9a-f]{33}$/, "chore(release): 0.13.2");
});

test("each platform's version file holds its manifest version", () => {
  assert.equal(JSON.parse(read("extension/manifest.json")).version, manifest.extension);
  assert.equal(JSON.parse(read("apps/firefox/version.json")).version, manifest["apps/firefox"]);
  assert.equal(lib.marketingVersion(read("apps/safari/project.yml")), manifest["apps/safari"]);
  assert.equal(lib.marketingVersion(read("apps/mobile/ios/project.yml")), manifest["apps/mobile/ios"]);
  for (const f of ["apps/safari/project.yml", "apps/mobile/ios/project.yml"])
    assert.match(read(f), /^ {4}MARKETING_VERSION: "[\d.]+" # x-release-please-version$/m, f);
});

test("every platform starts at 0.13.2, the last shared version, with no version forced", () => {
  assert.deepEqual(new Set(Object.values(manifest)), new Set(["0.13.2"]));
  for (const c of Object.values(config.packages)) assert.equal(c["release-as"], undefined, c.component);
});

test("iOS counts the shared mobile code and exactly the extension/src files the app ships: engine.html's and the council view's", () => {
  const html = read("apps/mobile/www/engine.html");
  const engine = [...html.matchAll(/<script src="core\/(\w+)\.js">/g)].map((m) => m[1]);
  const yml = read("apps/mobile/ios/project.yml");
  const copied = /for f in ([\w ]+); do/.exec(yml)[1].split(" ");
  const council = [...yml.matchAll(/\$SRC\/(\w+)\.js"/g)].map((m) => m[1]);
  assert.ok(engine.length > 5);
  assert.deepEqual([...copied].sort(), [...engine].sort(), "project.yml copies what engine.html loads");
  assert.deepEqual(council, ["buyfill"]);
  const want = [...engine, ...council].map((f) => `extension/src/${f}.js`).sort();
  const extra = config.packages["apps/mobile/ios"]["additional-paths"];
  assert.deepEqual(extra.filter((p) => p.startsWith("apps/")), ["apps/mobile/www", "apps/mobile/council"]);
  assert.deepEqual(extra.filter((p) => !p.startsWith("apps/")).sort(), want);
});

test("each file counts for the platforms that ship it", () => {
  const owners = (f) => lib.owners(f, config).sort();
  assert.deepEqual(owners("extension/src/zones.js"), ["chrome", "firefox", "ios", "safari"]);
  assert.deepEqual(owners("extension/src/app.js"), ["chrome", "firefox", "safari"]);
  assert.deepEqual(owners("extension/guide/README.md"), ["chrome", "firefox", "safari"]);
  assert.deepEqual(owners("extension/manifest.json"), ["chrome", "firefox", "safari"]);
  assert.deepEqual(owners("scripts/package.mjs"), ["chrome"]);
  assert.deepEqual(owners("scripts/lib/firefox-manifest.mjs"), ["firefox"]);
  assert.deepEqual(owners("apps/safari/extension.sh"), ["safari"]);
  assert.deepEqual(owners("apps/mobile/www/engine.js"), ["ios"]);
  assert.deepEqual(owners("apps/mobile/council/council.js"), ["ios"]);
  assert.deepEqual(owners("apps/mobile/android/app/build.gradle.kts"), [], "Android will be its own package");
  assert.deepEqual(owners("apps/mobile/BRIDGE.md"), []);
  assert.deepEqual(owners("apps/mobile/ios/AppStore/metadata/en-GB/description.txt"), []);
});

test("Dependabot's files release nothing: the root lockfile is dev-only, and workflows ship in no artefact", () => {
  for (const f of ["package.json", "package-lock.json", ".github/workflows/ci.yml", ".github/dependabot.yml", ".github/actions/setup-xcode/action.yml"])
    assert.deepEqual(lib.owners(f, config), [], f);
  const dependabot = read(".github/dependabot.yml");
  assert.deepEqual([...dependabot.matchAll(/package-ecosystem: ([\w-]+)/g)].map((m) => m[1]).sort(), ["github-actions", "npm"]);
  assert.deepEqual([...dependabot.matchAll(/directory: (\S+)/g)].map((m) => m[1]), ["/", "/"]);
});

// release-please's own split and exclude, on the files scripts/release-please.mjs hands it.
const split = (files) => {
  const commit = { sha: "x", message: "fix: x", files: lib.withAdditional(files, config) };
  const paths = Object.keys(config.packages);
  const by = new CommitSplit({ includeEmpty: true, packagePaths: paths }).split([commit]);
  for (const p of paths) by[p] = by[p] || [];
  const kept = new CommitExclude(Object.fromEntries(Object.entries(config.packages).map(([p, c]) => [p, { excludePaths: c["exclude-paths"] }]))).excludeCommits(by);
  return Object.entries(kept).filter(([, c]) => c.length).map(([p]) => config.packages[p].component).sort();
};

test("release-please counts a commit for every platform its files belong to", () => {
  assert.deepEqual(split(["extension/src/planner.js", "test/planner.test.js"]), ["chrome", "firefox", "ios", "safari"]);
  assert.deepEqual(split(["extension/src/app.js"]), ["chrome", "firefox", "safari"]);
  assert.deepEqual(split(["apps/mobile/ios/AppStore/metadata/en-GB/description.txt"]), []);
  assert.deepEqual(split(["apps/mobile/ios/AppStore/notes.txt", "apps/mobile/www/views.js"]), ["ios"]);
  assert.deepEqual(split(["apps/mobile/ios/Voucherboard/App/AppModel.swift"]), ["ios"]);
  assert.deepEqual(split(["apps/mobile/android/app/build.gradle.kts"]), []);
  assert.deepEqual(split(["package-lock.json", "package.json"]), []);
  assert.deepEqual(split(["scripts/lib/firefox-manifest.mjs"]), ["firefox"]);
  assert.deepEqual(lib.withAdditional(["README.md"], config), ["README.md"], "unchanged when nothing is shared");
});

test("a push opts out of its TestFlight build with [skip testflight]", () => {
  assert.ok(lib.SKIP_TESTFLIGHT.test("fix(ios): wording\n\n[skip testflight]"));
  assert.ok(lib.SKIP_TESTFLIGHT.test("chore: x [Skip TestFlight]"));
  assert.ok(!lib.SKIP_TESTFLIGHT.test("fix(ios): skip testflight builds"));
  assert.equal(lib.releaseBranch("ios"), "release-please--branches--main--components--ios");
});

test("a store is only sent a release once: the newest success at its URL", () => {
  const url = "https://github.com/maubergine/voucherboard/releases/tag/chrome-v0.14.0";
  const statuses = { 3: { state: "failure", environment_url: url }, 2: { state: "success", environment_url: url.replace("0.14.0", "0.13.3") }, 1: { state: "success", environment_url: url } };
  const ds = [{ id: 3 }, { id: 2 }, { id: 1 }];
  assert.equal(dep.deployedAt(ds, (d) => statuses[d.id], url).id, 1);
  assert.equal(dep.deployedAt(ds.slice(0, 2), (d) => statuses[d.id], url), null);
  assert.equal(dep.deployedAt([{ id: 4 }], () => undefined, url), null, "no status yet");
  assert.equal(dep.deployedAt(undefined, () => undefined, url), null);
});
