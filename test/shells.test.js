// The iOS and Android apps are two native shells over one engine (apps/mobile/BRIDGE.md). These checks keep them in step:
// the same web files bundled, the same bridge commands answered, the same engine calls made and the same view-model
// fields decoded. A change to one shell that the other lacks fails here.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MOBILE = path.join(ROOT, "apps", "mobile");
const IOS = path.join(MOBILE, "ios");
const ANDROID = path.join(MOBILE, "android", "app", "src", "main", "java", "com", "mariusrubin", "voucherboard");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
const walk = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
});
const sorted = (xs) => [...new Set(xs)].sort();
const diff = (a, b) => ({ onlyFirst: a.filter((x) => !b.includes(x)), onlySecond: b.filter((x) => !a.includes(x)) });

test("both shells bundle the same shared files as the engine page loads", () => {
  const html = read(MOBILE, "www", "engine.html");
  const fromHtml = sorted([...html.matchAll(/src="core\/([a-z]+)\.js"/g)].map((m) => m[1]));
  const ios = sorted(read(IOS, "project.yml").match(/for f in ([a-z ]+); do/)[1].trim().split(/\s+/));
  const gradle = read(MOBILE, "android", "app", "build.gradle.kts");
  const android = sorted(gradle.match(/core\.from\(listOf\(([^)]*)\)/)[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1)));
  assert.deepStrictEqual(ios, fromHtml, "apps/mobile/ios/project.yml copy list");
  assert.deepStrictEqual(android, fromHtml, "apps/mobile/android/app/build.gradle.kts core list");
  for (const f of ["buyfill.js", "council.js"]) {
    assert.match(read(IOS, "project.yml"), new RegExp(f.replace(".", "\\.")), `iOS copies ${f}`);
    assert.match(gradle, new RegExp(f.replace(".", "\\.")), `Android copies ${f}`);
  }
});

test("both shells answer the same bridge commands, and BRIDGE.md lists them", () => {
  const swift = sorted([...read(IOS, "Voucherboard", "Bridge.swift").matchAll(/case ((?:"[a-z.A-Z]+"(?:, )?)+):/g)].flatMap((m) => m[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1))));
  // The command `when` in Bridge.kt's dispatch, not the ones nested inside its branches.
  const kt = read(ANDROID, "Bridge.kt"), body = kt.slice(kt.indexOf("when (cmd) {"));
  const kotlin = sorted([...body.matchAll(/^ {12}"([a-z.A-Z]+)" ->/gm)].map((m) => m[1]));
  const doc = sorted([...read(MOBILE, "BRIDGE.md").matchAll(/^\| `([a-z.A-Z]+)`(?: \/ `([a-z.A-Z]+)`)? \|/gm)].flatMap((m) => [m[1], m[2]].filter(Boolean)))
    .filter((c) => swift.includes(c) || kotlin.includes(c) || /\./.test(c) || ["hello", "share", "haptic", "openExternal"].includes(c));
  assert.deepStrictEqual(diff(swift, kotlin), { onlyFirst: [], onlySecond: [] }, "Bridge.swift vs Bridge.kt");
  for (const c of swift) assert.ok(doc.includes(c), `BRIDGE.md lists ${c}`);
});

// Engine calls each app's screens make: act("x"), view("x"), update("x") (quick-book), call("x"), and so on.
const CALL = /\b(?:act|launchAct|view|call|callRaw|update)(?:<[^>()]*>)?\(\s*"([a-zA-Z]+)"/g;
const callsIn = (files) => sorted(files.flatMap((f) => [...read(f).matchAll(CALL)].map((m) => m[1])));

test("both apps make the same engine calls, and the engine has each one", () => {
  const swift = callsIn(walk(path.join(IOS, "Voucherboard"), ".swift"));
  const kotlin = callsIn(walk(ANDROID, ".kt"));
  assert.deepStrictEqual(diff(swift, kotlin), { onlyFirst: [], onlySecond: [] }, "SwiftUI screens vs Compose screens");
  const host = read(MOBILE, "www", "engine-host.js");
  const api = host.slice(host.indexOf("const API = {"), host.indexOf("async function call"));
  const names = new Set([...api.matchAll(/\b([a-zA-Z]+): \(/g)].map((m) => m[1]));
  for (const n of swift) assert.ok(names.has(n), `engine-host.js has ${n}`);
});

// Stored fields of the view models (Models.swift and Models.kt), not computed ones.
function swiftFields(src) {
  const out = [];
  for (const part of src.split(/[;\n]/)) {
    const m = part.match(/\b(let|var)\s+(.*)/);
    if (!m || (m[1] === "var" && /\{\s*[^}]*\}?\s*$/.test(m[2]) && !/=\s*$/.test(m[2]) && /\{/.test(m[2]))) continue;
    for (const x of m[2].matchAll(/(?:^|,\s*)([a-zA-Z]+)\s*:/g)) out.push(x[1]);
  }
  return sorted(out);
}
const kotlinFields = (src) => sorted([...src.matchAll(/\bval\s+`?([a-zA-Z]+)`?\s*:[^\n=]*?(\n|,|\)|=)/g)].filter((m) => !/get\(\)/.test(src.slice(m.index, src.indexOf("\n", m.index)))).map((m) => m[1]));

test("both apps decode the same view-model fields", () => {
  const swift = swiftFields(read(IOS, "Voucherboard", "App", "Models.swift"));
  const kotlin = kotlinFields(read(ANDROID, "app", "Models.kt"));
  assert.deepStrictEqual(diff(swift, kotlin), { onlyFirst: [], onlySecond: [] }, "Models.swift vs Models.kt");
});

test("each SwiftUI screen file has its Compose counterpart", () => {
  const swift = fs.readdirSync(path.join(IOS, "Voucherboard", "App")).filter((f) => f.endsWith(".swift")).map((f) => f.replace(/\.swift$/, ""));
  const kotlin = fs.readdirSync(path.join(ANDROID, "app")).filter((f) => f.endsWith(".kt")).map((f) => f.replace(/\.kt$/, ""));
  // LiveVisits is a shell file on Android (it posts notifications), beside MainActivity.
  const missing = swift.filter((f) => !kotlin.includes(f) && !(f === "LiveVisits" && fs.existsSync(path.join(ANDROID, "LiveVisits.kt"))));
  assert.deepStrictEqual(missing, []);
});
