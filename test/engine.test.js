// The engine as native screens use it: apps/mobile/www/engine.html's scripts, driven through VBEngine.call.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { fakeSite, MAIN, SECOND, OTHER } = require("./fakesite.js");
const TERMS = require("../extension/src/terms.js");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const NOW = "2026-09-28T10:30:00"; // TU44VWX's 10:00–12:00 is running; VW55XYZ is booked 10:00 on Wed 30 Sep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(10); } throw new Error("timed out"); }

const opened = [];
test.afterEach(() => { for (const w of opened.splice(0)) w.close(); });

async function setup({ plan = null, live = false, noTerms = false, multi = false, secondOlder = false, secondEmpty = false, long = false, now = NOW, saved = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://appassets.androidplatform.net/www/engine.html", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  opened.push(w);
  const RD = w.Date; let fixed = new RD(now).getTime();
  w.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const storage = {};
  if (plan) storage["vb:plan:x80b66f1c3b5e7742"] = plan;
  if (!noTerms) storage["vb:terms"] = { version: TERMS.VERSION };
  if (!live) storage["vb:settings"] = { testMode: true };
  Object.assign(storage, saved);
  const site = fakeSite(w, { multi, secondOlder, secondEmpty, long }), events = [], native = [], shown = [], external = [];
  const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  w.VBDev = {
    async call(cmd, args) {
      native.push(cmd);
      if (cmd === "notify.permission") return { granted: true };
      if (cmd === "engine.event") { events.push(copy(args)); return null; }
      if (cmd === "openExternal") { external.push(args.url); return null; }
      if (cmd === "council.show") { shown.push(copy(args)); return null; }
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
  w.eval(read("apps", "mobile", "www", "native.js"));
  for (const f of ["zones.js", "planner.js", "portal.js", "terms.js", "model.js", "reminders.js", "plates.js"]) w.eval(read("extension", "src", f));
  for (const f of ["demo.js", "engine.js", "views.js", "engine-host.js"]) w.eval(read("apps", "mobile", "www", f));
  w.VB.portal.GAP_MS = 0;
  const call = async (name, args) => copy(await w.VBEngine.call(name, args)); // results into this realm, for deepStrictEqual
  await w.VB.engine.start();
  const at = (s) => { fixed = new RD(s).getTime(); w.VB.engine.tick(); };
  return { w, call, site, storage, events, native, shown, external, at };
}

test("the engine page loads the same scripts the tests do", () => {
  const html = read("apps", "mobile", "www", "engine.html");
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
  assert.deepStrictEqual([...home.vouchers].map((v) => ({ ...v })), [{ kind: "h1", n: 9, label: "1 hour" }]);
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

test("quick-book starting now: a chosen length moves with the clock, an Until picked by hand stays", async () => {
  const t = await setup({ live: true });
  const v = await t.call("quickInit", { opts: { vrns: ["LM11NPR"] } });
  assert.deepStrictEqual([v.fromText, v.toText], ["10:30", "11:30"]);
  t.at("2026-09-28T10:39:20");
  let w = await t.call("quickView", { q: v.q });
  assert.deepStrictEqual([w.fromText, w.toText], ["10:39", "11:39"]);
  assert.match((await t.call("confirm", { q: v.q, email: false })).timeText, /^10:39 – 11:39/);
  const h = await t.call("quickTime", { q: structuredClone(v.q), which: "to", min: 700 });
  t.at("2026-09-28T10:44:00");
  w = await t.call("quickView", { q: h.q });
  assert.deepStrictEqual([w.fromText, w.toText], ["10:44", "11:40"]);
  await t.call("bookNow", { q: v.q, email: false });
  await until(async () => { const r = await t.call("run"); return r && r.phase === "done" && r; });
  const sent = t.site.calls.find((x) => x.m === "POST" && x.path === "/Permit/GetVisitorVoucherConfirmation");
  assert.match(String(sent.body), /FromTime=10%3A44&.*IsActivateNow=true/, "starts at the current minute");
  t.at("2026-09-28T11:20:00");
  w = await t.call("quickView", { q: v.q });
  assert.deepStrictEqual([w.fromText, w.toText], ["11:20", "12:00"], "Until stops where controls end");
  w = await t.call("quickPreset", { q: w.q, preset: "2h" });
  assert.strictEqual(w.toText, "12:00");
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
  assert.match(l.note, /^(\d+ finished bookings? hidden\. Turn on Show finished|Finished bookings are hidden\.)/, "says finished ones are hidden");
  assert.strictEqual((await t.call("list", { past: true })).note, "");
  assert.match((await t.call("list", { vrns: ["NOSUCH1"] })).empty, /^Nothing for this vehicle/);
  const only = await t.call("list", { vrns: ["VW55XYZ"] });
  assert.ok(only.rows.length && only.rows.every((r) => r.vrn === "VW55XYZ"));
  assert.ok(only.vehicles.find((v) => v.vrn === "VW55XYZ").on);
});

test("the plan counts vouchers still to buy, so the not-enough rows add up", async () => {
  const days = ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"]; // 12 hours; 9 unused
  const t = await setup({ plan: days.map((dk, i) => ({ id: i + 1, vrn: "GH78JKL", dk, from: 600, to: 720 })) });
  const plan = await t.call("plan");
  const missing = plan.items.filter((it) => it.bad).length;
  assert.ok(missing > 0, "some rows aren't covered");
  assert.match(plan.subtitle, /^12 vouchers to book, \d still to buy\./);
  assert.match(plan.cost, /^Your vouchers cover \d+ × 1 hour · £/);
  const tray = (await t.call("home")).tray;
  assert.deepStrictEqual([tray.title, tray.short], ["12 vouchers planned", "12 planned"], "no cost while some aren't bought");
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

test("the board tells VoiceOver each booking's day, plate, time and state, and has short day names", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  const week = await t.call("board", { zoom: "week", dk: "2026-09-28" });
  assert.strictEqual(week.lanes.find((l) => l.vrn === "TU44VWX").blocks[0].say, "Monday 28 Sep, T U 4 4 V W X, 10:00 to 12:00, on now");
  assert.strictEqual(week.lanes.find((l) => l.vrn === "GH78JKL").blocks[0].say, "Tuesday 29 Sep, G H 7 8 J K L, 10:30 to 11:30, planned");
  assert.deepStrictEqual([week.days[0].label, week.days[0].short], ["Mon 28", "Mo 28"]);
});

test("turning sideways for the board is off by default, and messages can stay longer or until closed", async () => {
  const t = await setup();
  const home = await t.call("home");
  assert.deepStrictEqual([home.rotateBoard, home.messageTime], [false, 1]);
  const more = await t.call("more");
  assert.deepStrictEqual([...more.messageTimes].map((m) => m.value), [1, 2, 5, 10, 0]);
  assert.strictEqual(more.accessibilityUrl, "https://voucherboard.mariusrubin.com/accessibility.html");
  assert.strictEqual((await t.call("setSetting", { key: "messageTime", value: 0 })).err, undefined);
  assert.strictEqual((await t.call("setSetting", { key: "rotateBoard", value: true })).err, undefined);
  assert.deepStrictEqual([(await t.call("home")).messageTime, (await t.call("home")).rotateBoard], [0, true]);
  assert.ok((await t.call("setSetting", { key: "messageTime", value: 3 })).err, "only the offered times");
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
  assert.strictEqual(home.balance, "12 × 1 hour · 3 × 5 hours · 1 × 1 day · 1 × 1 week", "two permits' vouchers together");
  const long = (await t.call("list", {})).rows.filter((r) => / – \w{3} \d+ \w{3} 09:00$/.test(r.time)).map((r) => r.plate);
  assert.deepStrictEqual(long, ["VW55 XYZ", "GH78 JKL"], "a day and a week booking, each shown to its end");
  assert.deepStrictEqual((await t.call("more")).permits.map((p) => [p.label, p.on]), [["LV-00012345", true], ["LV-00012346", true]]);
  const today = await t.call("today");
  assert.deepStrictEqual(today.live.map((v) => [v.plate, v.ends]), [["TU44 VWX", "Ends 12:00"]], "a visitor parked now, for the Live Activity");
  assert.ok(today.next.some((x) => x.plate === "VW55 XYZ"), "upcoming bookings");
  assert.strictEqual((await t.call("more")).demo, true);
  assert.strictEqual(t.site.calls.length, before, "nothing went to the council site");
  assert.strictEqual(JSON.stringify(t.storage), saved, "the user's plans and settings are untouched");
});

test("buying checks the council's limits, then opens the Buy Again form in the council view", async () => {
  const t = await setup();
  assert.deepStrictEqual(await t.call("buy", { kind: "h1", n: 10 }), {});
  assert.ok(t.site.calls.some((c) => c.path === "/VoucherBuyAgain/ValidateBuyAgainLimits"));
  assert.strictEqual(t.shown.length, 1);
  assert.deepStrictEqual({ ...t.shown[0], buy: undefined }, { reason: "buy", path: "/Home/ApplicantPermits", buy: undefined });
  assert.strictEqual(t.shown[0].buy.label, "10 × 1 hour");
  assert.strictEqual(t.shown[0].buy.messageTime, 1, "the council page's notice stays as long as the app's messages");
});

test("if paying fails in the app, buying in the phone's browser is the fallback", async () => {
  const t = await setup();
  assert.match((await t.call("buyInBrowser")).toast, /^Buy on the council site in your browser/);
  assert.deepStrictEqual(t.external, ["https://parkingpermits.lewisham.gov.uk/Home/ApplicantPermits"]);
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


// ---------- several permits ----------
test("More picks a zone, then which of its permits pool their vouchers", async () => {
  const t = await setup({ multi: true });
  let more = await t.call("more");
  assert.deepStrictEqual(more.zones.map((z) => [z.code, z.detail, z.selected]), [["P", "2 permits", true], ["V", "LV-00000004", false]]);
  assert.deepStrictEqual(more.permits.map((p) => [p.label, p.detail, p.on, p.locked]),
    [["LV-00000001", "9 × 1 hour", true, false], ["LV-00000002", "3 × 1 hour, 2 × 5 hours", true, false]]);
  assert.match(more.permitsNote, /every permit that's on/);
  assert.strictEqual(more.permit, null);
  assert.strictEqual((await t.call("home")).balance, "12 × 1 hour · 2 × 5 hours");

  await t.call("setPermitOn", { id: SECOND, on: false });
  more = await t.call("more");
  assert.deepStrictEqual(more.permits.map((p) => [p.on, p.locked, p.detail]), [[true, true, "9 × 1 hour"], [false, false, "Not in use"]]);
  assert.deepStrictEqual(t.storage["vb:permits"], { zone: "P", off: [SECOND] });
  assert.strictEqual((await t.call("home")).balance, "9 × 1 hour");
  assert.ok((await t.call("setPermitOn", { id: MAIN, on: false })).err, "the last permit stays on");

  await t.call("setZone", { code: "V" });
  more = await t.call("more");
  assert.deepStrictEqual([more.zones.find((z) => z.selected).code, more.permits.length], ["V", 0]);
  assert.strictEqual((await t.call("home")).balance, "4 × 1 hour");
  assert.strictEqual(t.storage["vb:permit"], OTHER);
});

test("a visit says which permits its vouchers came from, only when several are in use", async () => {
  const t = await setup({ multi: true });
  const v = await t.call("visit", { key: "VW55XYZ|2026-09-30|600" });
  assert.deepStrictEqual([v.time, v.vouchersText, v.permits], ["10:00 – 12:00", "2 vouchers", "From LV-00000001 and LV-00000002"]);
  const one = await setup();
  assert.strictEqual((await one.call("visit", { key: "VW55XYZ|2026-09-30|600" })).permits, null);
  const more = await one.call("more");
  assert.deepStrictEqual([more.zones.length, more.permits.length, more.permit], [0, 0, "LV-00000001 · P"]);
});

test("a run takes vouchers from every permit in use, and books each on its own permit", async () => {
  const days = ["2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"];
  const t = await setup({ multi: true, live: true, saved: { "vb:plan:zone:P": days.map((dk, i) => ({ id: i + 1, vrn: "GH78JKL", dk, from: 600, to: 720 })) } });
  assert.strictEqual((await t.call("plan")).reviewLabel, "Review 10 changes");
  await t.call("review");
  await t.call("runGo");
  const run = await until(async () => { const r = await t.call("run"); return r.phase === "done" && r; }, 8000);
  assert.match(run.note, /^10 booked/);
  assert.strictEqual(run.ops[9].statusText, "Booked ✓ · LV-00000002");
  const posts = t.site.calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body).get("visitorPermit[PermitId]"));
  assert.deepStrictEqual(posts, [...Array(9).fill(MAIN), SECOND]);
});

test("vouchers come from the oldest permit first, and purchases go to the newest", async () => {
  const days = ["2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"];
  const plan = days.map((dk, i) => ({ id: i + 1, vrn: "GH78JKL", dk, from: 600, to: 720 }));
  const permitOf = (c) => new URLSearchParams(c.body).get("visitorPermit[PermitId]") || new URLSearchParams(c.body).get("permitId");
  const t = await setup({ multi: true, secondOlder: true, live: true, saved: { "vb:plan:zone:P": plan } });
  assert.deepStrictEqual((await t.call("more")).permits.map((p) => p.label), ["LV-00000002", "LV-00000001"], "listed in the order they're used");
  assert.strictEqual(permitOf(t.site.calls.find((c) => c.path === "/VoucherBuyAgain/VoucherSelect")), MAIN, "prices from the newest");
  await t.call("buy", { kind: "h1", n: 1 });
  assert.strictEqual(permitOf(t.site.calls.find((c) => c.path === "/VoucherBuyAgain/ValidateBuyAgainLimits")), MAIN);
  await t.call("review");
  await t.call("runGo");
  await until(async () => (await t.call("run")).phase === "done", 8000);
  const posts = t.site.calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map(permitOf);
  assert.deepStrictEqual(posts, [...Array(3).fill(SECOND), ...Array(7).fill(MAIN)], "the older permit's 3 one-hour vouchers first");

  const n = await setup({ multi: true });
  await n.call("buy", { kind: "h1", n: 1 });
  assert.strictEqual(permitOf(n.site.calls.find((c) => c.path === "/VoucherBuyAgain/ValidateBuyAgainLimits")), SECOND, "LV-00000002 is newer by default");
});

test("More keeps the permits in one order, oldest first, while they're turned on and off", async () => {
  const labels = async (t) => (await t.call("more")).permits.map((p) => p.label);
  const t = await setup({ multi: true, secondOlder: true });
  assert.deepStrictEqual(await labels(t), ["LV-00000002", "LV-00000001"]);
  await t.call("setPermitOn", { id: SECOND, on: false });
  assert.deepStrictEqual(await labels(t), ["LV-00000002", "LV-00000001"], "the one turned off keeps its place");
  await t.call("setPermitOn", { id: SECOND, on: true });
  await t.call("setPermitOn", { id: MAIN, on: false });
  assert.deepStrictEqual(await labels(t), ["LV-00000002", "LV-00000001"]);
  assert.deepStrictEqual(t.storage["vb:permitAges"], { [MAIN]: "2026-07-11", [SECOND]: "2026-01-01" });

  // a permit turned off before this session: its remembered date places it
  const again = await setup({ multi: true, secondOlder: true, saved: { "vb:permits": { zone: "P", off: [SECOND] }, "vb:permitAges": { [SECOND]: "2026-01-01" } } });
  assert.deepStrictEqual(await labels(again), ["LV-00000002", "LV-00000001"]);
});

test("More shows a permit with no vouchers as off, and it can't be turned on", async () => {
  const t = await setup({ multi: true, secondEmpty: true });
  const more = await t.call("more");
  assert.deepStrictEqual(more.permits.map((p) => [p.label, p.on, p.locked, p.detail]),
    [["LV-00000001", true, true, "9 × 1 hour"], ["LV-00000002", false, true, "No unused vouchers"]]);
  assert.ok((await t.call("setPermitOn", { id: MAIN, on: false })).err, "the only permit with vouchers stays on");
  assert.strictEqual((await t.call("visit", { key: "VW55XYZ|2026-09-30|600" })).permits, "From LV-00000001 and LV-00000002");
});

test("switching permits in a zone shows at once, and reads only a permit turned on", async () => {
  const t = await setup({ multi: true });
  let n = t.site.calls.length;
  await t.call("setPermitOn", { id: SECOND, on: false });
  assert.deepStrictEqual(t.site.calls.slice(n), [], "turning off sends nothing");
  assert.strictEqual((await t.call("home")).balance, "9 × 1 hour");

  t.w.VB.portal.GAP_MS = 150; // slow enough to see the switch while its permit is read
  n = t.site.calls.length;
  const turning = t.call("setPermitOn", { id: SECOND, on: true });
  const mid = await until(async () => { const p = (await t.call("more")).permits.find((x) => x.id === SECOND); return p.detail === "Loading…" && p; });
  assert.deepStrictEqual([mid.on, mid.locked], [true, true], "on straight away, and can't be switched again until read");
  await turning;
  assert.deepStrictEqual(t.site.calls.slice(n).map((c) => c.path), ["/Permit/Details"], "only the permit turned on is read");
  const after = (await t.call("more")).permits.find((x) => x.id === SECOND);
  assert.deepStrictEqual([after.on, after.detail], [true, "3 × 1 hour, 2 × 5 hours"]);
  assert.strictEqual((await t.call("home")).balance, "12 × 1 hour · 2 × 5 hours");
  assert.strictEqual((await t.call("visit", { key: "VW55XYZ|2026-09-30|600" })).permits, "From LV-00000001 and LV-00000002", "its bookings are back");
});

// As the live site showed them on 24 Oct: TU44VWX booked for 5 hours on 26 Oct, a day on 27 Oct and a week from 2 Nov.
const LONG_NOW = "2026-10-24T08:20:00";
test("5-hour, day and week bookings show at their full length, on every day they cover", async () => {
  const t = await setup({ long: true, now: LONG_NOW });
  assert.strictEqual((await t.call("home")).balance, "13 × 1 hour · 1 × 5 hours · 1 × 1 day · 1 × 1 week");
  assert.deepStrictEqual((await t.call("list", {})).rows.map((r) => [r.dk, r.time, r.pick]),
    [["2026-10-26", "10:00 – 15:00", true], ["2026-10-27", "10:00 – Wed 28 Oct 10:00", true], ["2026-11-02", "10:00 – Mon 9 Nov 10:00", true]]);
  assert.deepStrictEqual((await t.call("agenda", { dk: "2026-11-05" })).items.map((r) => r.time), ["10:00 – Mon 9 Nov 10:00"]);
  const cal = (await t.call("calendar", { sel: "2026-11-05" })).days.filter((d) => d.booked).map((d) => d.dk);
  assert.deepStrictEqual(cal, ["2026-10-26", "2026-10-27", "2026-10-28", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
  const wk = (await t.call("board", { zoom: "week", dk: "2026-11-02" })).lanes.find((l) => l.vrn === "TU44VWX").blocks;
  assert.deepStrictEqual(wk.map((b) => [b.dayIndex, b.f, b.t]), [[0, 600, 1440], ...[1, 2, 3, 4, 5, 6].map((i) => [i, 0, 1440])]);
  assert.strictEqual(wk[3].say, "Monday 2 Nov, T U 4 4 V W X, 10:00 to Mon 9 Nov 10:00, booked");
  const morning = (await t.call("day", { dk: "2026-10-28" })).lanes.find((l) => l.vrn === "TU44VWX").blocks;
  assert.deepStrictEqual(morning.map((b) => [b.key, b.f, b.t]), [["TU44VWX|2026-10-27|600", 0, 600]]);
  const v = await t.call("visit", { key: "TU44VWX|2026-11-02|600" });
  assert.deepStrictEqual([v.starts, v.ends, v.vouchersText, v.vouchers[0].label, v.canCancel, v.canChange], ["Mon 2 Nov, 10:00", "Mon 9 Nov, 10:00", "1 × 1 week", "1 week", true, false]);
  const short = await t.call("visit", { key: "TU44VWX|2026-10-26|600" });
  assert.deepStrictEqual([short.starts, short.ends, short.dayText, short.time], [null, null, "Mon 26 Oct", "10:00 – 15:00"], "within a day: its day and times");
  const q = await t.call("quickInit", { opts: { vrns: ["TU44VWX"], days: ["2026-11-05"], from: 600, to: 720 } });
  assert.strictEqual(q.preview.text, "Already covered at these times. No voucher needed.");
});

test("cancelling a week booking sends what the live site sent", async () => {
  const t = await setup({ long: true, now: LONG_NOW, live: true });
  const r = await t.call("cancelVisit", { key: "TU44VWX|2026-11-02|600" });
  assert.match(r.toast, /^Cancelled\. 1 voucher returned/);
  const post = t.site.calls.find((c) => c.path === "/Permit/CancelVisitorVoucher");
  assert.strictEqual(post.body, "__RequestVerificationToken=TEST-TOKEN&Id=xe585676b2ac60909&ReturnUrl=");
});

test("a run that has to move a voucher past the end of controls stops before asking the council", async () => {
  const t = await setup({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-28", from: 660, to: 720 }] });
  await t.call("review");
  t.at("2026-09-28T12:05:00");
  await t.call("runGo");
  const run = await until(async () => { const r = await t.call("run"); return r.phase === "done" && r; });
  assert.match(run.note, /12:05 is outside controlled hours, so the council site won't take a voucher starting then\./);
  assert.ok(!t.site.calls.some((c) => c.path === "/Permit/VisitorPermit" || c.path === "/Permit/GetNonEnforceableCoverage"));
});

test("Choose vouchers yourself: quick-book, entries and changes take one voucher type", async () => {
  const t = await setup({ long: true, now: LONG_NOW });
  let v = await t.call("quickInit", { opts: { vrns: ["LM11NPR"], days: ["2026-10-29"], from: 600, to: 720 } });
  assert.strictEqual(v.kinds, null, "off by default");
  assert.match(v.preview.text, /^Uses 2 × 1 hour/);
  assert.strictEqual((await t.call("setSetting", { key: "pickKinds", value: true })).err, undefined);
  v = await t.call("quickView", { q: v.q });
  assert.deepStrictEqual(v.kinds.map((k) => [k.id, k.label, k.detail, k.on]), [["", "Cheapest mix", "", true], ["h1", "1 hour", "13 unused", false], ["h5", "5 hours", "1 unused", false], ["day", "1 day", "1 unused", false], ["week", "1 week", "1 unused", false]]);
  v = await t.call("quickKind", { q: v.q, kind: "week" });
  assert.match(v.preview.text, /^Uses 1 × 1 week/);
  await t.call("addToPlan", { q: v.q });
  const saved = t.storage["vb:plan:x80b66f1c3b5e7742"];
  assert.deepStrictEqual(saved.map((e) => [e.dk, e.from, e.kind]), [["2026-10-29", 600, "week"]]);
  const e = await t.call("entry", { id: saved[0].id });
  assert.strictEqual(e.kinds.find((k) => k.on).id, "week");
  assert.match(e.cost, /^Uses 1 × 1 week/);
  await t.call("setEntryTime", { id: saved[0].id, from: 600, to: 720, kind: "" });
  assert.strictEqual(t.storage["vb:plan:x80b66f1c3b5e7742"][0].kind, undefined, "back to the cheapest mix");
  await t.call("planChange", { key: "TU44VWX|2026-10-26|600", from: 600, to: 900, kind: "day" });
  assert.strictEqual(t.storage["vb:plan:x80b66f1c3b5e7742"].find((x) => x.replaces).kind, "day", "a booking's change keeps its time and takes another type");
});

test("quick-book start to end: one booking over several days, its mode remembered, and changed as one", async () => {
  const t = await setup();
  let v = await t.call("quickInit", { opts: { vrns: ["LM11NPR"] } });
  v = await t.call("quickMode", { q: v.q, mode: "stay" });
  assert.deepStrictEqual([v.mode, v.stay.now, v.stay.startDk, v.stay.endDk], ["stay", true, "2026-09-28", "2026-09-28"], "starts now, as the form did");
  v = await t.call("quickStay", { q: v.q, which: "start", dk: "2026-10-02", min: 1020 });
  v = await t.call("quickStay", { q: v.q, which: "end", dk: "2026-10-05", min: 660 });
  assert.deepStrictEqual([v.stay.now, v.stay.startMin, v.stay.endDk, v.stay.endMin], [false, 1020, "2026-10-05", 660]);
  assert.match(v.preview.text, /^Uses 1 × 1 hour/);
  assert.ok(v.preview.notes.includes("1 h of controlled hours over 1 day. The rest needs no voucher."));
  const c = await t.call("confirm", { q: v.q, email: false });
  assert.deepStrictEqual([c.dayLabel, c.dayText, c.timeLabel, c.timeText], ["Starts", "Fri 2 Oct, 17:00", "Ends", "Mon 5 Oct, 11:00"]);
  v = await t.call("quickPreset", { q: v.q, preset: "1w" });
  assert.deepStrictEqual([v.stay.endDk, v.stay.endMin], ["2026-10-09", 1020]);
  await t.call("addToPlan", { q: v.q });
  const e = t.storage["vb:plan:x80b66f1c3b5e7742"][0];
  assert.deepStrictEqual([e.dk, e.from, e.to], ["2026-10-02", 1020, 7 * 1440 + 1020]);
  assert.strictEqual((await t.call("plan")).items[0].time, "17:00 – Fri 9 Oct 17:00");
  assert.ok((await t.call("agenda", { dk: "2026-10-04" })).items.some((x) => x.kind === "entry"), "shows on the days in between");
  const ev = await t.call("entry", { id: e.id });
  assert.deepStrictEqual([ev.dayText, ev.stay.toDk, ev.from, ev.to], ["Fri 2 Oct – Fri 9 Oct", "2026-10-09", 1020, 1020]);
  const r = await t.call("setEntryTime", { id: e.id, from: 600, to: 720, dk: "2026-10-05", toDk: "2026-10-06" });
  assert.match(r.toast, /Changed to Mon 5 Oct 10:00 – Tue 6 Oct 12:00/);
  assert.strictEqual(t.storage["vb:settings"].bookMode, "stay");
  assert.strictEqual((await t.call("quickInit", { opts: {} })).mode, "stay", "the next form opens in the same mode");
});

test("quick-book start to end: tap the first and last day, and each day says its controls", async () => {
  const t = await setup();
  let v = await t.call("quickInit", { opts: { vrns: ["LM11NPR"] } });
  v = await t.call("quickMode", { q: v.q, mode: "stay" });
  assert.strictEqual(v.modeNote, "One booking from start to end.");
  v = await t.call("quickStayPick", { q: v.q, dk: "2026-10-02" });
  assert.deepStrictEqual([v.stay.now, v.stay.startDk, v.stay.endDk, v.stay.hint], [false, "2026-10-02", "2026-10-02", "Now tap the last day."]);
  v = await t.call("quickStayPick", { q: v.q, dk: "2026-10-05" });
  const cal = Object.fromEntries(v.stay.calendar.map((d) => [d.dk, d.on ? "on" : d.mid ? "mid" : ""]));
  assert.deepStrictEqual([cal["2026-10-02"], cal["2026-10-03"], cal["2026-10-04"], cal["2026-10-05"], cal["2026-10-06"]], ["on", "mid", "mid", "on", ""]);
  const ctl = Object.fromEntries(v.stay.days.map((d) => [d.dk, d.ctl]));
  assert.deepStrictEqual([ctl["2026-10-02"], ctl["2026-10-03"]], ["Controls 10–12", "No controls"]);
  assert.strictEqual((await t.call("quickMode", { q: v.q, mode: "repeat" })).modeNote, "The same times on each day you pick.");
});
