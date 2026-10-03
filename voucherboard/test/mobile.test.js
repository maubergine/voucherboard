// Runs the mobile app's UI (mobile/www) against the fake council site, through a stand-in for the app's bridge.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { fakeSite } = require("./fakesite.js");
const TERMS = require("../src/terms.js");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const NOW = "2026-09-28T10:30:00"; // TU44VWX's 10:00–12:00 is running; VW55XYZ is booked 10:00 on Wed 30 Sep
const PLAN_KEY = "vb:plan:x80b66f1c3b5e7742";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(10); } throw new Error("timed out"); }

const opened = [];
test.afterEach(() => { for (const w of opened.splice(0)) w.close(); });

function setup({ plan = null, noTerms = false, live = false, loggedOut = false } = {}) {
  const dom = new JSDOM(read("mobile", "www", "index.html"), { url: "https://appassets.androidplatform.net/www/index.html", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  opened.push(w);
  const RD = w.Date, fixed = new RD(NOW).getTime();
  w.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  const storage = {};
  if (plan) storage[PLAN_KEY] = plan;
  if (!noTerms) storage["vb:terms"] = { version: TERMS.VERSION };
  if (!live) storage["vb:settings"] = { testMode: true };
  const site = fakeSite(w, { loggedOut });
  const bridge = [];
  const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  w.VBDev = {
    async call(cmd, args) {
      bridge.push({ cmd, args: copy(args) });
      if (cmd === "hello") return { platform: "test", version: "9.8.7" };
      if (cmd === "store.get") return copy(storage[args.key]);
      if (cmd === "store.set") { storage[args.key] = copy(args.value); return null; }
      if (cmd === "store.remove") { delete storage[args.key]; return null; }
      if (cmd === "notify.permission") return { granted: true };
      if (cmd === "council.fetch") {
        const r = await site.fetch(args.path, { method: args.method, body: args.body });
        let body = await r.text();
        if (!body) { try { body = JSON.stringify(await r.json()); } catch (e) { body = ""; } }
        return { status: r.status, url: r.url, body };
      }
      return null;
    }
  };
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.VB_MANUAL_START = true;
  w.eval(read("mobile", "www", "native.js"));
  for (const f of ["zones.js", "planner.js", "portal.js", "terms.js", "model.js", "reminders.js"]) w.eval(read("src", f));
  w.eval(read("mobile", "www", "mobile.js"));
  w.VB.portal.GAP_MS = 0;
  const $ = (s) => w.document.querySelector(s);
  const click = (s) => { const el = $(s); assert.ok(el, "missing " + s); el.click(); };
  const text = (s) => ($(s) ? $(s).textContent : "");
  const booked = () => site.calls.some((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit");
  return { w, $, click, text, site, storage, bridge, booked, start: () => w.VB.mobile.start() };
}
async function ready(opts) { const t = setup(opts); await t.start(); await until(() => t.$(".tabs")); return t; }

test("reads nothing from the council until the terms are accepted", async () => {
  const t = setup({ noTerms: true });
  await t.start();
  await until(() => t.$("#tAgree"));
  assert.strictEqual(t.site.calls.length, 0, "no council requests before accepting");
  assert.strictEqual(t.$("#tAccept").disabled, true);
  assert.match(t.text("#page"), /runs only on your device/);
  t.click("#tAgree");
  assert.strictEqual(t.$("#tAccept").disabled, false);
  t.click("#tAccept");
  await until(() => t.$(".tabs"));
  assert.strictEqual(t.storage["vb:terms"].version, TERMS.VERSION);
  assert.ok(t.site.calls.length > 0);
});

test("Today shows the visit in progress, the zone's hours, the balance and test mode", async () => {
  const t = await ready();
  const txt = t.text(".portrait");
  assert.match(txt, /Hither Green East/);
  assert.match(txt, /Controlled now, until 12:00/);
  assert.match(txt, /9 × 1 hour/);
  assert.match(t.text(".card.now"), /TU44 VWX/);
  assert.match(t.text(".card.now"), /Ends 12:00/);
  assert.ok(t.$(".tag.test"), "test mode is flagged");
});

test("books a favourite now, only after the check-and-book step", async () => {
  const t = await ready({ live: true });
  t.click('.chip[data-a="quick"][data-vrn="LM11NPR"]');
  assert.match(t.text("#qcost"), /Uses 1 × 1 hour/);
  t.click('[data-a="qbook"]');
  assert.match(t.text("#layer"), /Check and book/);
  assert.match(t.text("#layer"), /10:30 – 11:30, starting now/);
  assert.strictEqual(t.booked(), false, "nothing booked before the button");
  t.click('[data-a="cgo"]');
  await until(() => t.$('[data-a="runclose"]'), 5000);
  assert.match(t.text("#page"), /1 booked/);
  assert.strictEqual(t.booked(), true);
});

test("in test mode, Book now checks the booking but books nothing and leaves the plan alone", async () => {
  const t = await ready();
  t.click('.chip[data-a="quick"][data-vrn="LM11NPR"]');
  t.click('[data-a="qbook"]');
  assert.match(t.text('[data-a="cgo"]'), /Run test/);
  t.click('[data-a="cgo"]');
  await until(() => t.$('[data-a="runclose"]'), 5000);
  assert.match(t.text("#page"), /Test passed/);
  assert.strictEqual(t.booked(), false);
  assert.deepStrictEqual(t.storage[PLAN_KEY] || [], []);
});

test("adds to the plan, then reviews and runs it", async () => {
  const t = await ready({ live: true, plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  assert.match(t.text(".tray"), /1 voucher planned/);
  t.click('.tray [data-a="review"]');
  assert.match(t.text("#page"), /Review plan/);
  assert.match(t.text('[data-a="rungo"]'), /Book 1 voucher/);
  assert.strictEqual(t.booked(), false);
  t.click('[data-a="rungo"]');
  await until(() => t.$('[data-a="runclose"]'), 5000);
  assert.match(t.text("#page"), /1 booked/);
  assert.strictEqual(t.booked(), true);
});

test("cancels a booking only after the confirm step", async () => {
  const t = await ready({ live: true });
  t.click('[data-a="tab"][data-tab="cal"]');
  t.click('[data-a="calday"][data-dk="2026-09-30"]');
  t.click('.list [data-a="visit"]');
  t.click('[data-a="vmode"][data-mode="cancel"]');
  assert.match(t.text("#layer"), /1 voucher goes back to your unused vouchers/);
  assert.strictEqual(t.site.cancelled.size, 0, "nothing cancelled yet");
  t.click('[data-a="vcancel"]');
  await until(() => t.site.cancelled.has("xd771d26b887ce0ee"));
});

test("schedules a reminder before a voucher ends, and clears them when reminders are off", async () => {
  const t = await ready();
  const last = () => t.bridge.filter((c) => c.cmd === "notify.schedule").at(-1);
  await until(() => last());
  const n = last().args.items.find((i) => i.title === "VW55 XYZ: voucher ends at 11:00");
  assert.ok(n, "reminder for Wednesday's booking");
  assert.strictEqual(n.actions[0].id, "extend");
  t.click('[data-a="tab"][data-tab="more"]');
  t.click('[data-a="set"][data-k="reminders"]');
  await until(() => last().args.items.length === 0);
  assert.strictEqual(t.storage["vb:settings"].reminders, false);
});

test("Extend from a notification opens a filled-in booking sheet and books nothing", async () => {
  const t = await ready();
  t.w.VBNative.emit("notification", { action: "extend", data: { vrn: "VW55XYZ", dk: "2026-09-30", end: 660 } });
  assert.match(t.text("#layer"), /Book a visitor/);
  assert.strictEqual(t.$('[data-in="qfrom"]').value, "11:00");
  assert.strictEqual(t.$('[data-in="qto"]').value, "12:00");
  assert.strictEqual(t.$('[data-a="qwhen"][data-w="days"]').getAttribute("aria-pressed"), "true");
  assert.strictEqual(t.booked(), false);
});

test("when signed out, asks the app to show the council's own sign-in page", async () => {
  const t = setup({ loggedOut: true });
  await t.start();
  await until(() => /Sign in to the council site/.test(t.text(".portrait")));
  t.click('[data-a="signin"]');
  await until(() => t.bridge.some((c) => c.cmd === "council.show" && c.args.reason === "signin"));
});

test("Back closes the open sheet first, then leaves the app", async () => {
  const t = await ready({ plan: [{ id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }] });
  t.click('.tray [data-a="plan"]');
  assert.strictEqual(t.$("#layer").hidden, false);
  assert.strictEqual(t.w.VBNative.emit("back", {}), true);
  assert.strictEqual(t.$("#layer").hidden, true);
  assert.strictEqual(t.w.VBNative.emit("back", {}), false);
});

test("the UI page can't reach the network itself", () => {
  const html = read("mobile", "www", "index.html");
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//, "loads nothing from outside the app");
});
