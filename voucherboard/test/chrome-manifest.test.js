// Generic Chrome manifest validator (scripts/lib/chrome-manifest.mjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let lib;
test.before(async () => { lib = await import("../scripts/lib/chrome-manifest.mjs"); });

const base = () => ({ manifest_version: 3, name: "Test", version: "1.0", description: "A test extension.", icons: { 128: "i.png" } });
const run = (extra, opts) => lib.validateManifest({ ...base(), ...extra }, opts);
const has = (list, re) => list.some((m) => re.test(m));
function bad(extra, re, opts) { const r = run(extra, opts); assert.ok(has(r.errors, re), `expected error ${re}, got ${JSON.stringify(r)}`); }
function warns(extra, re, opts) { const r = run(extra, opts); assert.ok(has(r.warnings, re), `expected warning ${re}, got ${JSON.stringify(r)}`); assert.deepEqual(r.errors, []); }
function ok(extra, opts) { const r = run(extra, opts); assert.deepEqual(r, { errors: [], warnings: [] }); }

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-manifest-"));
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  return dir;
}
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const mk = (files) => { const d = tree(files); dirs.push(d); return d; };

test("the project manifest has no errors", () => {
  const root = path.join(__dirname, "..");
  const r = lib.validateManifest(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")), { rootDir: root });
  assert.deepEqual(r.errors, []);
});

test("a minimal valid manifest is clean", () => ok({}));

test("rejects non-objects", () => {
  assert.match(lib.validateManifest(null).errors[0], /^manifest: must be a JSON object/);
  assert.match(lib.validateManifest([]).errors[0], /got array/);
});

test("required keys", () => {
  const r = lib.validateManifest({});
  for (const k of ["manifest_version", "name", "version"]) assert.ok(r.errors.includes(`${k}: is required`));
  assert.ok(has(r.errors, /^description: is required by the Chrome Web Store/));
  assert.ok(has(r.errors, /^icons: is required by the Chrome Web Store/));
});

test("manifest_version", () => {
  bad({ manifest_version: 2 }, /^manifest_version: Manifest V2 is no longer accepted/);
  bad({ manifest_version: "3" }, /^manifest_version: must be 3/);
  bad({ manifest_version: 4 }, /^manifest_version: must be 3/);
});

test("unknown and MV2-only top-level keys warn", () => {
  warns({ foo: 1 }, /^foo: unknown key/);
  warns({ browser_action: {} }, /^browser_action: is Manifest V2 only.*"action"/);
  warns({ page_action: {} }, /^page_action: is Manifest V2 only/);
  ok({ author: "Me", homepage_url: "https://example.com/" });
});

test("length limits", () => {
  ok({ name: "x".repeat(75), description: "d".repeat(132), short_name: "s".repeat(12) });
  bad({ name: "x".repeat(76) }, /^name: must be at most 75 characters \(it is 76\)/);
  bad({ description: "d".repeat(133) }, /^description: must be at most 132/);
  warns({ short_name: "s".repeat(13) }, /^short_name: must be at most 12/);
  bad({ name: "  " }, /^name: must not be empty/);
  bad({ name: 5 }, /^name: must be a string, got number/);
});

test("__MSG_ placeholders", () => {
  bad({ name: "__MSG_appName__" }, /^default_locale: is required when the manifest uses __MSG_/);
  ok({ name: "__MSG_appName__", default_locale: "en" }); // no rootDir: length check skipped
  const root = mk({ "i.png": "", "_locales/en/messages.json": JSON.stringify({ appName: { message: "x".repeat(80) }, Short: { message: "Fine" } }) });
  bad({ name: "__MSG_appName__", default_locale: "en" }, /^name: must be at most 75 characters \(it is 80\)/, { rootDir: root });
  ok({ name: "__MSG_short__", default_locale: "en" }, { rootDir: root }); // names are case-insensitive
  bad({ name: "__MSG_nope__", default_locale: "en" }, /^name: message "nope" is not defined/, { rootDir: root });
  bad({ default_locale: "fr" }, /^default_locale: _locales\/fr\/messages.json not found/, { rootDir: root });
  bad({}, /^default_locale: is required when a _locales directory exists/, { rootDir: root });
  bad({ default_locale: "en-GB" }, /^default_locale: invalid locale/);
  const broken = mk({ "i.png": "", "_locales/en/messages.json": "{" });
  bad({ default_locale: "en" }, /messages.json is not valid JSON/, { rootDir: broken });
});

test("version", () => {
  for (const v of ["1", "1.0", "2.10.2", "3.1.2.4567", "0.0.1", "65535"]) ok({ version: v });
  for (const v of ["", "1.0.0.0.0", "01", "1.032", "65536", "0", "0.0", "1.a", "1..2", "v1", " 1"]) bad({ version: v }, /^version: invalid version/);
  bad({ version: 1 }, /^version: must be a string/);
  ok({ version_name: "1.0 beta" });
  bad({ version_name: 1 }, /^version_name: must be a string/);
});

test("icons", () => {
  bad({ icons: { big: "i.png" } }, /^icons\.big: icon size must be a positive integer/);
  bad({ icons: "i.png" }, /^icons: must be an object/);
  bad({ icons: { 128: 5 } }, /^icons\.128: must be a string/);
  warns({ icons: { 128: "i.svg" } }, /^icons\.128: SVG icons are not supported/);
  warns({ icons: { 128: "i.webp" } }, /WEBP icons are not supported/);
  warns({ icons: { 128: "i.jpg" } }, /PNG is recommended/);
  warns({ icons: { 16: "i.png" } }, /^icons: should include a 128x128 icon/);
  bad({ icons: { 128: "https://x.com/i.png" } }, /must be a path inside the extension, not a URL/);
  bad({ icons: { 128: "../i.png" } }, /points outside the extension/);
});

test("action", () => {
  ok({ action: { default_icon: "i.png", default_title: "T", default_popup: "p.html" } });
  ok({ action: { default_icon: { 16: "a.png", 32: "b.png" } } });
  bad({ action: { default_title: 1 } }, /^action\.default_title: must be a string/);
  bad({ action: { default_icon: { x: "a.png" } } }, /^action\.default_icon\.x: icon size/);
  warns({ action: { popup: "p.html" } }, /^action\.popup: unknown key/);
  bad({ action: [] }, /^action: must be an object/);
});

test("background", () => {
  ok({ background: { service_worker: "sw.js", type: "module" } });
  bad({ background: { service_worker: "sw.js", type: "esm" } }, /^background\.type: must be one of/);
  bad({ background: { scripts: ["a.js"] } }, /^background\.scripts: is not supported in Manifest V3/);
  bad({ background: { page: "b.html" } }, /^background\.page: is not supported/);
  warns({ background: { service_worker: "sw.js", scripts: ["a.js"] } }, /^background\.scripts: is ignored/);
  warns({ background: { service_worker: "sw.js", persistent: false } }, /^background\.persistent: is Manifest V2 only/);
  bad({ background: { service_worker: "" } }, /^background\.service_worker: must not be empty/);
});

test("match patterns", () => {
  const e = lib.matchPatternError;
  for (const p of ["<all_urls>", "https://*/*", "https://*/foo*", "https://*.google.com/foo*bar", "file:///foo*", "http://127.0.0.1/*",
    "http://localhost/*", "*://mail.google.com/*", "http://example.com:8080/*", "http://*:*/*", "wss://example.com/*", "http://[::1]/*"]) assert.equal(e(p), null, p);
  for (const p of ["https://*.google.*/*", "https://foo.*.bar/*", "https://*foo/*", "http://example.com", "ftp://example.com/*",
    "chrome://newtab/*", "data:*", "example.com/*", "file://host/x", "http:///*", "http://example.com:99999/*", "http://ex ample.com/*", 5])
    assert.notEqual(e(p), null, String(p));
});

test("content_scripts", () => {
  const cs = (o) => ({ content_scripts: [{ matches: ["https://a.com/*"], js: ["a.js"], ...o }] });
  ok(cs({ css: ["a.css"], run_at: "document_start", world: "MAIN", all_frames: true, match_about_blank: true, include_globs: ["*a*"], exclude_matches: ["https://a.com/x/*"] }));
  bad({ content_scripts: [{ js: ["a.js"] }] }, /^content_scripts\[0\]\.matches: is required/);
  bad(cs({ matches: [] }), /^content_scripts\[0\]\.matches: must not be empty/);
  bad(cs({ matches: ["https://a.com/*", "https://*.a.*/*"] }), /^content_scripts\[0\]\.matches\[1\]: invalid match pattern "https:\/\/\*\.a\.\*\/\*"/);
  bad(cs({ exclude_matches: ["nope"] }), /^content_scripts\[0\]\.exclude_matches\[0\]: invalid match pattern/);
  bad({ content_scripts: [{ matches: ["https://a.com/*"] }] }, /^content_scripts\[0\]: needs at least one file in js or css/);
  bad(cs({ run_at: "document_ready" }), /^content_scripts\[0\]\.run_at: must be one of/);
  bad(cs({ world: "main" }), /^content_scripts\[0\]\.world: must be one of/);
  for (const k of ["all_frames", "match_about_blank", "match_origin_as_fallback"]) bad(cs({ [k]: "true" }), new RegExp(`^content_scripts\\[0\\]\\.${k}: must be a boolean`));
  bad(cs({ include_globs: [1] }), /include_globs\[0\]: must be a string/);
  bad(cs({ js: "a.js" }), /^content_scripts\[0\]\.js: must be an array/);
  bad(cs({ match_origin_as_fallback: true, matches: ["https://a.com/path/*"] }), /must have path "\/\*" when match_origin_as_fallback/);
  ok(cs({ match_origin_as_fallback: true }));
  warns(cs({ runAt: "x" }), /^content_scripts\[0\]\.runAt: unknown key/);
});

test("permissions", () => {
  ok({ permissions: ["storage", "tabs", "system.cpu"], optional_permissions: ["bookmarks"] });
  warns({ permissions: ["storage", "frobnicate"] }, /^permissions\[1\]: unknown permission "frobnicate"/);
  warns({ permissions: ["https://a.com/*"] }, /^permissions\[0\]: host pattern .* move it to host_permissions/);
  warns({ permissions: ["<all_urls>"] }, /host pattern/);
  warns({ optional_permissions: ["https://a.com/*"] }, /optional_host_permissions/);
  warns({ permissions: ["tabs", "tabs"] }, /^permissions\[1\]: duplicate "tabs"/);
  warns({ optional_permissions: ["debugger"] }, /can't be optional/);
  warns({ permissions: ["webRequest", "webRequestBlocking"] }, /policy-installed/);
  bad({ permissions: "storage" }, /^permissions: must be an array/);
  bad({ permissions: [1] }, /^permissions\[0\]: must be a string/);
});

test("host_permissions", () => {
  ok({ host_permissions: ["https://a.com/*", "<all_urls>"], optional_host_permissions: ["https://*/*"] });
  bad({ host_permissions: ["a.com"] }, /^host_permissions\[0\]: invalid match pattern "a.com"/);
  bad({ optional_host_permissions: ["https://a.com"] }, /^optional_host_permissions\[0\]: invalid match pattern/);
});

test("web_accessible_resources", () => {
  ok({ web_accessible_resources: [{ resources: ["a.css", "img/*"], matches: ["https://a.com/*"], use_dynamic_url: true }] });
  ok({ web_accessible_resources: [{ resources: ["a.css"], extension_ids: ["abcdefghijklmnopabcdefghijklmnop", "*"] }] });
  bad({ web_accessible_resources: ["a.css"] }, /^web_accessible_resources\[0\]: must be an object .* not a string/);
  bad({ web_accessible_resources: [{ matches: ["https://a.com/*"] }] }, /^web_accessible_resources\[0\]\.resources: is required/);
  bad({ web_accessible_resources: [{ resources: ["a"] }] }, /^web_accessible_resources\[0\]: needs matches or extension_ids/);
  bad({ web_accessible_resources: [{ resources: ["a"], matches: ["https://a.com/x/*"] }] }, /matches\[0\]: invalid match pattern .*path must be "\/\*"/);
  bad({ web_accessible_resources: [{ resources: ["a"], extension_ids: ["xyz"] }] }, /extension_ids\[0\]: invalid extension id/);
  bad({ web_accessible_resources: [{ resources: ["a"], matches: ["https://a.com/*"], use_dynamic_url: 1 }] }, /use_dynamic_url: must be a boolean/);
});

test("content_security_policy", () => {
  ok({ content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';", sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval'" } });
  ok({ content_security_policy: { extension_pages: "script-src 'self' http://localhost:8080; object-src 'self'" } });
  bad({ content_security_policy: "script-src 'self'" }, /^content_security_policy: must be an object/);
  bad({ content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" } }, /^content_security_policy\.extension_pages: insecure CSP value "'unsafe-eval'" in directive 'script-src'/);
  bad({ content_security_policy: { extension_pages: "script-src 'self' https://cdn.example.com" } }, /insecure CSP value "https:\/\/cdn.example.com"/);
  bad({ content_security_policy: { extension_pages: "script-src 'self'; object-src *" } }, /in directive 'object-src'/);
  bad({ content_security_policy: { extension_pages: "worker-src 'unsafe-inline'" } }, /in directive 'worker-src'/);
  bad({ content_security_policy: { sandbox: "script-src 'self'" } }, /^content_security_policy\.sandbox: must include the sandbox directive/);
  bad({ content_security_policy: { sandbox: "sandbox allow-scripts allow-same-origin" } }, /must not include allow-same-origin/);
  warns({ content_security_policy: { pages: "x" } }, /^content_security_policy\.pages: unknown key/);
});

test("sandbox", () => {
  ok({ sandbox: { pages: ["s.html"] } });
  bad({ sandbox: {} }, /^sandbox\.pages: is required/);
  warns({ sandbox: { pages: ["s.html"], content_security_policy: "x" } }, /^sandbox\.content_security_policy: is Manifest V2 only/);
});

test("commands", () => {
  ok({ commands: { _execute_action: { suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" } }, run: { suggested_key: "Alt+Shift+P", description: "Run" }, play: { suggested_key: "MediaPlayPause", description: "Play" } } });
  bad({ commands: { run: { suggested_key: "Ctrl+Shift+Y" } } }, /^commands\.run\.description: is required/);
  bad({ commands: { run: { suggested_key: "Shift+Y", description: "R" } } }, /must include Ctrl or Alt/);
  bad({ commands: { run: { suggested_key: "Ctrl+Alt+Y", description: "R" } } }, /Ctrl\+Alt is not allowed/);
  bad({ commands: { run: { suggested_key: "Ctrl+F5", description: "R" } } }, /unsupported key "F5"/);
  bad({ commands: { run: { suggested_key: "Hyper+Y", description: "R" } } }, /unknown modifier "Hyper"/);
  bad({ commands: { run: { suggested_key: "Ctrl+MediaStop", description: "R" } } }, /media keys can't have modifiers/);
  bad({ commands: { run: { suggested_key: { windows: "Command+Y" }, description: "R" } } }, /^commands\.run\.suggested_key\.windows: .*"Command" is only allowed for mac/);
  bad({ commands: { run: { suggested_key: { mac: "Search+Y" }, description: "R" } } }, /only allowed for chromeos/);
  warns({ commands: { run: { suggested_key: { amiga: "Ctrl+Y" }, description: "R" } } }, /suggested_key\.amiga: unknown platform/);
  bad({ commands: { run: { suggested_key: 5, description: "R" } } }, /suggested_key: must be a string or object/);
  const five = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`c${n}`, { suggested_key: `Ctrl+Shift+${n}`, description: "x" }]));
  bad({ commands: five }, /^commands: at most 4 commands may have a suggested_key \(found 5\)/);
  ok({ commands: { ...five, c5: { description: "x" } } });
  warns({ commands: { _execute_browser_action: {} } }, /use "_execute_action"/);
  warns({ commands: { g: { suggested_key: "Ctrl+Shift+Y", description: "x", global: true } } }, /global shortcuts are limited/);
  ok({ commands: { g: { suggested_key: "Ctrl+Shift+5", description: "x", global: true } } });
});

test("externally_connectable", () => {
  ok({ externally_connectable: { ids: ["*"], matches: ["https://*.example.com/*"], accepts_tls_channel_id: false } });
  warns({ externally_connectable: { matches: ["https://*/*"] } }, /too broad/);
  warns({ externally_connectable: { matches: ["https://*.com/*"] } }, /too broad/);
  bad({ externally_connectable: { ids: ["nope"] } }, /^externally_connectable\.ids\[0\]: invalid extension id/);
  bad({ externally_connectable: { matches: ["bad"] } }, /invalid match pattern/);
});

test("declarative_net_request", () => {
  const dnr = (r, p = ["declarativeNetRequest"]) => ({ permissions: p, declarative_net_request: { rule_resources: r } });
  ok(dnr([{ id: "r1", enabled: true, path: "r1.json" }]));
  warns(dnr([{ id: "r1", enabled: true, path: "r1.json" }], []), /needs the "declarativeNetRequest"/);
  bad(dnr([{ id: "_r", enabled: true, path: "r.json" }]), /must not start with "_"/);
  bad(dnr([{ id: "a", enabled: true, path: "a" }, { id: "a", enabled: false, path: "b" }]), /^declarative_net_request\.rule_resources\[1\]\.id: duplicate ruleset id/);
  bad(dnr([{ id: "a", path: "a" }]), /rule_resources\[0\]\.enabled: is required/);
  bad(dnr([{ id: "a", enabled: true }]), /rule_resources\[0\]\.path: is required/);
  bad(dnr(Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, enabled: false, path: "r.json" }))), /at most 100 static rulesets/);
  bad(dnr(Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, enabled: true, path: "r.json" }))), /at most 50 static rulesets can be enabled/);
});

test("chrome_url_overrides", () => {
  ok({ chrome_url_overrides: { newtab: "n.html" } });
  bad({ chrome_url_overrides: { newtab: "n.html", history: "h.html" } }, /can only override one page/);
  bad({ chrome_url_overrides: { settings: "s.html" } }, /can't override "settings"/);
});

test("options, devtools and side panel", () => {
  ok({ options_ui: { page: "o.html", open_in_tab: false }, devtools_page: "d.html" });
  bad({ options_ui: {} }, /^options_ui\.page: is required/);
  bad({ options_ui: { page: "o.html", open_in_tab: "no" } }, /open_in_tab: must be a boolean/);
  warns({ options_ui: { page: "o.html", chrome_style: true } }, /chrome_style: is Manifest V2 only/);
  warns({ options_ui: { page: "o.html" }, options_page: "p.html" }, /^options_page: is ignored because options_ui is set/);
  ok({ side_panel: { default_path: "s.html" }, permissions: ["sidePanel"] });
  warns({ side_panel: { default_path: "s.html" } }, /needs the "sidePanel" permission/);
});

test("oauth2, omnibox, storage, incognito, minimum_chrome_version", () => {
  ok({ oauth2: { client_id: "x.apps.googleusercontent.com", scopes: ["s"] }, permissions: ["identity"] });
  bad({ oauth2: { scopes: [] }, permissions: ["identity"] }, /^oauth2\.client_id: is required/);
  warns({ oauth2: { client_id: "x" } }, /"identity" permission/);
  ok({ omnibox: { keyword: "vb" } });
  bad({ omnibox: {} }, /^omnibox\.keyword: is required/);
  ok({ storage: { managed_schema: "schema.json" } });
  bad({ storage: { managed_schema: 1 } }, /managed_schema: must be a string/);
  for (const v of ["spanning", "split", "not_allowed"]) ok({ incognito: v });
  bad({ incognito: "yes" }, /^incognito: must be one of/);
  ok({ minimum_chrome_version: "114" }); ok({ minimum_chrome_version: "114.0.5735.90" });
  bad({ minimum_chrome_version: "114a" }, /^minimum_chrome_version: invalid version/);
  bad({ minimum_chrome_version: 114 }, /must be a string/);
});

test("key, URLs and other keys", () => {
  warns({ key: "MIIBIjANBgkq+/A=" }, /^key: remove before uploading/);
  bad({ key: "-----BEGIN PUBLIC KEY-----MIIB" }, /^key: must be the base64 public key on one line/);
  bad({ key: "not base64!" }, /^key: must be/);
  bad({ key: "abc" }, /^key: must be a base64 string/);
  bad({ homepage_url: "example.com" }, /^homepage_url: must be an http\(s\) URL/);
  warns({ update_url: "https://example.com/u.xml" }, /^update_url: is ignored for Chrome Web Store items/);
  bad({ cross_origin_opener_policy: {} }, /cross_origin_opener_policy\.value: is required/);
  bad({ import: [{ minimum_version: "1" }] }, /^import\[0\]\.id: is required/);
  bad({ file_handlers: {} }, /^file_handlers: must be an array/);
  bad({ trial_tokens: [1] }, /^trial_tokens\[0\]: must be a string/);
});

test("referenced files are checked only with rootDir", () => {
  const m = { icons: { 128: "i.png" }, action: { default_popup: "p.html" }, background: { service_worker: "sw.js" },
    content_scripts: [{ matches: ["https://a.com/*"], js: ["/a.js"], css: ["a.css"] }], options_page: "o.html",
    web_accessible_resources: [{ resources: ["w.css", "img/*"], matches: ["https://a.com/*"] }],
    declarative_net_request: { rule_resources: [{ id: "r", enabled: true, path: "r.json" }] }, permissions: ["declarativeNetRequest"] };
  ok(m);
  const root = mk({ "i.png": "", "p.html": "", "sw.js": "", "a.js": "", "a.css": "", "o.html": "", "w.css": "", "r.json": "[]", "dir/x": "" });
  ok(m, { rootDir: root });
  const r = run({ ...m, icons: { 128: "missing.png" }, options_page: "dir" }, { rootDir: root });
  assert.deepEqual(r.errors, ['icons.128: file not found: "missing.png"', 'options_page: "dir" is not a file']);
});
