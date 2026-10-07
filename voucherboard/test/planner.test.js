const test = require("node:test");
const assert = require("node:assert");
const Z = require("../src/zones.js");
const P = require("../src/planner.js");

const today = new Date(2026, 8, 28); // Monday
const zoneP = Z.findZone("P - Hither Green East");
const zoneT = Z.findZone("T - Ladywell");
const prices = { h1: { price: 2.24, book: 1 }, h5: { price: 5.59, book: 1 }, day: { price: 8.69, book: 1 } };
const ctx = (over) => ({ zone: zoneP, today, now: 10 * 60 + 25, bookings: [], prices, ...over });
const entry = (id, vrn, dk, from, to) => ({ id, vrn, dk, from, to });

test("finds zones by the portal's zone name", () => {
  assert.strictEqual(zoneP.code, "P");
  assert.strictEqual(Z.findZone("Q - Nowhere"), null);
});

test("zone B has subzones B1 and B2, with different Sunday hours", () => {
  assert.strictEqual(Z.findZone("B - Lewisham Central"), null);
  assert.deepStrictEqual(Z.subzones("B - Lewisham Central").map((z) => z.code), ["B1", "B2"]);
  assert.deepStrictEqual(Z.subzones("P - Hither Green East"), []);
  const [b1, b2] = Z.subzones("B - Lewisham Central"), sun = new Date(2026, 9, 4);
  assert.deepStrictEqual(P.controls(b1, sun), []);
  assert.deepStrictEqual(P.controls(b2, sun), [{ f: 9 * 60, t: 13 * 60 + 30 }]);
});

