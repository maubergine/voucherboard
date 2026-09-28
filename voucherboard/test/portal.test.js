const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
globalThis.DOMParser = new JSDOM("").window.DOMParser;
const P = require("../src/portal.js");

const doc = (name) => P.parseHtml(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

test("parses permits and picks the active visitor permit", () => {
  const permits = P.parsePermits(doc("applicant-permits.html"));
  assert.strictEqual(permits.length, 3);
  const usable = permits.filter(P.isUsableVisitorPermit);
  assert.strictEqual(usable.length, 1);
  assert.strictEqual(usable[0].id, "x80b66f1c3b5e7742");
  assert.match(usable[0].zoneName, /^P - Hither Green East$/);
});

test("parses bookings and unused vouchers from permit details", () => {
  const d = P.parseDetails(doc("permit-details.html"));
  assert.strictEqual(d.permitId, "x80b66f1c3b5e7742");
  assert.strictEqual(d.zoneName, "P - Hither Green East");
  const active = d.bookings.filter((b) => b.state === "active");
  const expired = d.bookings.filter((b) => b.state === "expired");
  assert.strictEqual(active.length, 3);
  assert.strictEqual(expired.length, 8);
  const b = active[0];
  assert.deepStrictEqual([b.date, b.start, b.mins], ["2026-09-28", 600, 60]);
  assert.match(b.vrn, /^[A-Z0-9]+$/);
  assert.ok(b.id && b.id.startsWith("x"));
  assert.strictEqual(expired.every((x) => !x.cancellable), true);
  assert.strictEqual(active.filter((x) => x.cancellable).length, 2);
  assert.strictEqual(d.unused.length, 9);
  assert.ok(d.unused.every((u) => u.type === "h1" && u.permitVehicleId.startsWith("x")));
});

test("parses favourite vehicles with plates", () => {
  const v = P.parseVehicles(doc("applicant-vehicles.html"));
  assert.strictEqual(v.length, 8);
  assert.ok(v.every((x) => x.favId.startsWith("x") && /^[A-Z0-9]{2,10}$/.test(x.vrn) && x.nick));
});

test("parses the use-voucher form", () => {
  const f = P.parseVisitorForm(doc("visitor-permit-form.html"));
  assert.strictEqual(f.token, "TEST-TOKEN");
  assert.strictEqual(f.permitId, "x80b66f1c3b5e7742");
  assert.deepStrictEqual(f.periods.map((p) => p.type), ["h1"]);
  assert.strictEqual(f.favourites.length, 8);
  assert.strictEqual(f.voucherActivationType, "Account");
  assert.strictEqual(f.carParkRequired, false);
});

test("parses a use-voucher form whose length is fixed", () => {
  const f = P.parseVisitorForm(doc("visitor-permit-form-fixed-period.html"));
  assert.deepStrictEqual(f.periods, [{ id: "x3fb777432fe6d1ba", label: "", type: null, fixed: true }]);
});

test("books a voucher whose length is fixed by the site", async () => {
  const calls = fakeFetch({
    "GET /Permit/VisitorPermit": { body: fs.readFileSync(path.join(__dirname, "fixtures", "visitor-permit-form-fixed-period.html"), "utf8") },
    "POST /Permit/GetNonEnforceableCoverage": { json: { Result: "Success" } },
    "GET /Permit/VerifyDateTimeOfVisitorVoucher": { json: { Message: "" } },
    "POST /Permit/GetVisitorVoucherConfirmation": { body: "<div>CV17FTZ 29/09/2026</div>" },
    "POST /Permit/VisitorPermit": { url: "https://parkingpermits.lewisham.gov.uk/Permit/Details?permitId=1" }
  });
  const r = await P.bookOne({ permitId: "x80b66f1c3b5e7742", voucher: { permitVehicleId: "xd771d26b887ce0ee", type: "h1" }, act: { dk: "2026-09-29", start: 615, type: "h1" }, vehicle: { vrn: "CV17FTZ" }, testMode: false });
  assert.deepStrictEqual(r, { booked: true });
  assert.strictEqual(new URLSearchParams(calls.at(-1).body).get("visitorPermit[VisitorVoucherPeriodId]"), "x3fb777432fe6d1ba");
});

test("a fixed-length voucher is not used for a different length", async () => {
  fakeFetch({ "GET /Permit/VisitorPermit": { body: fs.readFileSync(path.join(__dirname, "fixtures", "visitor-permit-form-fixed-period.html"), "utf8") } });
  await assert.rejects(P.bookOne({ permitId: "p", voucher: { permitVehicleId: "x1", type: "h1" }, act: { dk: "2026-09-29", start: 600, type: "h5" }, vehicle: { vrn: "CV17FTZ" }, testMode: false }), /can't be used/);
});

test("parses the cancel popup", () => {
  const c = P.parseCancelPopup(doc("cancel-popup.html"));
  assert.strictEqual(c.token, "TEST-TOKEN");
  assert.ok(c.id.startsWith("x"));
});

test("reads durations and time stamps", () => {
  assert.strictEqual(P.durationType("1 Hour"), "h1");
  assert.strictEqual(P.durationType("5 Hours (£5.59)"), "h5");
  assert.strictEqual(P.durationType("1 Day"), "day");
  assert.strictEqual(P.durationType("1 Week"), "week");
  assert.deepStrictEqual(P.parseStamp("03.09.2026 11:10"), { dk: "2026-09-03", min: 670 });
  assert.strictEqual(P.ddmmyyyy("2026-09-30"), "30/09/2026");
  assert.strictEqual(P.normVrn("ab12 cde"), "AB12CDE");
});

test("reads voucher prices from the buy page", () => {
  const p = P.parsePrices(doc("voucher-select.html"));
  assert.deepStrictEqual(Object.keys(p).sort(), ["day", "h1", "h5", "week"]);
  assert.deepStrictEqual([p.h1.price, p.h5.price, p.day.price, p.week.price], [2.24, 5.59, 8.69, 37.25]);
  assert.strictEqual(p.h1.periodPriceId, "22465");
  assert.strictEqual(p.h1.book, 1);
});

test("reads a book price per voucher", () => {
  const d = P.parseHtml('<select id="PeriodPriceIdSelected"><option value="">Select...</option><option value="9">Book of 10 x 1 Hour (&#163;22.40)</option></select>');
  assert.deepStrictEqual(P.parsePrices(d).h1, { periodPriceId: "9", label: "Book of 10 x 1 Hour (£22.40)", book: 10, price: 2.24 });
});

function fakeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (p, opt = {}) => {
    const u = new URL(p, "https://parkingpermits.lewisham.gov.uk/"), m = (opt.method || "GET").toUpperCase();
    calls.push({ m, path: u.pathname, body: opt.body || "", headers: opt.headers || {} });
    const r = routes[m + " " + u.pathname];
    if (!r) throw new Error("unexpected " + m + " " + u.pathname);
    const { body = "", json, url = u.href } = typeof r === "function" ? r(u, opt) : r;
    return { ok: true, status: 200, url, text: async () => body, json: async () => json };
  };
  P.GAP_MS = 0;
  return calls;
}

test("cancels with the popup's token", async () => {
  const calls = fakeFetch({
    "GET /Permit/CancelVoucherConfirmationPopup": { body: fs.readFileSync(path.join(__dirname, "fixtures", "cancel-popup.html"), "utf8") },
    "POST /Permit/CancelVisitorVoucher": { url: "https://parkingpermits.lewisham.gov.uk/Permit/Details?permitId=1" }
  });
  await P.cancelBooking("xd771d26b887ce0ee");
  const b = new URLSearchParams(calls[1].body);
  assert.strictEqual(b.get("__RequestVerificationToken"), "TEST-TOKEN");
  assert.ok(b.get("Id").startsWith("x"));
});

test("starting now skips the future-time check and flags activate-now", async () => {
  const form = fs.readFileSync(path.join(__dirname, "fixtures", "visitor-permit-form.html"), "utf8");
  const calls = fakeFetch({
    "GET /Permit/VisitorPermit": { body: form },
    "POST /Permit/GetNonEnforceableCoverage": { json: { Result: "Success" } },
    "POST /Permit/GetVisitorVoucherConfirmation": { body: "<div>AB12CDE</div>" },
    "POST /Permit/VisitorPermit": { url: "https://parkingpermits.lewisham.gov.uk/Permit/Details?permitId=1" }
  });
  const r = await P.bookOne({ permitId: "x80b66f1c3b5e7742", voucher: { permitVehicleId: "x1", type: "h1" }, act: { dk: "2026-09-28", start: 625, type: "h1" }, vehicle: { vrn: "AB12CDE" }, activateNow: true, testMode: false });
  assert.deepStrictEqual(r, { booked: true });
  assert.ok(!calls.some((c) => c.path === "/Permit/VerifyDateTimeOfVisitorVoucher"));
  const b = new URLSearchParams(calls.at(-1).body);
  assert.strictEqual(b.get("visitorPermit[IsActivateNow]"), "true");
  assert.strictEqual(b.get("visitorPermit[VrnNumber]"), "AB12CDE");
  assert.strictEqual(calls.at(-1).headers["X-Requested-With"], "XMLHttpRequest");
});

test("refuses to book when the confirmation shows another plate", async () => {
  fakeFetch({
    "GET /Permit/VisitorPermit": { body: fs.readFileSync(path.join(__dirname, "fixtures", "visitor-permit-form.html"), "utf8") },
    "POST /Permit/GetNonEnforceableCoverage": { json: { Result: "Success" } },
    "GET /Permit/VerifyDateTimeOfVisitorVoucher": { json: { Message: "" } },
    "POST /Permit/GetVisitorVoucherConfirmation": { body: "<div>ZZ99ZZZ 30/09/2026</div>" }
  });
  await assert.rejects(P.bookOne({ permitId: "p", voucher: { permitVehicleId: "x1", type: "h1" }, act: { dk: "2026-09-30", start: 600, type: "h1" }, vehicle: { vrn: "AB12CDE" }, testMode: false }), /different number plate/);
});
