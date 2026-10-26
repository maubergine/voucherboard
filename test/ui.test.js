// Runs the real UI against saved (anonymised) portal pages with a fake backend. No network.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const { fakeSite, fx, MAIN, SECOND, OTHER } = require("./fakesite.js");
const TERMS = require("../extension/src/terms.js");
const src = (n) => fs.readFileSync(path.join(__dirname, "..", "extension", "src", n), "utf8");

const opened = [];
test.afterEach(() => { for (const x of opened.splice(0)) { try { x.app.close(); } catch (e) { /* already closed */ } x.w.close(); } });

function setup({ nonEnforced = false, now = null, plan = null, noTerms = false, live = false, zone = null, multi = false, secondOlder = false, secondEmpty = false, long = false, demo = false, saved = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://parkingpermits.lewisham.gov.uk/Home/Index", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  if (now) { // pin the clock, so bookings in the saved pages are upcoming, running or finished as a test needs
    const RD = w.Date, fixed = new RD(now).getTime();
    w.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  }
  const storage = {};
  if (plan) storage["vb:plan:x80b66f1c3b5e7742"] = plan;
  if (!noTerms) storage["vb:terms"] = { version: TERMS.VERSION };
  if (!live) storage["vb:settings"] = { testMode: true }; // the app starts live; tests run in test mode unless they ask
  Object.assign(storage, saved);
  // demo: the mobile app's made-up council site (apps/mobile/www/demo.js), with several vehicles booked around now
  const site = demo ? (w.eval(fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "www", "demo.js"), "utf8")), { fetch: w.VB.demo.create().fetch })
    : fakeSite(w, { nonEnforced, zone, multi, secondOlder, secondEmpty, long });
  const { calls, deleted, cancelled, created } = site;
  w.chrome = {
    runtime: { getURL: (p) => "chrome-extension://test/" + p, getManifest: () => ({ version: "9.8.7" }) },
    storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (o) => Object.assign(storage, o) } }
  };
  w.matchMedia = () => ({ matches: false });
  w.fetch = async (p, opt) => (String(p).startsWith("chrome-extension://") ? { ok: true, status: 200, url: "", text: async () => src("app.css") } : site.fetch(p, opt));
  for (const f of ["zones.js", "planner.js", "portal.js", "terms.js", "model.js", "plates.js", "updates.js", "app.js"]) w.eval(src(f));
  w.VB.portal.GAP_MS = 0;
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  const app = w.VB.app.create(host);
  const ctx = { w, app, host, calls, storage, deleted, cancelled, created };
  opened.push(ctx);
  return ctx;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(10); } throw new Error("timed out"); }

test("loads real portal pages and renders the planner", async () => {
  const { app, host } = setup();
  await app.open();
  const sr = host.shadowRoot;
  assert.ok(sr.querySelector("#board"), "board rendered");
  assert.match(sr.querySelector("#zoneCard").textContent, /Hither Green East/);
  assert.match(sr.querySelector("#balance").textContent, /9 × 1 hour/);
  assert.strictEqual(sr.querySelector("#testTag").hidden, false, "test mode is flagged in the top panel");
  const nicks = [...sr.querySelectorAll(".who .nick")].map((n) => n.textContent);
  assert.ok(nicks.length >= 1);
});