test("skips hours outside controls and books consecutive hours", () => {
  const plan = P.allocate(ctx(), [entry(1, "AB12CDE", "2026-09-29", 8 * 60, 14 * 60)], { h1: 9 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts.map((a) => P.hm(a.start)), ["10:00", "11:00"]);
  assert.strictEqual(plan.count, 2);
  assert.ok(plan.items[0].notes.some((n) => /4 h outside controlled hours/.test(n.t)));
});

test("needs no voucher on a day without controls", () => {
  const plan = P.allocate(ctx(), [entry(1, "AB12CDE", "2026-10-03", 10 * 60, 12 * 60)], { h1: 9 }, "cheapest");
  assert.strictEqual(plan.count, 0);
});

test("does not double-book hours already booked or planned", () => {
  const c = ctx({ bookings: [{ vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }] });
  const plan = P.allocate(c, [entry(1, "AB12CDE", "2026-09-29", 600, 720), entry(2, "AB12CDE", "2026-09-29", 600, 720)], { h1: 9 }, "cheapest");
  assert.strictEqual(plan.count, 1);
});

test("never plans today's start before the current minute", () => {
  const cands = P.candidates(ctx(), { vrns: ["AB12CDE"], days: ["2026-09-28"], from: 600, to: 660 }, []);
  assert.strictEqual(cands[0].from, 625);
  assert.strictEqual(cands[0].to, 685);
  const moved = P.advanceEntries(ctx({ now: 700 }), [entry(1, "AB12CDE", "2026-09-28", 625, 685)]);
  assert.deepStrictEqual([moved[0].from, moved[0].to], [700, 760]);
});

test("uses the cheapest mix and flags a saving when only 5-hour vouchers are held", () => {
  const es = [entry(1, "AB12CDE", "2026-09-29", 600, 660)];
  const plan = P.allocate(ctx(), es, { h1: 0, h5: 2 }, "cheapest");
  assert.strictEqual(plan.used.h5, 1);
  const adv = P.purchaseAdvice(ctx(), es, plan, { h1: 0, h5: 2 });
  assert.strictEqual(adv.buy.h1, 1);
  assert.strictEqual(Math.round(adv.saving * 100), 335);
});

test("prefers a 5-hour voucher over three 1-hour vouchers", () => {
  const plan = P.allocate(ctx({ zone: zoneT }), [entry(1, "AB12CDE", "2026-09-29", 9 * 60, 12 * 60)], { h1: 10, h5: 3, day: 2 }, "cheapest");
  assert.deepStrictEqual(plan.used, { h1: 0, h5: 1, day: 0 });
});

test("reports a shortfall", () => {
  const plan = P.allocate(ctx(), [entry(1, "AB12CDE", "2026-09-29", 600, 720)], { h1: 1 }, "cheapest");
  assert.strictEqual(plan.short, 2);
  assert.strictEqual(plan.ready, false);
});

test("falls back to the site's check when the zone is unknown", () => {
  const plan = P.allocate(ctx({ zone: null }), [entry(1, "AB12CDE", "2026-10-03", 600, 660)], { h1: 9 }, "cheapest");
  assert.strictEqual(plan.count, 1);
  assert.ok(plan.items[0].notes.some((n) => /hours aren't known/.test(n.t)));
});

test("gives no cost or advice when prices couldn't be read", () => {
  const es = [entry(1, "AB12CDE", "2026-09-29", 600, 660)];
  const c = ctx({ prices: null });
  const plan = P.allocate(c, es, { h1: 0, h5: 2 }, "cheapest");
  assert.strictEqual(plan.cost, null);
  assert.strictEqual(plan.count, 1);
  assert.strictEqual(P.purchaseAdvice(c, es, plan, { h1: 0, h5: 2 }), null);
});

test("rounds purchase advice up to the pack size", () => {
  const es = [entry(1, "AB12CDE", "2026-09-29", 600, 660)];
  const c = ctx({ prices: { ...prices, h1: { price: 2.24, book: 10 } } });
  const plan = P.allocate(c, es, { h1: 0, h5: 2 }, "cheapest");
  assert.strictEqual(P.purchaseAdvice(c, es, plan, { h1: 0, h5: 2 }).buy.h1, 10);
});

test("a longer change keeps the booked voucher and books only the extra hour", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 720), replaces: ["b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 1 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts.map((a) => P.hm(a.start)), ["11:00"]);
  assert.strictEqual(plan.cancels, 0);
  assert.deepStrictEqual(plan.items[0].replaces, []);
  assert.ok(plan.ready);
  assert.ok(plan.items[0].notes.some((n) => /Keeps the booking at 10:00–11:00/.test(n.t)));
});

test("a shorter change cancels only the voucher it no longer needs", () => {
  const bookings = [600, 660].map((start, i) => ({ id: "b" + i, vrn: "AB12CDE", date: "2026-09-29", start, mins: 60 }));
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 660), replaces: ["b0", "b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts, []);
  assert.deepStrictEqual(plan.items[0].replaces, ["b1"]);
  assert.strictEqual(plan.cancels, 1);
  assert.ok(plan.ready);
  assert.ok(plan.items[0].notes.some((n) => /Keeps 10:00 and cancels 11:00 first; its voucher goes back/.test(n.t)));
});

test("a moved change cancels the old voucher when keeping it would cost more", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 630, 690), replaces: ["b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts.map((a) => P.hm(a.start)), ["10:30"], "1 voucher, not the kept one plus 11:00");
  assert.strictEqual(plan.cancels, 1);
  assert.ok(plan.items[0].notes.some((n) => /Replaces the booking at 10:00–11:00/.test(n.t)));
});

test("a change keeps a booked voucher only when the best plan would book the same one again", () => {
  const bookings = [{ id: "b5", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 300 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 660), replaces: ["b5"] };
  const none = P.allocate(ctx({ bookings }), [e], { h1: 0 }, "cheapest");
  assert.strictEqual(none.cancels, 0, "only the returned 5-hour voucher fits, so the same 10:00 voucher is kept");
  assert.deepStrictEqual(none.items[0].acts, []);
  assert.deepStrictEqual(none.kept, { h1: 0, h5: 1, day: 0 });
  const adv = P.purchaseAdvice(ctx({ bookings }), [e], none, { h1: 0 });
  assert.deepStrictEqual(adv.buy, { h1: 1, h5: 0, day: 0 });
  assert.ok(Math.abs(adv.saving - (5.59 - 2.24)) < 0.001);
  const one = P.allocate(ctx({ bookings }), [e], { h1: 1 }, "cheapest");
  assert.strictEqual(one.cancels, 1, "a 1-hour voucher is cheaper, so the 5-hour one is cancelled");
  assert.deepStrictEqual(one.items[0].acts.map((a) => a.type), ["h1"]);
});

test("a longer change cancels a 1-hour voucher when one 5-hour voucher is cheaper", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 900), replaces: ["b1"] };
  const plan = P.allocate(ctx({ bookings, zone: null }), [e], { h1: 9, h5: 1 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts.map((a) => a.type + "@" + P.hm(a.start)), ["h5@10:00"]);
  assert.strictEqual(plan.cancels, 1);
});

