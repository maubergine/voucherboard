// The Safari project (apps/safari/): it ships the same extension files the manifest lists, from extension/ itself, with
// its own version (MARKETING_VERSION, kept by release-please), and its app never calls itself a beta. The copy is run for real on macOS (it needs plutil).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REPO = path.join(__dirname, "..");
const ROOT = path.join(REPO, "extension");
const SAFARI = path.join(REPO, "apps", "safari");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const manifest = JSON.parse(read(ROOT, "manifest.json"));
const yml = read(SAFARI, "project.yml");
const script = read(SAFARI, "extension.sh");
const DIRS = /^DIRS="([^"]+)"/m.exec(script)[1].split(" ");

// Every path manifest.json refers to; globs become their folder.
function referenced(m) {
  const out = new Set(Object.values(m.icons || {}));
  for (const cs of m.content_scripts || []) for (const f of [...(cs.js || []), ...(cs.css || [])]) out.add(f);
  for (const w of m.web_accessible_resources || []) for (const r of w.resources) out.add(r.replace(/\/?\*.*$/, ""));
  const a = m.action || {};
  for (const i of typeof a.default_icon === "string" ? [a.default_icon] : Object.values(a.default_icon || {})) out.add(i);
  return [...out].map((f) => f.replace(/^\//, ""));
}

// path -> contents, for every file under dir, without README.md and .DS_Store.
function files(dir, base = dir, out = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, base, out);
    else if (e.name !== "README.md" && e.name !== ".DS_Store") out.set(path.relative(base, p), fs.readFileSync(p));
  }
  return out;
}

test("the copy takes the same folders as the Chrome package", () => {
  const pkg = /const FILES = \[([^\]]+)\]/.exec(read(REPO, "scripts", "package.mjs"))[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual([...DIRS].sort(), pkg.filter((f) => f !== "manifest.json").sort());
});

test("every file the manifest refers to is in a copied folder and exists", () => {
  const refs = referenced(manifest);
  assert.ok(refs.length > 10, "manifest refers to files");
  for (const f of refs) {
    assert.ok(DIRS.includes(f.split("/")[0]), `${f} isn't under ${DIRS.join(", ")}`);
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is missing`);
  }
});

const VERSION = /^ {4}MARKETING_VERSION: "(\d+\.\d+\.\d+)" # x-release-please-version$/m.exec(yml)?.[1];

test("the project copies the extension and has its own version, which release-please keeps", () => {
  assert.match(yml, /extension\.sh" copy "\$TARGET_BUILD_DIR\/\$UNLOCALIZED_RESOURCES_FOLDER_PATH"/);
  assert.ok(VERSION, "MARKETING_VERSION with release-please's marker");
  const config = JSON.parse(read(REPO, "release-please-config.json")).packages["apps/safari"];
  assert.strictEqual(config.component, "safari");
  assert.deepStrictEqual(config["extra-files"], [{ type: "generic", path: "project.yml" }]);
  assert.strictEqual(JSON.parse(read(REPO, ".release-please-manifest.json"))["apps/safari"], VERSION);
  const versions = yml.match(/CFBundleShortVersionString: (.+)/g);
  assert.deepStrictEqual(versions, ["CFBundleShortVersionString: $(MARKETING_VERSION)", "CFBundleShortVersionString: $(MARKETING_VERSION)"]);
  assert.doesNotMatch(yml, /VB_VERSION|INFOPLIST_PREPROCESS/, "nothing reads manifest.json's version");
  assert.ok(!fs.readdirSync(SAFARI).some((f) => ["manifest.json", ...DIRS].includes(f)), "no copies of the extension in safari/");
});

test("bundle ids are under com.mariusrubin.voucherboard and apart from the iOS app's", () => {
  const app = /APP_BUNDLE_ID: (\S+)/.exec(yml)[1], ext = /EXTENSION_BUNDLE_ID: (\S+)/.exec(yml)[1];
  assert.match(app, /^com\.mariusrubin\.voucherboard\./);
  assert.ok(ext.startsWith(`${app}.`), "the extension's id starts with the app's");
  const ios = /APP_BUNDLE_ID: (\S+)/.exec(read(REPO, "apps", "mobile", "ios", "project.yml"))[1];
  for (const id of [app, ext]) assert.ok(![ios, `${ios}.share`, `${ios}.live`].includes(id), id);
  assert.match(yml, /NSExtensionPointIdentifier: com\.apple\.Safari\.web-extension/);
  assert.match(yml, /ENABLE_HARDENED_RUNTIME: YES/);
  assert.strictEqual((yml.match(/com\.apple\.security\.app-sandbox: true/g) || []).length, 2);
});

test("the app never calls itself a beta", () => {
  for (const f of ["App/VoucherboardApp.swift", "project.yml"]) assert.doesNotMatch(read(SAFARI, f), /\bbeta\b/i, f);
});

test("CI builds on changes to anything the copy reads", () => {
  const wf = read(REPO, ".github", "workflows", "safari.yml");
  for (const p of ["apps/safari/**", "extension/manifest.json", ...DIRS.map((d) => `extension/${d}/**`)]) {
    assert.ok(wf.includes(`"${p}"`), `safari.yml paths miss ${p}`);
  }
});

test("the copy matches extension/, without Chrome's key and with Safari's version (macOS)", { skip: process.platform !== "darwin" && "needs plutil" }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vb-safari-"));
  try {
    const { MARKETING_VERSION, ...env } = process.env;
    execFileSync(path.join(SAFARI, "extension.sh"), ["copy", out], { env });
    const copied = JSON.parse(read(out, "manifest.json"));
    assert.ok(!("key" in copied), "key is stripped");
    const { key, ...rest } = manifest;
    assert.deepStrictEqual(copied, { ...rest, version: VERSION }, "Safari's version, for the update check");
    execFileSync(path.join(SAFARI, "extension.sh"), ["copy", out], { env: { ...env, MARKETING_VERSION: "9.8.7" } });
    assert.strictEqual(JSON.parse(read(out, "manifest.json")).version, "9.8.7", "Xcode's MARKETING_VERSION wins");
    for (const d of DIRS) {
      const a = files(path.join(ROOT, d)), b = files(path.join(out, d));
      assert.deepStrictEqual([...b.keys()].sort(), [...a.keys()].sort(), `${d}/ has the same files`);
      for (const [f, buf] of a) assert.ok(buf.equals(b.get(f)), `${d}/${f} is identical`);
    }
    for (const f of referenced(copied)) assert.ok(fs.existsSync(path.join(out, f)), `${f} is in the copy`);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