test("a zone B permit asks for B1 or B2, uses its hours and remembers the choice", async () => {
  const { w, app, host, storage } = setup({ zone: "B - Lewisham Central" });
  await app.open();
  const sr = host.shadowRoot, card = () => sr.querySelector("#zoneCard");
  assert.match(card().textContent, /Choose where you're parking/);
  assert.strictEqual(sr.querySelector("#subzoneSel").value, "");
  const pick = (v) => { const s = sr.querySelector("#subzoneSel"); s.value = v; s.dispatchEvent(new w.Event("change", { bubbles: true })); };
  pick("B2");
  assert.match(card().textContent, /Lewisham Central Southern/);
  assert.match(card().textContent, /Sun 09:00–13:30/);
  assert.strictEqual(sr.querySelector("#subzoneSel").value, "B2");
  await until(() => storage["vb:subzone:x80b66f1c3b5e7742"] === "B2");
  pick("B1");
  assert.doesNotMatch(card().textContent, /Sun/);
  await until(() => storage["vb:subzone:x80b66f1c3b5e7742"] === "B1");

  const again = setup({ zone: "B - Lewisham Central" });
  again.storage["vb:subzone:x80b66f1c3b5e7742"] = "B2";
  await again.app.open();
  assert.strictEqual(again.host.shadowRoot.querySelector("#subzoneSel").value, "B2");
});

test("has no subzone picker for other zones", async () => {
  const { app, host } = setup();
  await app.open();
  assert.strictEqual(host.shadowRoot.querySelector("#subzoneSel"), null);
});

test("has a report issue link to the GitHub issues page, opened in a new tab", async () => {
  const { app, host } = setup();
  await app.open();
  const link = host.shadowRoot.querySelector("#reportIssue");
  assert.strictEqual(link.tagName, "A");
  assert.strictEqual(link.getAttribute("href"), "https://github.com/maubergine/voucherboard/issues");
  assert.strictEqual(link.getAttribute("target"), "_blank");
  assert.strictEqual(link.getAttribute("rel"), "noopener noreferrer");
  assert.match(link.textContent, /Report issue/);
  assert.strictEqual(host.shadowRoot.querySelector("#vbVersion").textContent, "v9.8.7", "version in the footer");
  const guide = host.shadowRoot.querySelector("#guideLink");
  assert.strictEqual(guide.getAttribute("href"), "chrome-extension://test/guide/index.html");
  assert.strictEqual(guide.getAttribute("target"), "_blank");
});

test("switches test mode in Settings, and starts live on first run", async () => {
  const { w, app, host, storage } = setup({ live: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#testTag").hidden, true);
  sr.querySelector("#settingsBtn").click();
  const t = sr.querySelector("#sTest");
  assert.strictEqual(t.checked, false);
  t.checked = true; t.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.strictEqual(storage["vb:settings"].testMode, true);
  assert.strictEqual(sr.querySelector("#testTag").hidden, false);
  sr.querySelector("#stClose").click();
  assert.ok(!sr.querySelector("#sTest"), "settings closed");
});

test("defaults to the next controlled period once today's has ended", async () => {
  for (const [now, dk] of [["2026-09-28T09:00:00", "2026-09-28"], ["2026-09-28T13:00:00", "2026-09-29"], ["2026-10-02T13:00:00", "2026-10-05"]]) {
    const { app, host } = setup({ now });
    await app.open();
    const sr = host.shadowRoot;
    assert.deepStrictEqual([...sr.querySelectorAll("#mini button.sel[data-pick]")].map((b) => b.dataset.pick), [dk], now);
    assert.strictEqual(sr.querySelector("#tFrom").value, "10:00", now);
    assert.strictEqual(sr.querySelector("#tTo").value, "11:00", now);
  }
});

test("plans a booking, runs it in test mode, and sends nothing that books", async () => {
  const { w, app, host, calls } = setup();
  await app.open();
  const sr = host.shadowRoot;
  // choose the first favourite
  const vq = sr.querySelector("#vq");
  vq.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  sr.querySelector("#vlist .opt[data-vrn]").click();
  // pick the next weekday that is at least 2 days away, whole controlled period
  sr.querySelector("#clearD").click(); // the default day depends on the real clock
  const days = [...sr.querySelectorAll("#mini button[data-pick]")].filter((b) => !b.classList.contains("off"));
  days[2].click();
  const whole = [...sr.querySelectorAll("#tquick .qbtn")].find((b) => /Whole/.test(b.textContent)); whole.click();
  assert.match(sr.querySelector("#addPlan").textContent, /Add 1 booking to plan \(2 vouchers\)/);
  sr.querySelector("#addPlan").click();
  assert.match(sr.querySelector("#summary").textContent, /2 vouchers to activate/);
  assert.match(sr.querySelector("#summary").textContent, /£4\.48/);
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /Test passed for all 2 vouchers/);
  assert.ok(!calls.some((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit"), "no booking POST in test mode");
  assert.strictEqual(calls.filter((c) => c.path === "/Permit/GetNonEnforceableCoverage").length, 2);
});

test("books for real in live mode with the site's field names", async () => {
  const { w, app, host, calls } = setup({ live: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#testTag").hidden, true, "live by default");
  sr.querySelector("#vq").dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  sr.querySelector("#vlist .opt[data-vrn]").click();
  const today = sr.querySelector("#mini button.today.sel"); if (today) today.click();
  const days = [...sr.querySelectorAll("#mini button[data-pick]")].filter((b) => !b.classList.contains("off"));
  days[3].click();
  [...sr.querySelectorAll("#tquick .qbtn")].find((b) => /1 hour/.test(b.textContent)).click();
  sr.querySelector("#tFrom").value = "10:30"; sr.querySelector("#tFrom").dispatchEvent(new w.Event("change", { bubbles: true }));
  sr.querySelector("#addPlan").click();
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  const post = calls.find((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit");
  assert.ok(post, "booking POST sent");
  const b = new URLSearchParams(post.body);
  assert.strictEqual(b.get("__RequestVerificationToken"), "TEST-TOKEN");
  assert.strictEqual(b.get("visitorPermit[FromTime]"), "10:30");
  assert.ok(b.get("visitorPermit[FavoriteVehiclesId]").startsWith("x"));
  assert.strictEqual(b.get("visitorPermit[VisitorVoucherPeriodId]"), "x3fb777432fe6d1ba");
  assert.strictEqual(b.get("visitorPermit[SendEmail]"), "false");  assert.strictEqual(sr.querySelector("#rvCopy").hidden, true, "no copy button on success");
});

test("stops and reports when the site says no voucher is needed", async () => {
  const { w, app, host, calls } = setup({ nonEnforced: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#vq").dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  sr.querySelector("#vlist .opt[data-vrn]").click();
  const today = sr.querySelector("#mini button.today.sel"); if (today) today.click();
  [...sr.querySelectorAll("#mini button[data-pick]")].filter((b) => !b.classList.contains("off"))[4].click();
  [...sr.querySelectorAll("#tquick .qbtn")].find((b) => /Whole/.test(b.textContent)).click();
  sr.querySelector("#addPlan").click();
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /Test stopped at voucher 1: .*non-enforcement/);
  assert.strictEqual(calls.filter((c) => c.path === "/Permit/GetNonEnforceableCoverage").length, 1);
  let copied = null;
  Object.defineProperty(w.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  const copy = sr.querySelector("#rvCopy");
  assert.strictEqual(copy.hidden, false, "copy button shown on failure");
  copy.click();
  await until(() => copy.textContent === "Copied ✓");
  assert.match(copied, /Message: .*non-enforcement/);
  assert.match(copied, /Step: 2\/5 Checking controlled hours/);
  assert.match(copied, /POST \/Permit\/GetNonEnforceableCoverage/);
  assert.match(copied, /"Result":"Error"/);
  assert.match(copied, /__RequestVerificationToken[^\n]*\[redacted\]/);
  assert.doesNotMatch(copied, /TEST-TOKEN/);
});

test("adds a one-off plate, and requires a nickname only when saving it", async () => {
  const { w, app, host } = setup();
  await app.open();
  const sr = host.shadowRoot;
  const vq = sr.querySelector("#vq");
  vq.value = "zz99 zzz";
  vq.dispatchEvent(new w.Event("input", { bubbles: true }));
  sr.querySelector("#vlist .opt[data-new]").click();
  assert.strictEqual(sr.querySelector("#nvSave").checked, false);
  assert.strictEqual(sr.querySelector("#nvAdd").disabled, false);
  sr.querySelector("#nvSave").checked = true;
  sr.querySelector("#nvSave").dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.strictEqual(sr.querySelector("#nvAdd").disabled, true);
  sr.querySelector("#nvSave").checked = false;
  sr.querySelector("#nvSave").dispatchEvent(new w.Event("change", { bubbles: true }));
  sr.querySelector("#nvAdd").click();
  await until(() => sr.querySelector("#vsel").textContent.includes("ZZ99ZZZ"));
  assert.match(sr.querySelector("#vsel").textContent, /one-off/);
});

test("splits vehicles without bookings into favourites (open) and previously booked (closed)", async () => {
  const { app, host } = setup();
  await app.open();
  const sr = host.shadowRoot;
  const favs = sr.querySelector("#grpFavs"), past = sr.querySelector("#grpPast");
  assert.ok(favs, "favourites group shown");
  assert.strictEqual(favs.getAttribute("aria-expanded"), "true");
  assert.ok(past, "previously booked group shown");
  assert.strictEqual(past.getAttribute("aria-expanded"), "false");
  const rowsBefore = sr.querySelectorAll("#board .tl-row, #board .wk-row").length;
  past.click();
  await until(() => sr.querySelector("#grpPast").getAttribute("aria-expanded") === "true");
  assert.ok(sr.querySelectorAll("#board .tl-row, #board .wk-row").length > rowsBefore, "previously booked rows shown");
});

test("sorts vehicles: favourites first by nickname, then the rest by plate", async () => {
  const { app, host } = setup();
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#grpPast").click();
  await until(() => sr.querySelector("#grpPast").getAttribute("aria-expanded") === "true");
  const rows = [...sr.querySelectorAll("#board .who")].filter((w) => w.querySelector(".plate") || w.querySelector(".nick"))
    .map((w) => ({ one: !!w.querySelector(".oneoff"), nick: w.querySelector(".nick").textContent.replace("one-off", "").trim() }));
  const favs = rows.filter((r) => !r.one), rest = rows.filter((r) => r.one);
  assert.ok(favs.length && rest.length, "fixture has both kinds");
  const sorted = (xs) => [...xs].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" }));
  assert.deepStrictEqual(favs.map((r) => r.nick), sorted(favs.map((r) => r.nick)));
  assert.deepStrictEqual(rest.map((r) => r.nick), [...rest.map((r) => r.nick)].sort());
});

async function deleteFav(w, sr, nick) {
  const btn = [...sr.querySelectorAll("#board [data-vpop]")].find((b) => b.textContent.trim() === nick);
  assert.ok(btn, `${nick} has a favourite button`);
  btn.click();
  sr.querySelector("#vDel").click();
  sr.querySelector("#vYes").click();
  await until(() => /from your favourites|Couldn't delete/.test(sr.querySelector(".toast") ? sr.querySelector(".toast").textContent : ""));
}
const boardNames = (sr) => [...sr.querySelectorAll("#board .who .nick")].map((n) => n.textContent.replace("one-off", "").trim());

test("deletes a booked favourite: it moves to previously booked and leaves the search list", async () => {
  const { w, app, host, calls, deleted } = setup();
  await app.open();
  const sr = host.shadowRoot;
  await deleteFav(w, sr, "Blair Visitor");
  assert.match(sr.querySelector(".toast").textContent, /Deleted "Blair Visitor"/);
  assert.ok(deleted.has("xdfb1cd7115c25a39"));
  const post = calls.find((c) => c.m === "POST" && c.path === "/FavouriteVehicle/Delete");
  assert.strictEqual(new URLSearchParams(post.body).get("__RequestVerificationToken"), "TEST-TOKEN");
  assert.ok(!boardNames(sr).includes("Blair Visitor"));
  sr.querySelector("#grpPast").click();
  await until(() => boardNames(sr).includes("VW55XYZ"));
  const vq = sr.querySelector("#vq");
  vq.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  assert.ok(![...sr.querySelectorAll("#vlist .opt .nick")].some((n) => n.textContent === "Blair Visitor"), "gone from search");
});

test("deletes an unbooked favourite: it disappears", async () => {
  const { w, app, host } = setup();
  await app.open();
  const sr = host.shadowRoot;
  await deleteFav(w, sr, "Gray Visitor");
  sr.querySelector("#grpPast").click();
  await until(() => sr.querySelector("#grpPast").getAttribute("aria-expanded") === "true");
  assert.ok(!boardNames(sr).some((n) => n === "Gray Visitor" || n === "EF56GHJ"));
});

test("reports when the council site doesn't delete the favourite", async () => {
  const { w, app, host, deleted } = setup();
  await app.open();
  const sr = host.shadowRoot;
  deleted.add = () => deleted; // site ignores the delete
  await deleteFav(w, sr, "Gray Visitor");
  assert.match(sr.querySelector(".toast").textContent, /Couldn't delete "Gray Visitor"\. The council site didn't delete it/);
  assert.ok(boardNames(sr).includes("Gray Visitor"));
});

// ---------- times, changes, favourites and the list (clock pinned to Mon 28 Sep 2026, 10:30) ----------
const NOW = "2026-09-28T10:30:00";
const setVal = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event("change", { bubbles: true })); };
const toastText = (sr) => (sr.querySelector(".toast") ? sr.querySelector(".toast").textContent : "");
const listRows = (sr) => [...sr.querySelectorAll(".lt tbody tr")].filter((r) => !r.querySelector(".empty"));
function manage(sr, vrn, day) {
  const row = listRows(sr).find((r) => r.textContent.replace(/\s/g, "").includes(vrn.slice(0, 4) + vrn.slice(4)) && r.textContent.includes(day));
  assert.ok(row, `list row for ${vrn} on ${day}`);
  row.querySelector("[data-ids]").click();
}

test("saves a previously booked plate as a favourite straight away", async () => {
  const { w, app, host, calls } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#grpPast").click();
  const btn = [...sr.querySelectorAll("#board [data-vpop]")].find((b) => b.dataset.vpop === "NP22RST");
  assert.ok(btn, "previously booked plate is clickable");
  btn.click();
  sr.querySelector("#fvSave").click();
  assert.match(sr.querySelector("#fvErr").textContent, /Enter a nickname/);
  sr.querySelector("#fvNick").value = "Nina";
  sr.querySelector("#fvSave").click();
  await until(() => /Saved "Nina"/.test(toastText(sr)));
  const post = new URLSearchParams(calls.find((c) => c.m === "POST" && c.path === "/FavouriteVehicle/Create").body);
  assert.strictEqual(post.get("Name"), "Nina");
  assert.strictEqual(post.get("Vrn"), "NP22RST");
  assert.strictEqual(post.get("__RequestVerificationToken"), "TEST-TOKEN");
  assert.ok([...sr.querySelectorAll("#board .who .nick")].some((n) => n.textContent === "Nina"), "now listed under its nickname");
});

test("changes a planned booking's time to the minute, inline and from its block", async () => {
  const { w, app, host, storage } = setup({ now: NOW, plan: [{ id: 1, vrn: "AB12CDE", dk: "2026-09-29", from: 600, to: 660 }] });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#plan [data-edit]").click();
  sr.querySelector("#edFrom").value = "11:50"; sr.querySelector("#edTo").value = "11:10";
  sr.querySelector("#edSave").click();
  assert.match(sr.querySelector("#edErr").textContent, /end must be after the start/);
  sr.querySelector("#edFrom").value = "13:00"; sr.querySelector("#edTo").value = "14:00";
  sr.querySelector("#edSave").click();
  assert.match(sr.querySelector("#edErr").textContent, /outside controlled hours/);
  sr.querySelector("#edFrom").value = "10:07"; sr.querySelector("#edTo").value = "11:43";
  sr.querySelector("#edSave").click();
  assert.match(sr.querySelector("#plan").textContent, /Asked for 10:07–11:43/);
  await until(() => storage["vb:plan:x80b66f1c3b5e7742"] && storage["vb:plan:x80b66f1c3b5e7742"][0].from === 607);
  // the planned block on the board opens the same editor
  sr.querySelector('#board button.blk.draft[data-eid="1"]').click();
  sr.querySelector("#edFrom").value = "10:15"; sr.querySelector("#edTo").value = "11:00";
  sr.querySelector("#enSave").click();
  assert.match(sr.querySelector("#plan").textContent, /Asked for 10:15–11:00/);
});

test("changing an upcoming booking cancels it, then books the new time", async () => {
  const { w, app, host, calls, cancelled } = setup({ now: NOW, live: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  manage(sr, "VW55XYZ", "Wed 30 Sep");
  sr.querySelector("#pChange").click();
  sr.querySelector("#edFrom").value = "10:30"; setVal(w, sr.querySelector("#edTo"), "11:30");
  assert.match(sr.querySelector("#edPrev").textContent, /uses 1 × 1 hour\./);
  sr.querySelector("#edOk").click();
  assert.match(sr.querySelector("#plan").textContent, /Change to 10:30–11:30/);
  assert.match(sr.querySelector("#plan").textContent, /Replaces the booking at 10:00–11:00/);
  assert.ok(listRows(sr).some((r) => /Changing \(in plan\)/.test(r.textContent)), "old booking marked as changing");
  sr.querySelector("#review").click();
  assert.match(sr.querySelector("#rvT").textContent, /Activate 1 voucher and cancel 1 booked voucher/);
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /1 booked, 1 cancelled/);
  assert.ok(cancelled.has("xd771d26b887ce0ee"));
  const iCancel = calls.findIndex((c) => c.path === "/Permit/CancelVisitorVoucher"), iBook = calls.findIndex((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit");
  assert.ok(iCancel >= 0 && iBook > iCancel, "cancelled before booking");
  const times = calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body).get("visitorPermit[FromTime]"));
  assert.deepStrictEqual(times, ["10:30"]);
});

test("a longer change keeps the booking and books only the extra hour", async () => {
  const { w, app, host, calls } = setup({ now: NOW, live: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  manage(sr, "VW55XYZ", "Wed 30 Sep");
  sr.querySelector("#pChange").click();
  sr.querySelector("#edFrom").value = "10:00"; setVal(w, sr.querySelector("#edTo"), "12:00");
  assert.match(sr.querySelector("#edPrev").textContent, /uses 1 × 1 hour and keeps 1 booked voucher/);
  sr.querySelector("#edOk").click();
  assert.match(sr.querySelector("#plan").textContent, /Keeps the booking at 10:00–11:00/);
  sr.querySelector("#review").click();
  assert.match(sr.querySelector("#rvT").textContent, /^Activate 1 voucher$/);
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.ok(!calls.some((c) => /Cancel/.test(c.path)), "nothing cancelled");
  const times = calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body).get("visitorPermit[FromTime]"));
  assert.deepStrictEqual(times, ["11:00"]);
});

test("a change that only cancels starts its button with a capital", async () => {
  const plan = [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 780, to: 840, replaces: ["xd771d26b887ce0ee"] }];
  const { app, host } = setup({ now: NOW, live: true, plan });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#review").click();
  assert.strictEqual(sr.querySelector("#rvT").textContent, "Cancel 1 booked voucher");
  assert.strictEqual(sr.querySelector("#rvGo").textContent, "Cancel 1");
});

test("a change that ran leaves the plan, even if the council lists the new booking under the old id", async () => {
  const plan = [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 630, to: 690, replaces: ["xd771d26b887ce0ee"] }];
  const { w, app, host, storage, cancelled } = setup({ now: NOW, live: true, plan });
  const f = w.fetch;
  let rebooked = false; // then the site lists the new 10:30 booking under the old id
  w.fetch = async (p, opt = {}) => {
    const r = await f(p, opt);
    if (/\/Permit\/VisitorPermit$/.test(String(p)) && opt.method === "POST") { cancelled.clear(); rebooked = true; }
    if (!rebooked || !/\/Permit\/Details/.test(String(p))) return r;
    const body = (await r.text()).replace("30.09.2026 10:00", "30.09.2026 10:30").replace("30.09.2026 10:59", "30.09.2026 11:29");
    return { ...r, text: async () => body };
  };
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#review").click(); sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /1 booked, 1 cancelled/);
  assert.deepStrictEqual([...storage["vb:plan:x80b66f1c3b5e7742"]], []);
});

test("a changed booking is only checked in test mode: nothing is cancelled", async () => {
  const { w, app, host, calls } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  manage(sr, "VW55XYZ", "Wed 30 Sep");
  sr.querySelector("#pChange").click();
  sr.querySelector("#edFrom").value = "10:30"; sr.querySelector("#edTo").value = "11:30";
  sr.querySelector("#edOk").click();
  sr.querySelector("#review").click(); sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /Test passed .*cancellation skipped/);
  assert.ok(!calls.some((c) => /Cancel/.test(c.path)), "no cancel request in test mode");
});

test("ends a booking in progress early, with no setting to turn on", async () => {
  const { app, host, cancelled } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#settingsBtn").click();
  assert.ok(!/end bookings|Beta/i.test(sr.querySelector(".settings").textContent), "no setting for it");
  sr.querySelector("#stClose").click();
  sr.querySelector('[data-view="list"]').click();
  manage(sr, "TU44VWX", "Mon 28 Sep");
  sr.querySelector("#pShrink").click();
  assert.doesNotMatch(sr.querySelector(".pop").textContent, /Beta/);
  assert.deepStrictEqual([...sr.querySelectorAll("#shEnd option")].map((o) => o.textContent), ["11:00 · cancels 1 voucher"]);
  sr.querySelector("#shYes").click();
  await until(() => /Now ends at 11:00/.test(toastText(sr)));
  assert.deepStrictEqual([...cancelled], ["x441614b936801a18"], "only the voucher that hasn't started");
});

test("list view: filter by picked vehicles, sort by name or date", async () => {
  const { w, app, host } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  assert.strictEqual(sr.querySelector("#prev").hidden, true);
  const upcoming = listRows(sr).length;
  const past = sr.querySelector("#lpast"); past.checked = true; past.dispatchEvent(new w.Event("change", { bubbles: true }));
  const all = listRows(sr).length;
  assert.ok(all > upcoming, "finished bookings shown on request");
  const lq = sr.querySelector("#lq");
  lq.value = "alex"; lq.dispatchEvent(new w.Event("input", { bubbles: true }));
  sr.querySelector("#llist .opt[data-ladd]").click();
  assert.ok(listRows(sr).every((r) => /Alex Visitor/.test(r.textContent)));
  const q2 = sr.querySelector("#lq");
  q2.value = "NP22"; q2.dispatchEvent(new w.Event("input", { bubbles: true }));
  q2.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const names = new Set(listRows(sr).map((r) => (/Alex Visitor/.test(r.textContent) ? "alex" : /NP22/.test(r.textContent.replace(/\s/g, "")) ? "np" : "other")));
  assert.deepStrictEqual([...names].sort(), ["alex", "np"]);
  assert.strictEqual(sr.querySelectorAll(".lst-filter .vtag").length, 2);
  setVal(w, sr.querySelector("#lsort"), "name");
  assert.match(listRows(sr)[0].textContent, /Alex Visitor/, "favourites first, by nickname");
  sr.querySelector('.lst-filter [data-lrm="TU44VWX"]').click();
  assert.ok(listRows(sr).every((r) => /NP22/.test(r.textContent.replace(/\s/g, ""))));
  setVal(w, sr.querySelector("#lsort"), "date");
  sr.querySelector('.lst-filter [data-lrm]').click();
  assert.strictEqual(listRows(sr).length, all);
});

test("confirmation emails: off by default, per booking or for every booking", async () => {
  const plan = [{ id: 1, vrn: "AB12CDE", dk: "2026-09-29", from: 600, to: 660 }, { id: 2, vrn: "EF56GHJ", dk: "2026-09-29", from: 660, to: 720 }];
  const { w, app, host, calls, storage } = setup({ now: NOW, plan, live: true });
  await app.open();
  const sr = host.shadowRoot;
  const boxes = () => [...sr.querySelectorAll("#plan [data-email]")];
  const all = () => sr.querySelector("#emailAll");
  assert.deepStrictEqual(boxes().map((b) => b.checked), [false, false], "default is no email");
  assert.strictEqual(all().checked, false);
  const tick = (el, v) => { el.checked = v; el.dispatchEvent(new w.Event("change", { bubbles: true })); };
  tick(boxes()[1], true);
  assert.strictEqual(all().indeterminate, true, "some, not all");
  tick(all(), true);
  assert.deepStrictEqual(boxes().map((b) => b.checked), [true, true]);
  tick(boxes()[0], false);
  assert.strictEqual(all().checked, false);
  await until(() => storage["vb:plan:x80b66f1c3b5e7742"].some((e) => e.email));
  sr.querySelector("#review").click();
  assert.match(sr.querySelector("#rvBody").textContent, /· email/);
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  const sent = calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body)).map((b) => [b.get("visitorPermit[FromTime]"), b.get("visitorPermit[SendEmail]")]);
  assert.deepStrictEqual(sent, [["10:00", "false"], ["11:00", "true"]]);
});

test("asks for the terms first, and reads nothing from the council site until they're accepted", async () => {
  const { w, app, host, calls, storage } = setup({ noTerms: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.ok(sr.querySelector(".terms-gate"), "terms shown");
  assert.match(sr.querySelector(".terms").textContent, /wholly the intellectual property and copyright of Marius Rubin/);
  assert.match(sr.querySelector(".terms").textContent, /accepts absolutely no liability whatsoever/);
  assert.match(sr.querySelector(".terms").textContent, /partial transaction/);
  assert.match(sr.querySelector(".terms").textContent, /help by email at voucherboard@mariusrubin.com/);
  const tx = sr.querySelector(".terms").textContent;
  assert.match(tx, /reserves all commercial rights/);
  assert.match(tx, /create, help create or improve any product or service that competes with it/);
  assert.match(tx, /still being developed/);
  assert.doesNotMatch(tx, /\bbeta\b/i, "the terms never call it a beta (App Store guideline 2.2)");
  assert.doesNotMatch(tx, /end date/, "no built-in end date");
  assert.match(tx, /tell you to stop using this version/);
  assert.match(tx, /You have no right to keep using this version/);
  assert.match(sr.querySelector(".brand").textContent, /Beta/);
  assert.match(sr.querySelector(".terms").textContent, /best-effort basis/);
  assert.match(sr.querySelector(".terms").textContent, /change to the council's website or its terms that allows, restricts or prohibits use of Voucherboard/);
  assert.match(tx, /runs only on your device: in your browser, or in the Voucherboard app/);
  assert.strictEqual(calls.length, 0, "no council requests before accepting");
  assert.strictEqual(sr.querySelector("#tAccept").disabled, true);
  sr.querySelector("#reload").click();
  await sleep(20);
  assert.strictEqual(calls.length, 0, "refresh doesn't get round the terms");
  const agree = sr.querySelector("#tAgree"); agree.checked = true; agree.dispatchEvent(new w.Event("change", { bubbles: true }));
  sr.querySelector("#tAccept").click();
  await until(() => sr.querySelector("#board"));
  assert.strictEqual(storage["vb:terms"].version, TERMS.VERSION);
  sr.querySelector("#termsLink").click();
  assert.match(sr.querySelector(".modal").textContent, /All rights reserved/);
  sr.querySelector("#tmClose").click();
  assert.ok(!sr.querySelector(".modal"));
});

function bulkSetup() {
  const r = setup({ now: NOW, plan: [{ id: 1, vrn: "AB12CDE", dk: "2026-09-29", from: 600, to: 660 }] });
  return r;
}
async function openBulk(w, app, host) {
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  sr.querySelector("#bulkBtn").click();
  return sr;
}
const rowOf = (sr, re) => listRows(sr).find((r) => re.test(r.textContent.replace(/\s/g, "")));
const tickRow = (w, sr, re) => { const b = rowOf(sr, re).querySelector("[data-bsel]"); b.checked = true; b.dispatchEvent(new w.Event("change", { bubbles: true })); };

test("bulk manage: only planned items and upcoming bookings can be selected", async () => {
  const { w, app, host } = bulkSetup();
  const sr = await openBulk(w, app, host);
  assert.strictEqual(rowOf(sr, /TU44VWX/).querySelector("[data-bsel]").disabled, true, "in progress");
  assert.strictEqual(rowOf(sr, /AB12CDE/).querySelector("[data-bsel]").disabled, false, "planned");
  assert.strictEqual(rowOf(sr, /VW55XYZ/).querySelector("[data-bsel]").disabled, false, "upcoming");
  assert.strictEqual(sr.querySelector("#bkTime").disabled, true, "nothing selected yet");
  const all = sr.querySelector("#bkAll"); all.checked = true; all.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(sr.querySelector("#bkCount").textContent, /2 selected/);
});

test("bulk manage: moves the selected by some minutes, and a booking's change goes into the plan", async () => {
  const { w, app, host, storage } = bulkSetup();
  const sr = await openBulk(w, app, host);
  tickRow(w, sr, /AB12CDE/); tickRow(w, sr, /VW55XYZ/);
  sr.querySelector("#bkTime").click();
  const shift = sr.querySelector('input[name="bkMode"][value="shift"]'); shift.checked = true; shift.dispatchEvent(new w.Event("change", { bubbles: true }));
  const mins = sr.querySelector("#bkShift"); mins.value = "180"; mins.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match(sr.querySelector("#bkPrev").textContent, /None of the selected can change/);
  assert.strictEqual((sr.querySelector("#bkPrev").textContent.match(/outside controlled hours/g) || []).length, 2, "says why for each");
  assert.strictEqual(sr.querySelector("#bkApply").disabled, true);
  mins.value = "15"; mins.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match(sr.querySelector("#bkPrev").textContent, /2 will change \(1 booking goes into your plan/);
  sr.querySelector("#bkApply").click();
  assert.match(toastText(sr), /2 changed\. 1 booking change is in your plan/);
  const saved = await until(() => { const p = storage["vb:plan:x80b66f1c3b5e7742"]; return p && p.length === 2 && p; });
  const ab = saved.find((e) => e.vrn === "AB12CDE"), vw = saved.find((e) => e.vrn === "VW55XYZ");
  assert.deepStrictEqual([ab.from, ab.to], [615, 675]);
  assert.deepStrictEqual([vw.from, vw.to, [...vw.replaces]], [615, 675, ["xd771d26b887ce0ee"]]);
  assert.strictEqual(sr.querySelector("#bkCount").textContent, "0 selected");
});

test("bulk manage: sets the selected to one time", async () => {
  const { w, app, host } = bulkSetup();
  const sr = await openBulk(w, app, host);
  tickRow(w, sr, /AB12CDE/); tickRow(w, sr, /VW55XYZ/);
  sr.querySelector("#bkTime").click();
  const f = sr.querySelector("#bkFrom"), t = sr.querySelector("#bkTo");
  f.value = "10:05"; f.dispatchEvent(new w.Event("input", { bubbles: true }));
  t.value = "11:59"; t.dispatchEvent(new w.Event("input", { bubbles: true }));
  sr.querySelector("#bkApply").click();
  assert.match(sr.querySelector("#plan").textContent, /Asked for 10:05–11:59/);
  assert.match(sr.querySelector("#plan").textContent, /Change to 10:05–11:59/);
});

test("bulk manage: cancels the selected bookings and removes the selected planned items", async () => {
  const { w, app, host, cancelled, storage } = bulkSetup();
  const sr = await openBulk(w, app, host);
  tickRow(w, sr, /AB12CDE/); tickRow(w, sr, /VW55XYZ/);
  sr.querySelector("#bkCancel").click();
  assert.match(sr.querySelector("#bkPanel").textContent, /Cancel 1 booking \(1 voucher\) on the council site now, and remove 1 planned item/);
  sr.querySelector("#bkYes").click();
  await until(() => /Cancelled 1 of 1 voucher, removed 1 planned item/.test(toastText(sr)));
  assert.deepStrictEqual([...cancelled], ["xd771d26b887ce0ee"]);
  assert.strictEqual(storage["vb:plan:x80b66f1c3b5e7742"].length, 0);
  assert.ok(!rowOf(sr, /VW55XYZ/), "cancelled booking gone from the list");
});

test("asks again when the terms change", async () => {
  const { app, host, calls, storage } = setup({ noTerms: true });
  storage["vb:terms"] = { version: "an-older-version" };
  await app.open();
  assert.ok(host.shadowRoot.querySelector(".terms-gate"));
  assert.strictEqual(calls.length, 0);
});

test("typing a time in the composer keeps focus, and fixes the other field only when you leave", async () => {
  const { w, app, host } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  const from = sr.querySelector("#tFrom"), to = sr.querySelector("#tTo");
  from.value = "10:30"; from.dispatchEvent(new w.Event("change", { bubbles: true }));
  to.value = "11:30"; to.dispatchEvent(new w.Event("change", { bubbles: true }));
  from.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true, composed: true }));
  from.focus();
  assert.strictEqual(sr.activeElement, from);
  // the hours are finished first: the site's time field fires change with the old minutes
  from.value = "14:30"; from.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.strictEqual(sr.activeElement, from, "still focused after the hours");
  assert.strictEqual(to.value, "11:30", "Until isn't touched while typing");
  from.value = "14:45"; from.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.strictEqual(sr.activeElement, from, "still focused after the minutes");
  from.blur(); from.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true, composed: true }));
  assert.strictEqual(to.value, "15:45", "keeps the 1-hour length once From is left");
  to.focus();
  to.value = "09:45"; to.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.strictEqual(sr.activeElement, to);
  assert.strictEqual(from.value, "14:45", "From isn't touched while typing Until");
  to.blur(); to.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true, composed: true }));
  assert.strictEqual(from.value, "10:30", "starts an hour before a new Until, and never before now");
});

test("Safari: a newer release shows the update dialog once, then only the footer button, even if later releases skipped Safari", async () => {
  const ctx = setup();
  const { w, app, host, storage } = ctx;
  const gh = [];
  w.chrome.runtime.getURL = (p) => "safari-web-extension://test/" + p;
  const siteFetch = w.fetch;
  w.fetch = async (u, o) => {
    if (String(u).startsWith("https://api.github.com/")) { gh.push(u); return { ok: true, json: async () => [{ tag_name: "v9.9.1", assets: [{ name: "voucherboard-chrome-9.9.1.zip" }] }, { tag_name: "v9.9.0", html_url: "https://github.com/maubergine/voucherboard/releases/tag/v9.9.0", assets: [{ name: "voucherboard-safari-9.9.0.zip", browser_download_url: "https://github.com/maubergine/voucherboard/releases/download/v9.9.0/voucherboard-safari-9.9.0.zip" }] }] }; }
    return siteFetch(u, o);
  };
  await app.open();
  const sr = host.shadowRoot;
  const dlg = await until(() => sr.querySelector(".modal.upd"));
  assert.match(dlg.textContent, /9\.9\.0 is out\. You have 9\.8\.7/);
  assert.match(dlg.textContent, /voucherboard-safari-9\.9\.0\.zip/);
  assert.strictEqual(sr.querySelector("#upGo").getAttribute("href"), "https://github.com/maubergine/voucherboard/releases/download/v9.9.0/voucherboard-safari-9.9.0.zip");
  assert.ok(sr.querySelector('.upd-steps a[href="https://github.com/maubergine/voucherboard/releases/tag/v9.9.0"]'), "links the release page too");
  assert.strictEqual(storage["vb:update"].shown, "9.9.0");
  sr.querySelector("#upClose").click();
  assert.ok(!sr.querySelector(".modal.upd"));
  assert.match(sr.querySelector("#updBtn").textContent, /Update available: v9\.9\.0/);

  app.close(); await app.open(); await sleep(50);
  assert.ok(!sr.querySelector(".modal.upd"), "not shown again");
  assert.strictEqual(gh.length, 1, "checked once a day");
  sr.querySelector("#updBtn").click();
  assert.ok(sr.querySelector(".modal.upd"), "the footer button opens it");
});

test("Chrome never checks for updates", async () => {
  const { w, app, host } = setup();
  const gh = [];
  const siteFetch = w.fetch;
  w.fetch = async (u, o) => { if (String(u).startsWith("https://api.github.com/")) gh.push(u); return siteFetch(u, o); };
  await app.open(); await sleep(50);
  assert.strictEqual(gh.length, 0);
  assert.ok(!host.shadowRoot.querySelector("#updBtn"));
});

// ---------- several permits ----------
// multi: LV-00000001 (9 × 1 hour) and LV-00000002 (3 × 1 hour, 2 × 5 hours) in zone P, LV-00000004 (4 × 1 hour) in zone V.
const weekdays = (n) => ["2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"].slice(0, n);
const planOf = (n) => weekdays(n).map((dk, i) => ({ id: i + 1, vrn: "GH78JKL", dk, from: 600, to: 720 }));

test("several permits in one zone pool their vouchers, by default all of them", async () => {
  const { app, host } = setup({ now: NOW, multi: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.match(sr.querySelector("#balance").textContent, /12 × 1 hour/);
  assert.match(sr.querySelector("#balance").textContent, /2 × 5 hours/);
  assert.match(sr.querySelector("#balance").title, /LV-00000002: 3 × 1 hour, 2 × 5 hours/);
  assert.match(sr.querySelector("#zoneCard").textContent, /Vouchers from LV-00000001 and LV-00000002/);
  assert.deepStrictEqual([...sr.querySelectorAll("#zoneSel option")].map((o) => o.textContent), ["P · 2 permits", "V · LV-00000004"]);
  assert.strictEqual(sr.querySelector("#zoneSel").value, "P");
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "All 2");
  assert.ok(!sr.querySelector("#permitSel"), "no single-permit picker");
});

test("a booking's details say which permits its vouchers came from", async () => {
  const { app, host } = setup({ now: NOW, multi: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  const row = listRows(sr).find((r) => r.textContent.includes("Wed 30 Sep"));
  assert.match(row.textContent, /10:00–12:00/, "one visit across both permits");
  assert.match(row.querySelector("small.from").textContent, /LV-00000001 and LV-00000002/);
  manage(sr, "VW55XYZ", "Wed 30 Sep");
  assert.match(sr.querySelector(".pop dl").textContent, /FromLV-00000001LV-00000002/);
});

test("a single permit shows no permit sources", async () => {
  const { app, host } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  assert.ok(sr.querySelector("#permitSel"), "single-permit picker as before");
  assert.ok(!sr.querySelector("#zoneSel") && !sr.querySelector("#permitsBtn"));
  assert.doesNotMatch(sr.querySelector("#zoneCard").textContent, /Vouchers from/);
  sr.querySelector('[data-view="list"]').click();
  assert.ok(!sr.querySelector(".lt small.from"));
  manage(sr, "VW55XYZ", "Wed 30 Sep");
  assert.doesNotMatch(sr.querySelector(".pop dl").textContent, /From/);
});

test("a plan bigger than one permit books from both, each voucher on its own permit", async () => {
  const { app, host, calls } = setup({ now: NOW, multi: true, live: true, saved: { ["vb:plan:" + MAIN]: planOf(5) } });
  await app.open();
  const sr = host.shadowRoot;
  assert.match(sr.querySelector("#summary").textContent, /10 vouchers to activate/);
  assert.match(sr.querySelector("#summary").textContent, /Leaves 2 × 1h/);
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 8000);
  assert.match(sr.querySelector("#rvNote").textContent, /10 booked/);
  const posts = calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body).get("visitorPermit[PermitId]"));
  assert.deepStrictEqual(posts, [...Array(9).fill(MAIN), SECOND], "the first permit's vouchers first, then the second's");
  const forms = calls.filter((c) => c.m === "GET" && c.path === "/Permit/VisitorPermit");
  assert.strictEqual(forms.length, 10);
  assert.ok([...sr.querySelectorAll(".qs")].some((c) => /Booked ✓ · LV-00000002/.test(c.textContent)));
  assert.ok(calls.some((c) => c.path === "/Permit/Details" && c.m === "GET"), "read both permits");
});

test("a zone's plan starts from its permits' own plans, and stays when a permit is turned off", async () => {
  const { w, app, host, storage } = setup({ now: NOW, multi: true, saved: { ["vb:plan:" + MAIN]: planOf(1) } });
  await app.open();
  const sr = host.shadowRoot;
  assert.match(sr.querySelector("#plan").textContent, /Tue 29 Sep/);
  sr.querySelector("#permitsBtn").click();
  const boxes = () => [...sr.querySelectorAll(".pop [data-permit]")];
  assert.deepStrictEqual(boxes().map((b) => b.checked), [true, true]);
  assert.match(sr.querySelector(".pop").textContent, /LV-000000023 × 1 hour, 2 × 5 hours/);
  const second = boxes().find((b) => b.dataset.permit === SECOND);
  second.checked = false; second.dispatchEvent(new w.Event("change", { bubbles: true }));
  await until(() => sr.querySelector("#permitsBtn") && sr.querySelector("#permitsBtn").textContent === "1 of 2");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(storage["vb:permits"])), { zone: "P", off: [SECOND] });
  assert.match(sr.querySelector("#balance").textContent, /9 × 1 hour/);
  assert.doesNotMatch(sr.querySelector("#zoneCard").textContent, /Vouchers from/);
  assert.match(sr.querySelector("#plan").textContent, /Tue 29 Sep/, "the zone's plan is kept");
  sr.querySelector("#permitsBtn").click();
  const last = boxes().find((b) => b.checked);
  assert.ok(last.disabled, "the last permit in use can't be turned off");
  assert.match(sr.querySelector(".pop").textContent, /LV-00000002Not in use/);
});