test("a change reorders its vouchers to keep booked ones that start at the same time", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }, { id: "b5", vrn: "AB12CDE", date: "2026-09-29", start: 660, mins: 300 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 1020), replaces: ["b1", "b5"] };
  const plan = P.allocate(ctx({ bookings, zone: null }), [e], { h1: 5 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts.map((a) => a.type + "@" + P.hm(a.start)), ["h1@16:00"], "1 + 5 kept, not rebooked as 5 + 1 + 1");
  assert.strictEqual(plan.cancels, 0);
  assert.deepStrictEqual(plan.kept, { h1: 1, h5: 1, day: 0 });
});

test("a change keeps booked vouchers that already cover the new time when rebooking costs no less", () => {
  const bookings = [600, 660].map((start, i) => ({ id: "b" + i, vrn: "AB12CDE", date: "2026-09-29", start, mins: 60 }));
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 630, 720), replaces: ["b0", "b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 }, "cheapest");
  assert.deepStrictEqual(plan.items[0].acts, [], "not 10:30 and 11:30 again");
  assert.strictEqual(plan.cancels, 0);
  assert.ok(plan.items[0].notes.some((n) => /Keeps the booking at 10:00–12:00/.test(n.t)));
  // a later time that one fewer voucher covers still rebooks
  const later = { ...entry(1, "AB12CDE", "2026-09-29", 630, 690), replaces: ["b0", "b1"] };
  const p2 = P.allocate(ctx({ bookings }), [later], { h1: 0 }, "cheapest");
  assert.deepStrictEqual(p2.items[0].acts.map((a) => P.hm(a.start)), ["10:30"]);
  assert.strictEqual(p2.cancels, 2);
});

test("a change to a time needing no voucher still counts as ready: it cancels", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const plan = P.allocate(ctx({ bookings }), [{ ...entry(1, "AB12CDE", "2026-09-29", 780, 840), replaces: ["b1"] }], { h1: 0 }, "cheapest");
  assert.strictEqual(plan.count, 0);
  assert.strictEqual(plan.cancels, 1);
  assert.ok(plan.ready);
});

test("returned vouchers count before suggesting a purchase", () => {
  const bookings = [0, 1, 2, 3, 4].map((i) => ({ id: "b" + i, vrn: "AB12CDE", date: "2026-09-29", start: 600 + i * 60, mins: 60 }));
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 660), replaces: bookings.map((b) => b.id) };
  const bal = P.effectiveBalance(ctx({ bookings }), [e], { h1: 0 });
  assert.strictEqual(bal.h1, 5);
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 }, "cheapest");
  assert.strictEqual(P.purchaseAdvice(ctx({ bookings }), [e], plan, { h1: 0 }), null, "the returned 1-hour vouchers are enough");
});

test("a booking in progress can only end when one of its vouchers ends", () => {
  const b = (id, start, cancellable) => ({ id, start, mins: 60, cancellable });
  const items = [b("a", 600, false), b("b", 660, true), b("c", 720, true)];
  assert.deepStrictEqual(P.shrinkOptions(items, 630), [{ end: 720, cancel: ["c"] }, { end: 660, cancel: ["b", "c"] }]);
  assert.deepStrictEqual(P.shrinkOptions(items, 670), [{ end: 720, cancel: ["c"] }], "the running voucher stays");
  assert.deepStrictEqual(P.shrinkOptions([b("a", 600, false), b("b", 660, false)], 630), [], "not if the site won't cancel");
  assert.deepStrictEqual(P.shrinkOptions(items, 590), [], "not started: use change time instead");
});
