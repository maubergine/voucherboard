// The Safari update check (extension/src/updates.js), with a stand-in store and fetch. No network.
const test = require("node:test");
const assert = require("node:assert");
const U = require("../extension/src/updates.js");

const rel = (v, extra = {}) => ({ tag_name: "v" + v, html_url: "https://github.com/maubergine/voucherboard/releases/tag/v" + v,
  assets: [{ name: `voucherboard-chrome-${v}.zip` }, { name: `voucherboard-safari-${v}.zip`, browser_download_url: `https://github.com/maubergine/voucherboard/releases/download/v${v}/voucherboard-safari-${v}.zip` }, { name: "SHA256SUMS" }], ...extra });
function rig(body, ok = true) {
  const data = {}, calls = [];
  const store = { get: async (k, d) => (k in data ? data[k] : d), set: async (k, v) => { data[k] = v; } };
  const fetch = async (u, o) => { calls.push({ u, o }); if (body instanceof Error) throw body; return { ok, json: async () => body }; };
  return { data, calls, store, fetch };
}

test("compares versions by number", () => {
  assert.ok(U.newer("0.7.10", "0.7.9"));
  assert.ok(U.newer("v1.0.0", "0.9.9"));
  assert.ok(!U.newer("0.7.2", "0.7.2"));
  assert.ok(!U.newer("0.7.1", "0.7.2"));
  assert.ok(U.newer("0.8", "0.7.9"));
});

test("only Safari's extension checks", () => {
  assert.ok(U.isSafari("safari-web-extension://ABC/"));
  assert.ok(!U.isSafari("chrome-extension://abc/"));
  assert.ok(!U.isSafari("moz-extension://abc/"));
});

test("a release counts only once its Safari zip is attached", () => {
  assert.deepStrictEqual(U.parse(rel("0.7.3")), { version: "0.7.3", url: "https://github.com/maubergine/voucherboard/releases/tag/v0.7.3", asset: "voucherboard-safari-0.7.3.zip", download: "https://github.com/maubergine/voucherboard/releases/download/v0.7.3/voucherboard-safari-0.7.3.zip" });
  assert.strictEqual(U.parse(rel("0.7.2", { assets: [{ name: "Voucherboard-Safari-0.7.2.zip" }, { name: "Voucherboard-Safari-0.7.2.zip.sha256" }] })).version, "0.7.2", "the name before 0.7.3");
  assert.strictEqual(U.parse(rel("0.7.3", { assets: [{ name: "voucherboard-chrome-0.7.3.zip" }] })), null);
  assert.strictEqual(U.parse(rel("0.7.3", { prerelease: true })), null);
  assert.strictEqual(U.parse(null), null);
});

test("checks GitHub at most once a day, without credentials", async () => {
  const r = rig(rel("0.7.3"));
  const now = Date.parse("2026-10-13T09:00:00Z");
  const a = await U.check({ store: r.store, fetch: r.fetch, now, current: "0.7.2" });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.version, "0.7.3");
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(r.calls[0].u, U.LATEST);
  assert.strictEqual(r.calls[0].o.credentials, "omit");
  await U.check({ store: r.store, fetch: r.fetch, now: now + 3600e3, current: "0.7.2" });
  assert.strictEqual(r.calls.length, 1, "not again within a day");
  await U.check({ store: r.store, fetch: r.fetch, now: now + 864e5, current: "0.7.2" });
  assert.strictEqual(r.calls.length, 2);
});

test("nothing is available when up to date, offline or refused", async () => {
  assert.strictEqual((await U.check({ ...rig(rel("0.7.2")), current: "0.7.2" })).available, false);
  assert.strictEqual((await U.check({ ...rig(new Error("offline")), current: "0.7.2" })).available, false);
  assert.strictEqual((await U.check({ ...rig({ message: "rate limited" }, false), current: "0.7.2" })).available, false);
});

test("a failed check keeps the last known release", async () => {
  const r = rig(new Error("offline"));
  r.data[U.KEY] = { checked: 1, version: "0.7.3", url: "u", asset: "a", shown: "0.7.3" };
  const a = await U.check({ store: r.store, fetch: r.fetch, now: Date.now(), current: "0.7.2" });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.shown, "0.7.3");
});