test("turning a permit off drops planned changes to its bookings", async () => {
  const plan = [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 630, to: 720, replaces: ["xd771d26b887ce0ee", "x5e2b7c1d9a0f3e64"] }, ...planOf(1)];
  const { w, app, host, storage } = setup({ now: NOW, multi: true, saved: { "vb:plan:zone:P": plan } });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#permitsBtn").click();
  const second = [...sr.querySelectorAll(".pop [data-permit]")].find((b) => b.dataset.permit === SECOND);
  second.checked = false; second.dispatchEvent(new w.Event("change", { bubbles: true }));
  await until(() => /1 planned change to bookings on that permit was removed/.test(toastText(sr)));
  assert.deepStrictEqual([...storage["vb:plan:zone:P"]].map((e) => e.dk), ["2026-09-29"]);
});

test("choosing another zone uses its permit alone, and is remembered", async () => {
  const { w, app, host, storage } = setup({ now: NOW, multi: true });
  await app.open();
  const sr = host.shadowRoot;
  setVal(w, sr.querySelector("#zoneSel"), "V");
  await until(() => sr.querySelector("#zoneSel") && sr.querySelector("#zoneSel").value === "V" && /Lee/.test(sr.querySelector("#zoneCard").textContent));
  assert.match(sr.querySelector("#balance").textContent, /4 × 1 hour/);
  assert.ok(!sr.querySelector("#permitsBtn"), "one permit in zone V: nothing to choose");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(storage["vb:permits"])), { zone: "V", off: [] });
  assert.strictEqual(storage["vb:permit"], OTHER);

  const again = setup({ now: NOW, multi: true, saved: { "vb:permits": { zone: "V", off: [] } } });
  await again.app.open();
  assert.strictEqual(again.host.shadowRoot.querySelector("#zoneSel").value, "V");
});

