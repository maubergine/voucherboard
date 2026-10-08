// The engine as native screens use it: mobile/www/engine.html's scripts, driven through VBEngine.call.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { fakeSite } = require("./fakesite.js");
const TERMS = require("../src/terms.js");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const NOW = "2026-09-28T10:30:00"; // TU44VWX's 10:00–12:00 is running; VW55XYZ is booked 10:00 on Wed 30 Sep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(10); } throw new Error("timed out"); }

const opened = [];
test.afterEach(() => { for (const w of opened.splice(0)) w.close(); });

async function setup({ plan = null, live = false, noTerms = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://appassets.androidplatform.net/www/engine.html", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  opened.push(w);
  const RD = w.Date, fixed = new RD(NOW).getTime();
  w.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const storage = {};
  if (plan) storage["vb:plan:x80b66f1c3b5e7742"] = plan;
  if (!noTerms) storage["vb:terms"] = { version: TERMS.VERSION };
  if (!live) storage["vb:settings"] = { testMode: true };
  const site = fakeSite(w), events = [], native = [];
  const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  w.VBDev = {
    async call(cmd, args) {
      native.push(cmd);
      if (cmd === "notify.permission") return { granted: true };
      if (cmd === "engine.event") { events.push(copy(args)); return null; }
      if (cmd === "hello") return { platform: "test", version: "9.8.7" };
      if (cmd === "store.get") return copy(storage[args.key]);
      if (cmd === "store.set") { storage[args.key] = copy(args.value); return null; }
      if (cmd === "council.fetch") {
        const r = await site.fetch(args.path, { method: args.method, body: args.body });
        let body = await r.text();
        if (!body) { try { body = JSON.stringify(await r.json()); } catch (e) { body = ""; } }
        return { status: r.status, url: r.url, body };
      }
      return null;
    }
  };
  w.VB_MANUAL_START = true;
  w.eval(read("mobile", "www", "native.js"));
  for (const f of ["zones.js", "planner.js", "portal.js", "terms.js", "model.js", "reminders.js", "plates.js"]) w.eval(read("src", f));
  for (const f of ["demo.js", "engine.js", "views.js", "engine-host.js"]) w.eval(read("mobile", "www", f));
  w.VB.portal.GAP_MS = 0;
  const call = async (name, args) => copy(await w.VBEngine.call(name, args)); // results into this realm, for deepStrictEqual
  await w.VB.engine.start();
  return { w, call, site, storage, events, native };
}

test("the engine page loads the same scripts the tests do", () => {
  const html = read("mobile", "www", "engine.html");
  for (const f of ["native.js", "core/plates.js", "demo.js", "engine.js", "views.js", "engine-host.js"]) assert.ok(html.includes(`src="${f}"`), f);
  assert.match(html, /connect-src 'none'/);
});

test("waits for the terms before reading anything, then loads", async () => {
  const t = await setup({ noTerms: true });
  assert.strictEqual((await t.call("home")).phase, "terms");
  assert.strictEqual(t.site.calls.length, 0);
  await t.call("acceptTerms");
  assert.strictEqual((await t.call("home")).phase, "ready");
});

test("home and today describe the zone, balance and the visit in progress", async () => {
  const t = await setup();
  const home = await t.call("home");
  assert.strictEqual(home.zone.text, "Controlled now, until 12:00");
  assert.strictEqual(home.balance, "9 × 1 hour");
  assert.strictEqual(home.testMode, true);
  const today = await t.call("today");
  assert.strictEqual(today.live.length, 1);
  assert.deepStrictEqual([today.live[0].plate, today.live[0].pct, today.live[0].canExtend, today.live[0].ends], ["TU44 VWX", 25, false, "Ends 12:00"]);
  assert.ok(today.next.some((r) => r.plate === "VW55 XYZ" && r.pill.text === "Booked" && r.canCancel), "upcoming bookings can be swiped to cancel");
  assert.deepStrictEqual([today.live[0].startIn, today.live[0].endIn, today.liveActivity, today.zone], [-30 * 60000, 90 * 60000, true, "P"], "what the Live Activity needs");
  assert.strictEqual((await t.call("setSetting", { key: "liveActivity", value: false })).err, undefined);
  assert.strictEqual((await t.call("today")).liveActivity, false);
  assert.ok(today.favourites.some((f) => f.vrn === "LM11NPR"));
  assert.ok(t.events.some((e) => e.type === "change"), "native hears about changes");
});

test("quick-book: the form goes back and forth, and Book now runs just that booking", async () => {
  const t = await setup({ live: true });
  let v = await t.call("quickInit", { opts: { vrns: ["LM11NPR"] } });
  assert.strictEqual(v.when, "now");
  assert.match(v.preview.text, /^Uses 1 × 1 hour/);
  assert.deepStrictEqual(v.limits, { f: 600, t: 720 }, "the time pickers offer the controlled hours only");
  v = await t.call("quickPreset", { q: v.q, preset: "end" });
  assert.deepStrictEqual([v.fromText, v.toText], ["10:30", "12:00"]);
  const c = await t.call("confirm", { q: v.q, email: false });
  assert.strictEqual(c.goLabel, "Book 2 vouchers");
  await t.call("bookNow", { q: v.q, email: false });
  const run = await until(async () => { const r = await t.call("run"); return r && r.phase === "done" && r; });
  assert.match(run.note, /2 booked/);
  assert.ok(t.site.calls.some((x) => x.m === "POST" && x.path === "/Permit/VisitorPermit"));
});

test("a saved plan reviews, runs and reports per operation", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  const plan = await t.call("plan");
  assert.strictEqual(plan.reviewLabel, "Review 1 change");
  assert.match((await t.call("home")).tray.short, /^1 planned · £/, "a short tray title for when the tab bar shrinks");
  assert.deepStrictEqual((await t.call("entry", { id: plan.items[0].id })).limits, { f: 600, t: 720 });
  assert.strictEqual(plan.items[0].plate, "GH78 JKL");
  await t.call("review");
  let run = await t.call("run");
  assert.deepStrictEqual([run.phase, run.goLabel, run.ops.length], ["review", "Run test", 1]);
  await t.call("runGo");
  run = await until(async () => { const r = await t.call("run"); return r.phase === "done" && r; });
  assert.match(run.note, /Test passed/);
  assert.strictEqual(run.ops[0].statusText, "Checked ✓");
});

