// The Safari update check (extension/src/updates.js), with a stand-in store and fetch. No network.
const test = require("node:test");
const assert = require("node:assert");
const U = require("../extension/src/updates.js");

const GH = "https://github.com/maubergine/voucherboard/releases";
const rel = (v, extra = {}) => ({ tag_name: "safari-v" + v, html_url: `${GH}/tag/safari-v${v}`,
  assets: [{ name: `voucherboard-safari-${v}.zip`, browser_download_url: `${GH}/download/safari-v${v}/voucherboard-safari-${v}.zip` }, { name: "SHA256SUMS" }], ...extra });
// Another platform's release, and a Safari release still waiting for its signed zip.
const other = (c, v) => ({ tag_name: `${c}-v${v}`, html_url: `${GH}/tag/${c}-v${v}`, assets: [{ name: `voucherboard-${c}-${v}.zip` }, { name: "SHA256SUMS" }] });
const bare = (v) => rel(v, { assets: [] });
function rig(body, ok = true) {
  const data = {}, calls = [];
  const store = { get: async (k, d) => (k in data ? data[k] : d), set: async (k, v) => { data[k] = v; } };
  const fetch = async (u, o) => { calls.push({ u, o }); if (body instanceof Error) throw body; const b = typeof body === "function" ? body(u) : body; return { ok, json: async () => b }; };
  return { data, calls, store, fetch };
}

test("compares versions by number", () => {
  assert.ok(U.newer("0.7.10", "0.7.9"));
  assert.ok(U.newer("v1.0.0", "0.9.9"));
  assert.ok(!U.newer("0.7.2", "0.7.2"));
  assert.ok(!U.newer("0.7.1", "0.7.2"));
  assert.ok(U.newer("0.8", "0.7.9"));
  assert.ok(U.newer("safari-v0.14.0", "0.13.2"));
  assert.ok(!U.newer("safari-v0.13.2", "0.13.2"));
});

test("only Safari's extension checks", () => {
  assert.ok(U.isSafari("safari-web-extension://ABC/"));
  assert.ok(!U.isSafari("chrome-extension://abc/"));
  assert.ok(!U.isSafari("moz-extension://abc/"));
});

test("only a safari-v release counts, once its own Safari zip is attached", () => {
  assert.deepStrictEqual(U.parse(rel("0.14.0")), { version: "0.14.0", url: `${GH}/tag/safari-v0.14.0`, asset: "voucherboard-safari-0.14.0.zip", download: `${GH}/download/safari-v0.14.0/voucherboard-safari-0.14.0.zip` });
  assert.strictEqual(U.parse(bare("0.14.0")), null, "not signed yet");
  assert.strictEqual(U.parse(rel("0.14.0", { assets: [{ name: "voucherboard-safari-0.13.2.zip" }] })), null, "another version's zip");
  assert.strictEqual(U.parse({ ...rel("0.14.0"), tag_name: "v0.14.0" }), null, "the shared releases before per-platform ones");
  assert.strictEqual(U.parse({ ...rel("0.14.0"), tag_name: "chrome-v0.14.0" }), null, "another platform's");
  assert.strictEqual(U.parse(rel("0.14.0", { prerelease: true })), null);
  assert.strictEqual(U.parse(null), null);
});

test("checks GitHub at most once a day, without credentials", async () => {
  const r = rig([rel("0.7.3")]);
  const now = Date.parse("2026-10-13T09:00:00Z");
  const a = await U.check({ store: r.store, fetch: r.fetch, now, current: "0.7.2" });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.version, "0.7.3");
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(r.calls[0].u, U.RELEASES + "?per_page=100&page=1");
  assert.strictEqual(r.calls[0].o.credentials, "omit");
  await U.check({ store: r.store, fetch: r.fetch, now: now + 3600e3, current: "0.7.2" });
  assert.strictEqual(r.calls.length, 1, "not again within a day");
  await U.check({ store: r.store, fetch: r.fetch, now: now + 864e5, current: "0.7.2" });
  assert.strictEqual(r.calls.length, 2);
});

test("nothing is available when up to date, offline or refused", async () => {
  assert.strictEqual((await U.check({ ...rig([rel("0.7.2")]), current: "0.7.2" })).available, false);
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

test("skips other platforms' releases to find the newest Safari one", async () => {
  const r = rig([other("chrome", "0.14.0"), other("ios", "0.13.2"), rel("0.13.3"), other("firefox", "0.13.3"), rel("0.13.2")]);
  const a = await U.check({ store: r.store, fetch: r.fetch, current: "0.13.2" });
  assert.strictEqual(a.available, true);
  assert.strictEqual(a.version, "0.13.3");
  assert.strictEqual(a.asset, "voucherboard-safari-0.13.3.zip");
  assert.strictEqual(r.calls.length, 1);
});

test("skips drafts, pre-releases and unsigned releases, and stops at the version running", () => {
  assert.strictEqual(U.pick([rel("0.15.0", { draft: true }), rel("0.14.1", { prerelease: true }), bare("0.14.0"), other("chrome", "0.12.0"), rel("0.13.3")], "0.13.2").found.version, "0.13.3");
  assert.deepStrictEqual(U.pick([bare("0.14.0"), bare("0.13.2"), rel("0.13.1")], "0.13.2"), { done: true });
  assert.deepStrictEqual(U.pick([other("chrome", "0.1.0"), bare("0.14.0")], "0.13.2"), {}, "other platforms' versions never stop it");
});

test("looks at further pages until it reaches the version running", async () => {
  const page = (n) => Array.from({ length: U.PER_PAGE }, (_, i) => other("chrome", `9.${n}.${U.PER_PAGE - i}`));
  const r = rig((u) => (/page=1$/.test(u) ? page(1) : [other("ios", "1.0.0"), rel("0.13.3"), rel("0.13.2")]));
  const a = await U.check({ store: r.store, fetch: r.fetch, current: "0.13.2" });
  assert.strictEqual(a.version, "0.13.3");
  assert.deepStrictEqual(r.calls.map((c) => c.u.split("?")[1]), ["per_page=100&page=1", "per_page=100&page=2"]);
});

test("stops paging at the version running, or after three pages", async () => {
  const full = (f) => Array.from({ length: U.PER_PAGE }, f);
  const reached = rig([...full(() => other("chrome", "0.14.0")).slice(1), bare("0.13.2")]);
  assert.strictEqual((await U.check({ store: reached.store, fetch: reached.fetch, current: "0.13.2" })).available, false);
  assert.strictEqual(reached.calls.length, 1);
  const endless = rig(() => full(() => other("chrome", "9.0.0")));
  await U.check({ store: endless.store, fetch: endless.fetch, current: "0.13.2" });
  assert.strictEqual(endless.calls.length, 3);
});