test("an older saved permit picks its zone, with all of the zone's permits", async () => {
  const { app, host } = setup({ now: NOW, multi: true, saved: { "vb:permit": SECOND } });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#zoneSel").value, "P");
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "All 2");
});

test("the Permits list keeps its order, oldest first, when a permit is turned off", async () => {
  const { w, app, host } = setup({ now: NOW, multi: true, secondOlder: true });
  await app.open();
  const sr = host.shadowRoot;
  const order = () => [...sr.querySelectorAll(".pop [data-permit]")].map((b) => b.dataset.permit);
  sr.querySelector("#permitsBtn").click();
  assert.deepStrictEqual(order(), [SECOND, MAIN]);
  const older = sr.querySelector(`.pop [data-permit="${SECOND}"]`);
  older.checked = false; older.dispatchEvent(new w.Event("change", { bubbles: true }));
  await until(() => sr.querySelector("#permitsBtn") && sr.querySelector("#permitsBtn").textContent === "1 of 2");
  sr.querySelector("#permitsBtn").click();
  assert.deepStrictEqual(order(), [SECOND, MAIN], "the one turned off keeps its place");
});

test("a permit with no vouchers starts unticked, but its bookings still show", async () => {
  const { app, host } = setup({ now: NOW, multi: true, secondEmpty: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "1 of 2");
  assert.match(sr.querySelector("#balance").textContent, /9 × 1 hour/);
  assert.match(sr.querySelector("#zoneCard").textContent, /Vouchers from LV-00000001$/);
  sr.querySelector("#permitsBtn").click();
  const box = (id) => sr.querySelector(`.pop [data-permit="${id}"]`);
  assert.deepStrictEqual([box(SECOND).checked, box(SECOND).disabled, box(SECOND).title], [false, true, "No unused vouchers"]);
  assert.deepStrictEqual([box(MAIN).checked, box(MAIN).disabled], [true, true], "the only permit with vouchers stays in use");
  assert.match(sr.querySelector(".pop").textContent, /LV-00000002No unused vouchers/);
  sr.querySelector("#pmClose").click();
  sr.querySelector('[data-view="list"]').click();
  manage(sr, "VW55XYZ", "Wed 30 Sep");
  assert.match(sr.querySelector(".pop dl").textContent, /FromLV-00000001LV-00000002/, "the empty permit's booking is still there");
});

test("a permit unticks itself once a run uses its last voucher", async () => {
  const { app, host } = setup({ now: NOW, multi: true, live: true, saved: { ["vb:plan:" + MAIN]: planOf(5) } });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "All 2");
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 8000);
  sr.querySelector("#rvGo").click();
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "1 of 2", "LV-00000001's 9 are used up");
  assert.match(sr.querySelector("#balance").textContent, /2 × 1 hour/);
  sr.querySelector("#permitsBtn").click();
  assert.strictEqual(sr.querySelector(`.pop [data-permit="${MAIN}"]`).checked, false);
});