test("a change leaves the plan after its run, even when the council gives the new booking the old id", async () => {
  const t = await setup({ live: true, plan: [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 630, to: 690, replaces: ["xd771d26b887ce0ee"] }] });
  const fetch = t.site.fetch;
  let rebooked = false; // then the site lists the new 10:30 booking under the old id
  t.site.fetch = async (p, opt = {}) => {
    const r = await fetch(p, opt);
    if (/^\/Permit\/VisitorPermit/.test(p) && (opt.method || "").toUpperCase() === "POST") { t.site.cancelled.clear(); rebooked = true; }
    if (!rebooked || !/^\/Permit\/Details/.test(p)) return r;
    const body = (await r.text()).replace("30.09.2026 10:00", "30.09.2026 10:30").replace("30.09.2026 10:59", "30.09.2026 11:29");
    return { ...r, text: async () => body };
  };
  assert.match((await t.call("plan")).subtitle, /1 voucher to book · 1 to cancel/);
  await t.call("review");
  await t.call("runGo");
  const run = await until(async () => { const r = await t.call("run"); return r.phase === "done" && r; }, 8000);
  assert.ok(!run.failed, run.note);
  assert.deepStrictEqual(t.storage["vb:plan:x80b66f1c3b5e7742"], []);
  assert.strictEqual((await t.call("home")).tray, null);
});

test("the list shows bookings and planned items, and says which can be picked", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  const l = await t.call("list", {});
  const live = l.rows.find((r) => r.vrn === "TU44VWX" && r.pill.tone === "live"), vw = l.rows.find((r) => r.vrn === "VW55XYZ"), gh = l.rows.find((r) => r.vrn === "GH78JKL");
  assert.deepStrictEqual([live.pick, live.why], [false, "In progress. Open it to end early."]);
  assert.deepStrictEqual([vw.pick, vw.sel], [true, "b:" + vw.key]);
  assert.deepStrictEqual([gh.pick, gh.sel, gh.kind], [true, "e:1", "entry"]);
  assert.ok(l.rows.every((r) => !r.past), "finished ones only when asked");
  assert.match(l.summary, /^\d+ of \d+ shown\.$/);
  const only = await t.call("list", { vrns: ["VW55XYZ"] });
  assert.ok(only.rows.length && only.rows.every((r) => r.vrn === "VW55XYZ"));
  assert.ok(only.vehicles.find((v) => v.vrn === "VW55XYZ").on);
});

