// Firefox build: the manifest made at package time (scripts/lib/firefox-manifest.mjs), the staged files
// (scripts/package-firefox.mjs), the chrome.* APIs src uses, and the AMO workflow's no-submit rule.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REPO = path.join(ROOT, "..");
const chromeManifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
let lib, amo;
test.before(async () => {
  lib = await import("../scripts/lib/firefox-manifest.mjs");
  amo = await import("../scripts/amo-validate.mjs");
});

test("the Firefox manifest drops Chrome-only keys and adds the gecko settings", () => {
  const c = chromeManifest(), f = lib.firefoxManifest(c);
  assert.equal(f.key, undefined);
  assert.equal(f.version_name, undefined);
  assert.ok(c.key, "the Chrome manifest is left alone");
  assert.equal(c.browser_specific_settings, undefined);
  assert.deepEqual(f.browser_specific_settings, {
    gecko: { id: "voucherboard@mariusrubin.com", strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
    gecko_android: { strict_min_version: "142.0" },
  });
  const { key, version_name, ...rest } = c;
  const { browser_specific_settings, ...same } = f;
  assert.deepEqual(same, rest, "everything else is Chrome's manifest as is");
});

test("the Firefox manifest has nothing Firefox MV3 can't load", () => {
  const f = lib.firefoxManifest(chromeManifest());
  assert.equal(f.manifest_version, 3);
  assert.match(f.version, /^\d+\.\d+\.\d+$/);
  for (const k of ["background", "host_permissions", "optional_host_permissions", "externally_connectable", "update_url", "minimum_chrome_version"])
    assert.equal(f[k], undefined, k);
  assert.deepEqual(f.permissions, ["storage"]);
  // The content script's matches are its host permissions; payment and account pages stay excluded.
  const [cs] = f.content_scripts;
  assert.deepEqual(cs.matches, ["https://parkingpermits.lewisham.gov.uk/*"]);
  for (const p of ["PermitPayment", "VoucherBuyAgain", "Account"]) assert.ok(cs.exclude_matches.some((m) => m.includes(`/${p}/`)), p);
  for (const w of f.web_accessible_resources) assert.equal(w.use_dynamic_url, undefined);
  // Built-in data consent needs 140 on desktop and 142 on Android.
  const g = f.browser_specific_settings;
  assert.ok(parseFloat(g.gecko.strict_min_version) >= 140);
  assert.ok(parseFloat(g.gecko_android.strict_min_version) >= 142);
});

test("src uses only chrome.* APIs that Firefox supports with promises in MV3", () => {
  const ok = new Set(["chrome.storage.local.get", "chrome.storage.local.set", "chrome.storage.local.remove", "chrome.runtime.getURL", "chrome.runtime.getManifest"]);
  const used = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, "src")).filter((n) => n.endsWith(".js")))
    for (const m of fs.readFileSync(path.join(ROOT, "src", f), "utf8").matchAll(/\bchrome\.[\w.]+/g)) used.add(m[0]);
  assert.ok(used.size > 0);
  assert.deepEqual([...used].filter((a) => !ok.has(a)), []);
});

test("package-firefox.mjs stages the Chrome zip's files with the Firefox manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-ff-"));
  try {
    execFileSync(process.execPath, ["scripts/package-firefox.mjs", "--dir", dir], { cwd: ROOT, stdio: "pipe" });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")), lib.firefoxManifest(chromeManifest()));
    assert.deepEqual(fs.readdirSync(dir).sort(), ["guide", "icons", "manifest.json", "src"]);
    const f = lib.firefoxManifest(chromeManifest());
    for (const js of f.content_scripts[0].js) assert.ok(fs.existsSync(path.join(dir, js)), js);
    for (const i of Object.values(f.icons)) assert.ok(fs.existsSync(path.join(dir, i)), i);
    assert.ok(fs.existsSync(path.join(dir, "src/app.css")));
    assert.ok(fs.existsSync(path.join(dir, "guide/index.html")));
    assert.equal(fs.existsSync(path.join(dir, "guide/README.md")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AMO's JWT is HS256 over iss, jti, iat and a short exp", () => {
  const t = amo.jwt("user:1:2", "s3cret", 1000);
  const [h, p, sig] = t.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "HS256", typ: "JWT" });
  const body = JSON.parse(Buffer.from(p, "base64url"));
  assert.equal(body.iss, "user:1:2");
  assert.equal(body.iat, 1000);
  assert.ok(body.exp > 1000 && body.exp <= 1300);
  assert.ok(body.jti && body.jti !== JSON.parse(Buffer.from(amo.jwt("user:1:2", "s3cret", 1000).split(".")[1], "base64url")).jti);
  assert.equal(sig, require("node:crypto").createHmac("sha256", "s3cret").update(`${h}.${p}`).digest("base64url"));
});

test("CI never creates an AMO version or submits for review", () => {
  const wf = fs.readFileSync(path.join(REPO, ".github/workflows/firefox-amo.yml"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "scripts/amo-validate.mjs"), "utf8");
  for (const s of [wf, script]) {
    assert.doesNotMatch(s, /web-ext sign|--channel|\/versions\//);
  }
  assert.match(script, /addons\/upload\//);
  assert.match(wf, /environment:\s*\n\s*name: firefox-amo/);
  const release = fs.readFileSync(path.join(REPO, ".github/workflows/release.yml"), "utf8");
  assert.match(release, /uses: \.\/\.github\/workflows\/firefox-amo\.yml/);
});