test("the Permits popover stays open and switches without reloading the page", async () => {
  const { w, app, host, calls } = setup({ now: NOW, multi: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#permitsBtn").click();
  const box = () => sr.querySelector(`.pop [data-permit="${SECOND}"]`);
  let n = calls.length;
  box().checked = false; box().dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.ok(sr.querySelector(".pop.permits"), "still open");
  assert.strictEqual(box().checked, false);
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "1 of 2");
  assert.match(sr.querySelector("#balance").textContent, /9 × 1 hour/);
  assert.deepStrictEqual(calls.slice(n), [], "turning off sends nothing");
  n = calls.length;
  box().checked = true; box().dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(box().closest("label").textContent, /Loading…/);
  assert.ok(box().checked && box().disabled, "ticked straight away, while it's read");
  await until(() => /3 × 1 hour, 2 × 5 hours/.test(box().closest("label").textContent));
  assert.deepStrictEqual(calls.slice(n).map((c) => c.path), ["/Permit/Details"]);
  assert.strictEqual(sr.querySelector("#permitsBtn").textContent, "All 2");
  assert.ok(sr.querySelector("#board"), "the planner stayed on screen");
});

// ---------- 5-hour, day and week vouchers, as the live site showed them on 24 Oct 2026 ----------
// TU44VWX booked for 5 hours on 26 Oct, a day on 27 Oct (to 09:59 on 28 Oct) and a week from 2 Nov (to 09:59 on 9 Nov).
const LONG_NOW = "2026-10-24T08:20:00";

test("5-hour, day and week bookings show at their full length, and a week booking cancels like the live site", async () => {
  const { w, app, host, calls } = setup({ now: LONG_NOW, long: true, live: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.deepStrictEqual([...sr.querySelectorAll("#balance .vchip")].map((c) => c.textContent), ["13 × 1 hour", "1 × 5 hours", "1 × 1 day", "1 × 1 week"]);
  sr.querySelector('[data-view="list"]').click();
  const cells = (r) => [...r.querySelectorAll("td")].map((c) => c.textContent.replace(/\s+/g, " ").trim());
  assert.deepStrictEqual(listRows(sr).map((r) => [cells(r)[0], cells(r)[1], cells(r)[3]]), [
    ["Mon 26 Oct", "10:00–15:00", "1 × 5 hours"], ["Tue 27 Oct", "10:00 – Wed 28 Oct 10:00", "1 × 1 day"], ["Mon 2 Nov", "10:00 – Mon 9 Nov 10:00", "1 × 1 week"]
  ]);
  manage(sr, "TU44VWX", "Mon 2 Nov");
  const pop = sr.querySelector(".pop");
  const dl = [...pop.querySelectorAll("dt")].map((t) => [t.textContent, t.nextElementSibling.textContent]);
  assert.deepStrictEqual(dl.slice(0, 2), [["Starts", "Mon 2 Nov, 10:00"], ["Ends", "Mon 9 Nov, 10:00"]]);
  assert.match(pop.textContent, /1 × 1 week/);
  assert.ok(!sr.querySelector("#pChange"), "a week booking's time isn't changed in place");
  sr.querySelector("#pCancel").click();
  sr.querySelector("#pYes").click();
  await until(() => /Cancelled\. 1 voucher returned/.test(toastText(sr)));
  assert.strictEqual(calls.find((c) => c.path === "/Permit/CancelVisitorVoucher").body, "__RequestVerificationToken=TEST-TOKEN&Id=xe585676b2ac60909&ReturnUrl=");
});

test("a week booking shows on each day it covers, and those days need no voucher", async () => {
  const { app, host } = setup({ now: LONG_NOW, long: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="cal"]').click();
  const chips = (dk) => [...sr.querySelectorAll(`[data-pick="${dk}"] .chipbk`)].map((c) => c.textContent);
  assert.deepStrictEqual(chips("2026-10-28"), ["0–10 Alex Visitor"]);
  assert.deepStrictEqual(chips("2026-11-05"), ["0–24 Alex Visitor"]);
  assert.deepStrictEqual(chips("2026-11-10"), []);
});

test("books 5-hour and day vouchers with the live site's period ids", async () => {
  const { w, app, host, calls } = setup({ now: LONG_NOW, long: true, live: true, zone: "T - Ladywell" }); // Mon–Fri 09:00–19:00
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector("#vq").dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  [...sr.querySelectorAll("#vlist .opt[data-vrn]")].find((o) => o.dataset.vrn === "LM11NPR").click();
  const add = (dk, f, t) => {
    sr.querySelector("#clearD").click();
    sr.querySelector(`#mini button[data-pick="${dk}"]`).click();
    setVal(w, sr.querySelector("#tFrom"), f); setVal(w, sr.querySelector("#tTo"), t);
    sr.querySelector("#addPlan").click();
  };
  add("2026-10-29", "09:00", "14:00");
  add("2026-10-30", "09:00", "19:00");
  assert.match(sr.querySelector("#plan").textContent, /5h 09:00/);
  assert.match(sr.querySelector("#plan").textContent, /Day 09:00/);
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /2 booked/);
  const posts = calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body));
  assert.deepStrictEqual(posts.map((b) => [b.get("visitorPermit[Date]"), b.get("visitorPermit[FromTime]"), b.get("visitorPermit[VisitorVoucherPeriodId]")]),
    [["29/10/2026", "09:00", "x650b78ed8821b9ed"], ["30/10/2026", "09:00", "x44a4f9f3dfca7e00"]]);
});

test("Choose vouchers yourself: the composer books a week voucher with the live site's period id", async () => {
  const { w, app, host, calls, storage } = setup({ now: LONG_NOW, long: true, live: true });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#kindSec").hidden, true, "off by default");
  sr.querySelector("#settingsBtn").click();
  const pk = sr.querySelector("#sKinds"); pk.checked = true; pk.dispatchEvent(new w.Event("change", { bubbles: true }));
  sr.querySelector("#stClose").click();
  assert.strictEqual(sr.querySelector("#kindSec").hidden, false);
  assert.deepStrictEqual([...sr.querySelectorAll("#kindSel option")].map((o) => o.textContent), ["Cheapest mix", "1 hour (13 unused)", "5 hours (1 unused)", "1 day (1 unused)", "1 week (1 unused)"]);
  sr.querySelector("#vq").dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  [...sr.querySelectorAll("#vlist .opt[data-vrn]")].find((o) => o.dataset.vrn === "LM11NPR").click();
  sr.querySelector("#clearD").click();
  sr.querySelector('#mini button[data-pick="2026-10-29"]').click();
  setVal(w, sr.querySelector("#tFrom"), "10:00"); setVal(w, sr.querySelector("#tTo"), "12:00");
  setVal(w, sr.querySelector("#kindSel"), "week");
  sr.querySelector("#addPlan").click();
  assert.match(sr.querySelector("#plan").textContent, /1 week chosen/);
  assert.match(sr.querySelector("#plan").textContent, /Week 10:00/);
  assert.strictEqual(storage["vb:plan:x80b66f1c3b5e7742"][0].kind, "week");
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  const post = new URLSearchParams(calls.find((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").body);
  assert.deepStrictEqual([post.get("visitorPermit[Date]"), post.get("visitorPermit[FromTime]"), post.get("visitorPermit[VisitorVoucherPeriodId]")], ["29/10/2026", "10:00", "x530f0ffce15ed6ce"]);
});

test("start to end: one booking over several days, planned, changed and tested", async () => {
  const { w, app, host, storage, calls } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot, focusout = (el) => el.dispatchEvent(new w.FocusEvent("focusout", { bubbles: true, composed: true }));
  sr.querySelector("#vq").dispatchEvent(new w.FocusEvent("focusin", { bubbles: true, composed: true }));
  sr.querySelector("#vlist .opt[data-vrn]").click();
  // the repeat choice carries over: next week, 10:00 to 12:00, becomes Mon 10:00 to Fri 12:00
  sr.querySelector("#clearD").click();
  [...sr.querySelectorAll("#dquick .qbtn")].find((b) => b.textContent === "Next week").click();
  setVal(w, sr.querySelector("#tFrom"), "10:00"); focusout(sr.querySelector("#tFrom"));
  setVal(w, sr.querySelector("#tTo"), "12:00"); focusout(sr.querySelector("#tTo"));
  sr.querySelector("#mStay").click();
  assert.ok(!sr.querySelector("#staySec").hidden && sr.querySelector("#mini").closest(".c-sec").hidden);
  assert.strictEqual(sr.querySelector("#modeNote"), null, "no note under either mode");
  assert.deepStrictEqual([sr.querySelector("#sFromD").value, sr.querySelector("#sFrom").value, sr.querySelector("#sToD").value, sr.querySelector("#sTo").value], ["2026-10-05", "10:00", "2026-10-09", "12:00"]);
  // Fri 17:00 to Mon 11:00, by tapping the first and last day: only Monday's 10:00 to 11:00 is controlled
  setVal(w, sr.querySelector("#sFrom"), "17:00"); focusout(sr.querySelector("#sFrom"));
  sr.querySelector('#smini [data-pick="2026-10-02"]').click();
  assert.match(sr.querySelector("#pending").textContent, /tap the last day/);
  sr.querySelector('#smini [data-pick="2026-10-05"]').click();
  setVal(w, sr.querySelector("#sTo"), "11:00"); focusout(sr.querySelector("#sTo"));
  const pend = sr.querySelector("#pending").textContent;
  assert.match(pend, /Fri 2 Oct – Mon 5 Oct/); assert.match(pend, /From 17:00 to Mon 5 Oct 11:00/); assert.match(pend, /1h Mon 10:00/);
  assert.match(pend, /1 h of controlled hours over 1 day/);
  assert.match(sr.querySelector("#addPlan").textContent, /Add 1 booking to plan \(1 voucher\)/);
  sr.querySelector("#addPlan").click();
  await until(() => storage["vb:plan:x80b66f1c3b5e7742"] && storage["vb:plan:x80b66f1c3b5e7742"].length);
  assert.deepStrictEqual([...storage["vb:plan:x80b66f1c3b5e7742"]].map((e) => [e.dk, e.from, e.to]), [["2026-10-02", 1020, 3 * 1440 + 660]]);
  assert.strictEqual(storage["vb:settings"].bookMode, "stay");
  // its days and times change together
  sr.querySelector("#plan [data-edit]").click();
  setVal(w, sr.querySelector("#edToD"), "2026-10-06"); sr.querySelector("#edTo").value = "12:00";
  sr.querySelector("#edSave").click();
  assert.match(sr.querySelector("#plan").textContent, /From 17:00 to Tue 6 Oct 12:00/);
  assert.match(sr.querySelector("#summary").textContent, /4 vouchers to activate/);
  sr.querySelector("#review").click();
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.strictEqual(calls.filter((c) => c.path === "/Permit/GetNonEnforceableCoverage").length, 4);
  sr.querySelector("#mRepeat").click();
  assert.ok(sr.querySelector("#staySec").hidden);
});

// ---------- smart replan ----------
// Offers start folded: open one (its triangle), and return it as drawn again.
const unfold = (sr, where, vrn) => { sr.querySelector(`${where} [data-rfold${vrn ? `="${vrn}"` : ""}]`).click(); return sr.querySelector(`${where} [data-rfold${vrn ? `="${vrn}"` : ""}]`).closest(".replan"); };
test("smart replan: bookings made on the council site get a badge and a cheaper way, used only when chosen", async () => {
  const { app, host, calls, cancelled } = setup({ now: LONG_NOW, long: true, live: true });
  await app.open();
  const sr = host.shadowRoot, badge = sr.querySelector("#replanBadge");
  assert.ok(!badge.hidden); assert.strictEqual(badge.textContent, "1");
  assert.strictEqual(sr.querySelector("#replanPlan").textContent, "", "nothing planned, so not in the plan");
  assert.strictEqual(sr.querySelector("#plan").textContent, "Your plan is empty. Add bookings above.", "never applied by itself");
  sr.querySelector('[data-view="list"]').click();
  const folded = sr.querySelector("#replanList .replan");
  assert.match(folded.textContent, /Save £19\.06 on Alex Visitor/);
  assert.ok(!folded.querySelector("[data-replan]") && !/Cancels/.test(folded.textContent), "folded at first");
  assert.ok(!folded.querySelector("[data-rsel]") && !sr.querySelector(".rbar"), "one offer: no ticks, no bar");
  const card = unfold(sr, "#replanList");
  assert.ok(card && !card.classList.contains("alt"), "uses only vouchers held: the clear choice");
  assert.match(card.textContent, /all from vouchers you have\. Cancels 3 booked vouchers that haven't started/);
  card.querySelector("[data-replan]").click();
  assert.match(toastText(sr), /Smart replan for Alex Visitor is in your plan\. Review it to apply/);
  assert.ok(badge.hidden, "no better way left");
  assert.strictEqual(sr.querySelectorAll("#plan .pl").length, 3);
  assert.match(sr.querySelector("#plan").textContent, /Smart replan/);
  assert.ok(listRows(sr).some((r) => /Smart replan/.test(r.textContent)));
  sr.querySelector("#review").click();
  assert.match(sr.querySelector("#rvT").textContent, /and cancel 3 booked vouchers/);
  const kinds = [...sr.querySelectorAll("#rvBody tr")].map((r) => (r.classList.contains("cancel") ? "cancel" : "book"));
  assert.deepStrictEqual(kinds.slice(0, 3), ["cancel", "cancel", "cancel"], "every booking is cancelled before the first new one");
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 10000);
  assert.match(sr.querySelector("#rvNote").textContent, /3 cancelled/);
  assert.strictEqual(cancelled.size, 3);
  const iBook = calls.findIndex((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit"), iLast = calls.map((c) => c.path).lastIndexOf("/Permit/CancelVisitorVoucher");
  assert.ok(iBook > iLast, "cancelled first");
});

test("smart replan: dropping one part drops it all, with undo", async () => {
  const { app, host } = setup({ now: LONG_NOW, long: true });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  unfold(sr, "#replanList").querySelector("[data-replan]").click();
  sr.querySelector("#plan [data-rment]").click();
  assert.match(toastText(sr), /Smart replan dropped\. Your bookings stay as they are/);
  assert.strictEqual(sr.querySelectorAll("#plan .pl").length, 0);
  assert.ok(!sr.querySelector("#replanBadge").hidden);
  sr.querySelector(".toast button").click();
  assert.strictEqual(sr.querySelectorAll("#plan .pl").length, 3);
});

test("smart replan: a visit added later shows in the plan, booked together with its booking", async () => {
  // zone T, 09:00–19:00: a 5-hour booking at 10:00 on Mon 26 Oct, then 15:00 to 19:00 planned. One day voucher covers both.
  const plan = [{ id: 1, vrn: "TU44VWX", dk: "2026-10-26", from: 15 * 60, to: 19 * 60 }];
  const { app, host } = setup({ now: LONG_NOW, long: true, zone: "T - Ladywell", plan });
  await app.open();
  const sr = host.shadowRoot;
  assert.ok(sr.querySelector("#replanPlan .replan"), "offered in the plan");
  const card = unfold(sr, "#replanPlan");
  assert.match(card.textContent, /Save £2\.49 on Alex Visitor/);
  assert.match(card.textContent, /Uses 1 × 1 day instead of 2 × 5 hours, all from vouchers you have\. Cancels 1 booked voucher/);
  assert.match(sr.querySelector("#plan").textContent, /Asked for 15:00–19:00/, "the plan stays as it was");
  card.querySelector("[data-replan]").click();
  assert.match(sr.querySelector("#summary").textContent, /1 voucher to activate/);
  assert.ok(sr.querySelector("#summary").textContent.includes("1 × 1 day"));
});

test("smart replan: one that needs vouchers bought is offered quietly, with what to buy", async () => {
  // zone T: 10:00 to 11:00 booked, 11:00 to 19:00 planned, only 1-hour vouchers held. A day voucher would cover it all.
  const plan = [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 11 * 60, to: 19 * 60 }];
  const { app, host } = setup({ now: NOW, zone: "T - Ladywell", plan });
  await app.open();
  const sr = host.shadowRoot, card = unfold(sr, "#replanPlan");
  assert.ok(card && card.classList.contains("alt"));
  assert.match(card.textContent, /Cheaper overall: save £2\.24/);
  assert.match(card.textContent, /Uses 1 × 1 day instead of 1 × 1 hour \+ 1 × 1 day\./);
  assert.match(card.textContent, /needs vouchers you don't have \(1 × 1 day\), so it doesn't wholly reuse your vouchers/);
  assert.match(card.querySelector("[data-replan]").textContent, /Replan and see what to buy/);
  assert.ok(!card.querySelector(".smartbtn"), "not styled as the clear choice");
  sr.querySelector("#replanPlan [data-rfold]").click();
  assert.ok(!sr.querySelector("#replanPlan [data-replan]"), "and folds again");
});

test("smart replan: in its last 10 minutes it counts down to the second, then it's worked out again", async () => {
  // zone T: VW55XYZ's 10:00 booking on Wed 30 Sep, and 11:00 to 19:00 planned. It's 09:55:30.
  const plan = [{ id: 1, vrn: "VW55XYZ", dk: "2026-09-30", from: 11 * 60, to: 19 * 60 }];
  const { w, app, host } = setup({ now: "2026-09-30T09:55:30", zone: "T - Ladywell", plan });
  await app.open();
  const sr = host.shadowRoot, cd = () => sr.querySelector("#replanPlan .countdown");
  await until(() => cd() && !cd().hidden);
  assert.match(cd().textContent, /Its first booking starts in 4:30\. Replan before then, or this offer ends\./);
  const at = (t) => { const RD = Object.getPrototypeOf(w.Date), fixed = new RD(t).getTime(); w.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; };
  // chosen with a minute to go: the plan counts down instead
  at("2026-09-30T09:59:00");
  assert.ok(!sr.querySelector("#replanPlan [data-replan]"), "the countdown shows while folded");
  unfold(sr, "#replanPlan").querySelector("[data-replan]").click();
  await until(() => /Its first booking starts in 1:00\. Book it before then, or this replan is dropped\./.test(sr.querySelector("#plan").textContent));
  at("2026-09-30T10:00:01");
  await until(() => /Smart replan for Blair Visitor dropped: a booking it changed has started/.test(toastText(sr)), 3000);
  assert.deepStrictEqual([...sr.querySelectorAll("#plan .req")].map((x) => x.textContent.trim().replace(/\s+/g, " ")), ["Asked for 11:00–19:00 Change time"], "the planned visit is back as it was");
  assert.strictEqual(sr.querySelector("#replanPlan").textContent, "", "and nothing is offered: the booking has started");
});

test("smart replan: several offers get a bar to replan all, or the ones ticked, unless they need more vouchers together", async () => {
  // the demo: Grandad's and Auntie's five day vouchers (one week is cheaper, and one week voucher is held), and Builder's
  // 10:00 and 11:00 on Fri 2 Oct, with 12:00 to 13:00 planned (one 5-hour voucher is cheaper)
  const { app, host } = setup({ now: NOW, demo: true, saved: { "vb:plan:zone:B1": [{ id: 1, vrn: "TU44VWX", dk: "2026-10-02", from: 720, to: 780 }] } });
  await app.open();
  const sr = host.shadowRoot;
  assert.strictEqual(sr.querySelector("#replanBadge").textContent, "3");
  sr.querySelector('[data-view="list"]').click();
  const titles = () => [...sr.querySelectorAll("#replanList .replan > .rhead b")].map((b) => b.textContent);
  assert.deepStrictEqual(titles(), ["Save £6.20 on Grandad", "Save £6.20 on Auntie", "Save £1.13 on Builder"], "biggest first, folded");
  assert.ok(!sr.querySelector("#replanList [data-replan]"));
  const bar = () => sr.querySelector("#replanList .rbar"), go = () => bar().querySelector("[data-replans]");
  // Grandad's and Auntie's both want the one week voucher held
  assert.ok(bar().classList.contains("short"));
  assert.match(bar().textContent, /3 vehicles could cost less/);
  assert.match(bar().textContent, /Not enough vouchers to replan all of these together: between them they need more than you have\. Tick the ones you want, or replan one at a time\./);
  assert.deepStrictEqual([go().textContent, go().disabled], ["Replan all 3", true]);
  assert.strictEqual(sr.querySelector("#replanPlan .rbar"), null, "the plan has Builder's alone: no bar");
  const tick = (vrn) => { const c = sr.querySelector(`#replanList [data-rsel="${vrn}"]`); c.checked = !c.checked; c.dispatchEvent(new host.ownerDocument.defaultView.Event("change", { bubbles: true })); };
  tick("KL21MNO"); tick("MN19PQR");
  assert.deepStrictEqual([go().textContent, go().disabled], ["Replan selected (2)", true]);
  assert.match(bar().textContent, /Not enough vouchers to replan the selected together/);
  tick("MN19PQR"); tick("TU44VWX");
  assert.deepStrictEqual([go().textContent, go().disabled], ["Replan selected (2)", false]);
  assert.match(bar().textContent, /Save £7\.33 on 2 vehicles/);
  assert.ok(!bar().classList.contains("short"));
  assert.ok(sr.querySelector('#replanList [data-rsel="TU44VWX"]').checked, "stays ticked when drawn again");
  go().click();
  assert.match(toastText(sr), /Smart replans for Grandad and Builder are in your plan\. Review it to apply/);
  assert.strictEqual(sr.querySelector("#replanBadge").textContent, "1", "Auntie's is left, now needing a week voucher bought");
  assert.ok(sr.querySelector("#replanList .replan.alt"));
  assert.strictEqual(sr.querySelectorAll("#plan .pl").length, 6, "five days and Builder's stretch");
});