test("a longer change keeps the booked voucher, and the plan and entry say so", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 600, to: 720, replaces: ["xd771d26b887ce0ee"] }] });
  const plan = await t.call("plan");
  assert.match(plan.subtitle, /^1 voucher to book\./, "nothing to cancel");
  assert.strictEqual(plan.items[0].need, "1 × 1 hour, keeps 1 booked voucher");
  assert.strictEqual((await t.call("entry", { id: 1 })).cost, "Uses 1 × 1 hour and keeps 1 booked voucher");
  const same = await setup({ plan: [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 600, to: 660, replaces: ["xd771d26b887ce0ee"] }] });
  assert.strictEqual((await same.call("entry", { id: 1 })).cost, "Keeps 1 booked voucher. No new voucher needed");
});

test("a vehicle that isn't a favourite is named by its spaced plate, so screens don't show it twice", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "KX19PLM", dk: "2026-09-29", from: 630, to: 690 }] });
  const kx = (await t.call("list", {})).rows.find((r) => r.vrn === "KX19PLM");
  assert.deepStrictEqual([kx.plate, kx.name], ["KX19 PLM", "KX19 PLM"]);
});

test("cancelling reports progress for each voucher", async () => {
  const t = await setup({ live: true });
  const vw = (await t.call("list", {})).rows.find((r) => r.vrn === "VW55XYZ");
  await t.call("cancelVisit", { key: vw.key });
  assert.deepStrictEqual(t.events.filter((e) => e.type === "progress").map((e) => e.data), [{ done: 0, total: 1 }]);
});

test("bulk time changes preview, apply to planned items and bookings, and undo", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  const vw = (await t.call("list", {})).rows.find((r) => r.vrn === "VW55XYZ");
  const keys = ["e:1", vw.sel];
  const pv = await t.call("bulkTimes", { keys, mode: "shift", shift: 15 });
  assert.deepStrictEqual([pv.ok, pv.text, pv.apply], [2, "2 will change (1 booking goes into your plan to be cancelled and rebooked).", "Apply to 2"]);
  assert.strictEqual((await t.call("bulkTimes", { keys, mode: "shift", shift: 0 })).text, "Choose how many minutes to move by.");
  assert.deepStrictEqual([(await t.call("bulkTimes", { keys, mode: "set" })).from, (await t.call("bulkTimes", { keys, mode: "set" })).to], [630, 690], "set starts from the first item");
  const bad = await t.call("bulkTimes", { keys, mode: "shift", shift: 900 });
  assert.deepStrictEqual([bad.ok, bad.bad.length], [0, 2]);
  const r = await t.call("bulkMove", { keys, mode: "shift", shift: 15 });
  assert.match(r.toast, /^2 changed\. 1 booking change is in your plan/);
  const saved = await until(() => { const p = t.storage["vb:plan:x80b66f1c3b5e7742"]; return p && p.length === 2 && p; });
  assert.deepStrictEqual([saved[0].from, saved[0].to], [645, 705]);
  assert.deepStrictEqual([saved[1].vrn, saved[1].from, saved[1].to, saved[1].replaces], ["VW55XYZ", 615, 675, ["xd771d26b887ce0ee"]]);
  await t.call("undo", { id: r.undo });
  const back = await until(() => { const p = t.storage["vb:plan:x80b66f1c3b5e7742"]; return p && p.length === 1 && p; });
  assert.deepStrictEqual([back[0].from, back[0].to], [630, 690]);
});

test("day and board views place bookings and plans on the right day and time", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  const day = await t.call("day", { dk: "2026-09-28" });
  assert.deepStrictEqual([day.from, day.to, day.now], [540, 780, 630]);
  const alex = day.lanes.find((l) => l.vrn === "TU44VWX");
  assert.deepStrictEqual(alex.blocks.map((b) => [b.f, b.t, b.status]), [[600, 720, "live"]]);
  const week = await t.call("board", { zoom: "week", dk: "2026-09-28" });
  assert.strictEqual(week.days.length, 7);
  const harper = week.lanes.find((l) => l.vrn === "GH78JKL");
  assert.deepStrictEqual(harper.blocks.map((b) => [b.kind, b.dayIndex, b.f]), [["entry", 1, 630]]);
  assert.deepStrictEqual(week.now, { dayIndex: 0, min: 630 });
});

