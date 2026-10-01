// Runs the real UI against saved (anonymised) portal pages with a fake backend. No network.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const TERMS = require("../src/terms.js");
const src = (n) => fs.readFileSync(path.join(__dirname, "..", "src", n), "utf8");

const opened = [];
test.afterEach(() => { for (const x of opened.splice(0)) { try { x.app.close(); } catch (e) { /* already closed */ } x.w.close(); } });

function setup({ nonEnforced = false, now = null, plan = null, noTerms = false, live = false, zone = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://parkingpermits.lewisham.gov.uk/Home/Index", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  if (now) { // pin the clock, so bookings in the saved pages are upcoming, running or finished as a test needs
    const RD = w.Date, fixed = new RD(now).getTime();
    w.Date = class extends RD { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
  }
  const calls = [];
  const storage = {};
  const zoned = (html) => (zone ? html.replaceAll("P - Hither Green East", zone) : html);
  if (plan) storage["vb:plan:x80b66f1c3b5e7742"] = plan;
  if (!noTerms) storage["vb:terms"] = { version: TERMS.VERSION };
  if (!live) storage["vb:settings"] = { testMode: true }; // the app starts live; tests run in test mode unless they ask
  const deleted = new Set(), cancelled = new Set(), created = [];
  const vehiclesPage = () => {
    if (!deleted.size && !created.length) return fx("applicant-vehicles.html");
    const d = new w.DOMParser().parseFromString(fx("applicant-vehicles.html"), "text/html");
    for (const t of d.querySelectorAll(".hometile")) { const i = t.querySelector('input[name="item.Id"]'); if (i && deleted.has(i.value)) t.remove(); }
    for (const c of created) d.querySelector("#vehicleContainer").insertAdjacentHTML("beforeend", `<div class="hometile"><input name="item.Id" type="hidden" value="${c.id}"><label class="names">${c.name}</label><div id="Vrn">${c.vrn}</div></div>`);
    return d.documentElement.outerHTML;
  };
  const detailsPage = () => {
    if (!cancelled.size) return zoned(fx("permit-details.html"));
    const d = new w.DOMParser().parseFromString(fx("permit-details.html"), "text/html");
    for (const c of d.querySelectorAll(".used-vouchers")) if ([...c.querySelectorAll("[data-id]")].some((x) => cancelled.has(x.getAttribute("data-id")))) c.remove();
    return d.documentElement.outerHTML;
  };
  w.chrome = {
    runtime: { getURL: (p) => "chrome-extension://test/" + p, getManifest: () => ({ version: "9.8.7" }) },
    storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (o) => Object.assign(storage, o) } }
  };
  w.matchMedia = () => ({ matches: false });
  const reply = (body, { url, json } = {}) => ({ ok: true, status: 200, url: url || "", text: async () => body, json: async () => (json !== undefined ? json : JSON.parse(body)) });
  w.fetch = async (p, opt = {}) => {
    if (String(p).startsWith("chrome-extension://")) return reply(src("app.css"));
    const u = new URL(p, w.location.href), m = (opt.method || "GET").toUpperCase();
    calls.push({ m, path: u.pathname, body: opt.body || "" });
    const at = (x) => u.pathname === x;
    if (at("/Home/ApplicantPermits")) return reply(zoned(fx("applicant-permits.html")), { url: u.href });
    if (at("/Permit/Details")) return reply(detailsPage(), { url: u.href });
    if (at("/Home/ApplicantVehicles")) return reply(vehiclesPage(), { url: u.href });
    if (at("/Permit/CancelVoucherConfirmationPopup")) return reply(fx("cancel-popup.html").replace("xd771d26b887ce0ee", u.searchParams.get("permitVehicleId")), { url: u.href });
    if (at("/Permit/CancelVisitorVoucher")) { cancelled.add(new URLSearchParams(opt.body).get("Id")); return reply("", { url: "https://parkingpermits.lewisham.gov.uk/Permit/Details?permitId=x80b66f1c3b5e7742" }); }
    if (at("/Permit/VerifyNicknameOfVisitorVoucher")) return reply("", { json: { Result: "Success" } });
    if (at("/FavouriteVehicle/Create") && m === "GET") return reply(fx("favourite-create-popup.html"), { url: u.href });
    if (at("/FavouriteVehicle/Create") && m === "POST") { const b = new URLSearchParams(opt.body); created.push({ id: "xnew" + created.length, name: b.get("Name"), vrn: b.get("Vrn") }); return reply("", { url: "https://parkingpermits.lewisham.gov.uk/Home/ApplicantVehicles" }); }
    if (at("/FavouriteVehicle/Delete") && m === "GET") return reply(fx("favourite-delete-popup.html").replace("x7611b00bb2be593e", u.searchParams.get("id")), { url: u.href });
    if (at("/FavouriteVehicle/Delete") && m === "POST") { deleted.add(new URLSearchParams(opt.body).get("Id")); return reply("", { url: "https://parkingpermits.lewisham.gov.uk/Home/ApplicantVehicles" }); }
    if (at("/VoucherBuyAgain/VoucherSelect")) return reply(fx("voucher-select.html"), { url: u.href });
    if (at("/Permit/VisitorPermit") && m === "GET") return reply(fx("visitor-permit-form.html"), { url: u.href });
    if (at("/Permit/GetNonEnforceableCoverage")) return reply("", { json: nonEnforced ? { Result: "Error", message: "The date or time you have selected is during non-enforcement hours" } : { Result: "Success" } });
    if (at("/Permit/VerifyDateTimeOfVisitorVoucher")) return reply("", { json: { Message: "" } });
    if (at("/Permit/GetVisitorVoucherConfirmation")) {
      const b = new URLSearchParams(opt.body);
      const favs = w.VB.portal.parseVehicles(w.VB.portal.parseHtml(fx("applicant-vehicles.html")));
      const fav = favs.find((f) => f.favId === b.get("FavoriteVehiclesId"));
      const d = b.get("Date"), vrn = b.get("VrnNumber") || (fav ? `${fav.vrn} (${fav.nick.toUpperCase()})` : "UNKNOWN");
      return reply(`<div>Number Plate ${vrn} Start Date ${d} Start Time ${b.get("FromTime")}</div>`, { url: u.href });
    }
    if (at("/Permit/VisitorPermit") && m === "POST") return reply(fx("permit-details.html"), { url: "https://parkingpermits.lewisham.gov.uk/Permit/Details?permitId=1" });
    throw new Error("unexpected request " + m + " " + u.pathname);
  };
  for (const f of ["zones.js", "planner.js", "portal.js", "terms.js", "app.js"]) w.eval(src(f));
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
  sr.querySelector("#edFrom").value = "10:00"; setVal(w, sr.querySelector("#edTo"), "12:00");
  assert.match(sr.querySelector("#edPrev").textContent, /uses 2 × 1 hour/);
  sr.querySelector("#edOk").click();
  assert.match(sr.querySelector("#plan").textContent, /Change to 10:00–12:00/);
  assert.match(sr.querySelector("#plan").textContent, /Replaces the booking at 10:00–11:00/);
  assert.ok(listRows(sr).some((r) => /Changing \(in plan\)/.test(r.textContent)), "old booking marked as changing");
  sr.querySelector("#review").click();
  assert.match(sr.querySelector("#rvT").textContent, /Activate 2 vouchers and cancel 1 booked voucher/);
  sr.querySelector("#rvGo").click();
  await until(() => sr.querySelector("#rvGo").textContent === "Done", 5000);
  assert.match(sr.querySelector("#rvNote").textContent, /2 booked, 1 cancelled/);
  assert.ok(cancelled.has("xd771d26b887ce0ee"));
  const iCancel = calls.findIndex((c) => c.path === "/Permit/CancelVisitorVoucher"), iBook = calls.findIndex((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit");
  assert.ok(iCancel >= 0 && iBook > iCancel, "cancelled before booking");
  const times = calls.filter((c) => c.m === "POST" && c.path === "/Permit/VisitorPermit").map((c) => new URLSearchParams(c.body).get("visitorPermit[FromTime]"));
  assert.deepStrictEqual(times, ["10:00", "11:00"]);
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

test("ends a booking in progress early, only with the beta option on", async () => {
  const { w, app, host, cancelled } = setup({ now: NOW });
  await app.open();
  const sr = host.shadowRoot;
  sr.querySelector('[data-view="list"]').click();
  manage(sr, "TU44VWX", "Mon 28 Sep");
  assert.ok(!sr.querySelector("#pShrink"), "hidden while the beta is off");
  assert.match(sr.querySelector(".pop").textContent, /turn on the beta option/);
  assert.match(sr.querySelector(".pop").textContent, /in Settings/);
  sr.querySelector("#settingsBtn").click();
  const beta = sr.querySelector("#sBeta"); beta.checked = true; beta.dispatchEvent(new w.Event("change", { bubbles: true }));
  sr.querySelector("#stClose").click();
  manage(sr, "TU44VWX", "Mon 28 Sep");
  sr.querySelector("#pShrink").click();
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
  assert.match(sr.querySelector(".terms").textContent, /No support is provided/);
  const tx = sr.querySelector(".terms").textContent;
  assert.match(tx, /reserves all commercial rights/);
  assert.match(tx, /create, help create or improve any product or service that competes with it/);
  assert.match(tx, /All of Voucherboard is a beta/);
  assert.match(tx, /tell you to stop using this version/);
  assert.match(tx, /You have no right to keep using this version/);
  assert.match(sr.querySelector(".brand").textContent, /Beta/);
  assert.match(sr.querySelector(".terms").textContent, /no expectation of any/);
  assert.match(sr.querySelector(".terms").textContent, /change to the council's website or its terms that allows, restricts or prohibits use of the extension/);
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