test("cancelling a booking goes through the engine and returns a message", async () => {
  const t = await setup({ live: true });
  const v = await t.call("visit", { key: "VW55XYZ|2026-09-30|600" });
  assert.strictEqual(v.canCancel, true);
  assert.strictEqual(v.cancelText, "1 voucher goes back to your unused vouchers.");
  const r = await t.call("cancelVisit", { key: v.key });
  assert.match(r.toast, /^Cancelled\. 1 voucher returned/);
  assert.ok(t.site.cancelled.has("xd771d26b887ce0ee"));
});

test("removing from the plan can be undone", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  const id = (await t.call("plan")).items[0].id;
  const r = await t.call("removeEntry", { id });
  assert.strictEqual(r.toast, "Removed from your plan.");
  assert.strictEqual((await t.call("plan")).empty, true);
  await t.call("undo", { id: r.undo });
  assert.strictEqual((await t.call("plan")).items.length, 1);
});

test("an unknown call is refused", async () => {
  const t = await setup();
  await assert.rejects(() => t.call("deleteEverything"), /unknown engine call/);
});

test("demo mode runs on a made-up permit, with no council requests and nothing saved", async () => {
  const t = await setup();
  const before = t.site.calls.length, saved = JSON.stringify(t.storage);
  const r = await t.call("startDemo");
  assert.match(r.toast, /^Demo: a made-up permit/);
  const home = await t.call("home");
  assert.deepStrictEqual([home.phase, home.demo, home.testMode, home.zone.code], ["ready", true, false, "B1"]);
  assert.match(home.balance, /^8 × 1 hour/);
  const today = await t.call("today");
  assert.deepStrictEqual(today.live.map((v) => [v.plate, v.ends]), [["TU44 VWX", "Ends 12:00"]], "a visitor parked now, for the Live Activity");
  assert.ok(today.next.some((x) => x.plate === "VW55 XYZ"), "upcoming bookings");
  assert.strictEqual((await t.call("more")).demo, true);
  assert.strictEqual(t.site.calls.length, before, "nothing went to the council site");
  assert.strictEqual(JSON.stringify(t.storage), saved, "the user's plans and settings are untouched");
});

test("in demo mode, booking, cancelling and buying work without the council site", async () => {
  const t = await setup();
  const before = t.site.calls.length;
  await t.call("startDemo");
  await t.call("addDraft", { vrn: "GH78JKL", dk: "2026-09-29", from: 600, to: 660 });
  await t.call("review");
  await t.call("runGo");
  const run = await until(async () => { const v = await t.call("run"); return v && v.phase === "done" ? v : null; });
  assert.strictEqual(run.ok, true, run.note);
  assert.ok(t.native.includes("notify.permission"), "asks for notifications after the first booking, so reminders arrive");
  const v = await t.call("visit", { key: "GH78JKL|2026-09-29|600" });
  assert.strictEqual(v.canCancel, true);
  assert.match((await t.call("cancelVisit", { key: v.key })).toast, /^Cancelled\. 1 voucher returned/);
  const buy = await t.call("buy", { kind: "h1", n: 10 });
  assert.match(buy.toast, /^With your own account, this opens the council's Buy Again form/);
  assert.ok(!t.native.includes("council.show"), "the demo never opens the council site");
  assert.match((await t.call("openCouncil")).toast, /The demo has no council site/);
  assert.strictEqual(t.site.calls.length, before, "nothing went to the council site");
});

test("leaving the demo goes back to the user's own account and settings", async () => {
  const t = await setup();
  await t.call("startDemo");
  await t.call("setSetting", { key: "emailAll", value: true });
  await t.call("leaveDemo");
  const home = await t.call("home");
  assert.deepStrictEqual([home.phase, home.demo, home.testMode, home.zone.code], ["ready", false, true, "P"]);
  assert.deepStrictEqual(t.storage["vb:settings"], { testMode: true }, "demo settings weren't saved");
  assert.ok(t.native.includes("notify.schedule"), "demo reminders are cleared");
});

test("signing out of the demo leaves it", async () => {
  const t = await setup();
  await t.call("startDemo");
  await t.call("signOut");
  assert.strictEqual((await t.call("home")).demo, false);
  assert.ok(!t.native.includes("council.signOut"), "the real council session is left alone");
});

