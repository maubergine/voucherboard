const test = require("node:test");
const assert = require("node:assert");
const Z = require("../extension/src/zones.js");
const P = require("../extension/src/planner.js");

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
  const plan = P.allocate(ctx(), [entry(1, "AB12CDE", "2026-09-29", 8 * 60, 14 * 60)], { h1: 9 });
  assert.deepStrictEqual(plan.items[0].acts.map((a) => P.hm(a.start)), ["10:00", "11:00"]);
  assert.strictEqual(plan.count, 2);
  assert.ok(plan.items[0].notes.some((n) => /4 h outside controlled hours/.test(n.t)));
});

test("needs no voucher on a day without controls", () => {
  const plan = P.allocate(ctx(), [entry(1, "AB12CDE", "2026-10-03", 10 * 60, 12 * 60)], { h1: 9 });
  assert.strictEqual(plan.count, 0);
});

test("does not double-book hours already booked or planned", () => {
  const c = ctx({ bookings: [{ vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }] });
  const plan = P.allocate(c, [entry(1, "AB12CDE", "2026-09-29", 600, 720), entry(2, "AB12CDE", "2026-09-29", 600, 720)], { h1: 9 });
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
  const plan = P.allocate(ctx(), es, { h1: 0, h5: 2 });
  assert.strictEqual(plan.used.h5, 1);
  const adv = P.purchaseAdvice(ctx(), es, plan, { h1: 0, h5: 2 });
  assert.strictEqual(adv.buy.h1, 1);
  assert.strictEqual(Math.round(adv.saving * 100), 335);
});

test("prefers a 5-hour voucher over three 1-hour vouchers", () => {
  const plan = P.allocate(ctx({ zone: zoneT }), [entry(1, "AB12CDE", "2026-09-29", 9 * 60, 12 * 60)], { h1: 10, h5: 3, day: 2 });
  assert.deepStrictEqual(plan.used, { h1: 0, h5: 1, day: 0, week: 0 });
});

test("reports a shortfall", () => {
  const plan = P.allocate(ctx(), [entry(1, "AB12CDE", "2026-09-29", 600, 720)], { h1: 1 });
  assert.strictEqual(plan.short, 2);
  assert.strictEqual(plan.ready, false);
});

test("falls back to the site's check when the zone is unknown", () => {
  const plan = P.allocate(ctx({ zone: null }), [entry(1, "AB12CDE", "2026-10-03", 600, 660)], { h1: 9 });
  assert.strictEqual(plan.count, 1);
  assert.ok(plan.items[0].notes.some((n) => /hours aren't known/.test(n.t)));
});

test("gives no cost or advice when prices couldn't be read", () => {
  const es = [entry(1, "AB12CDE", "2026-09-29", 600, 660)];
  const c = ctx({ prices: null });
  const plan = P.allocate(c, es, { h1: 0, h5: 2 });
  assert.strictEqual(plan.cost, null);
  assert.strictEqual(plan.count, 1);
  assert.strictEqual(P.purchaseAdvice(c, es, plan, { h1: 0, h5: 2 }), null);
});

test("rounds purchase advice up to the pack size", () => {
  const es = [entry(1, "AB12CDE", "2026-09-29", 600, 660)];
  const c = ctx({ prices: { ...prices, h1: { price: 2.24, book: 10 } } });
  const plan = P.allocate(c, es, { h1: 0, h5: 2 });
  assert.strictEqual(P.purchaseAdvice(c, es, plan, { h1: 0, h5: 2 }).buy.h1, 10);
});

test("a longer change keeps the booked voucher and books only the extra hour", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 720), replaces: ["b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 1 });
  assert.deepStrictEqual(plan.items[0].acts.map((a) => P.hm(a.start)), ["11:00"]);
  assert.strictEqual(plan.cancels, 0);
  assert.deepStrictEqual(plan.items[0].replaces, []);
  assert.ok(plan.ready);
  assert.ok(plan.items[0].notes.some((n) => /Keeps the booking at 10:00–11:00/.test(n.t)));
});

test("a shorter change cancels only the voucher it no longer needs", () => {
  const bookings = [600, 660].map((start, i) => ({ id: "b" + i, vrn: "AB12CDE", date: "2026-09-29", start, mins: 60 }));
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 660), replaces: ["b0", "b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 });
  assert.deepStrictEqual(plan.items[0].acts, []);
  assert.deepStrictEqual(plan.items[0].replaces, ["b1"]);
  assert.strictEqual(plan.cancels, 1);
  assert.ok(plan.ready);
  assert.ok(plan.items[0].notes.some((n) => /Keeps 10:00 and cancels 11:00 first; its voucher goes back/.test(n.t)));
});

test("a moved change cancels the old voucher when keeping it would cost more", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 630, 690), replaces: ["b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 });
  assert.deepStrictEqual(plan.items[0].acts.map((a) => P.hm(a.start)), ["10:30"], "1 voucher, not the kept one plus 11:00");
  assert.strictEqual(plan.cancels, 1);
  assert.ok(plan.items[0].notes.some((n) => /Replaces the booking at 10:00–11:00/.test(n.t)));
});

test("a change keeps a booked voucher only when the best plan would book the same one again", () => {
  const bookings = [{ id: "b5", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 300 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 660), replaces: ["b5"] };
  const none = P.allocate(ctx({ bookings }), [e], { h1: 0 });
  assert.strictEqual(none.cancels, 0, "only the returned 5-hour voucher fits, so the same 10:00 voucher is kept");
  assert.deepStrictEqual(none.items[0].acts, []);
  assert.deepStrictEqual(none.kept, { h1: 0, h5: 1, day: 0, week: 0 });
  const adv = P.purchaseAdvice(ctx({ bookings }), [e], none, { h1: 0 });
  assert.deepStrictEqual(adv.buy, { h1: 1, h5: 0, day: 0, week: 0 });
  assert.ok(Math.abs(adv.saving - (5.59 - 2.24)) < 0.001);
  const one = P.allocate(ctx({ bookings }), [e], { h1: 1 });
  assert.strictEqual(one.cancels, 1, "a 1-hour voucher is cheaper, so the 5-hour one is cancelled");
  assert.deepStrictEqual(one.items[0].acts.map((a) => a.type), ["h1"]);
});

test("a longer change cancels a 1-hour voucher when one 5-hour voucher is cheaper", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 900), replaces: ["b1"] };
  const plan = P.allocate(ctx({ bookings, zone: null }), [e], { h1: 9, h5: 1 });
  assert.deepStrictEqual(plan.items[0].acts.map((a) => a.type + "@" + P.hm(a.start)), ["h5@10:00"]);
  assert.strictEqual(plan.cancels, 1);
});

test("a change reorders its vouchers to keep booked ones that start at the same time", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }, { id: "b5", vrn: "AB12CDE", date: "2026-09-29", start: 660, mins: 300 }];
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 1020), replaces: ["b1", "b5"] };
  const plan = P.allocate(ctx({ bookings, zone: null }), [e], { h1: 5 });
  assert.deepStrictEqual(plan.items[0].acts.map((a) => a.type + "@" + P.hm(a.start)), ["h1@16:00"], "1 + 5 kept, not rebooked as 5 + 1 + 1");
  assert.strictEqual(plan.cancels, 0);
  assert.deepStrictEqual(plan.kept, { h1: 1, h5: 1, day: 0, week: 0 });
});

test("a change keeps booked vouchers that already cover the new time when rebooking costs no less", () => {
  const bookings = [600, 660].map((start, i) => ({ id: "b" + i, vrn: "AB12CDE", date: "2026-09-29", start, mins: 60 }));
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 630, 720), replaces: ["b0", "b1"] };
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 });
  assert.deepStrictEqual(plan.items[0].acts, [], "not 10:30 and 11:30 again");
  assert.strictEqual(plan.cancels, 0);
  assert.ok(plan.items[0].notes.some((n) => /Keeps the booking at 10:00–12:00/.test(n.t)));
  // a later time that one fewer voucher covers still rebooks
  const later = { ...entry(1, "AB12CDE", "2026-09-29", 630, 690), replaces: ["b0", "b1"] };
  const p2 = P.allocate(ctx({ bookings }), [later], { h1: 0 });
  assert.deepStrictEqual(p2.items[0].acts.map((a) => P.hm(a.start)), ["10:30"]);
  assert.strictEqual(p2.cancels, 2);
});

test("a change to a time needing no voucher still counts as ready: it cancels", () => {
  const bookings = [{ id: "b1", vrn: "AB12CDE", date: "2026-09-29", start: 600, mins: 60 }];
  const plan = P.allocate(ctx({ bookings }), [{ ...entry(1, "AB12CDE", "2026-09-29", 780, 840), replaces: ["b1"] }], { h1: 0 });
  assert.strictEqual(plan.count, 0);
  assert.strictEqual(plan.cancels, 1);
  assert.ok(plan.ready);
});

test("returned vouchers count before suggesting a purchase", () => {
  const bookings = [0, 1, 2, 3, 4].map((i) => ({ id: "b" + i, vrn: "AB12CDE", date: "2026-09-29", start: 600 + i * 60, mins: 60 }));
  const e = { ...entry(1, "AB12CDE", "2026-09-29", 600, 660), replaces: bookings.map((b) => b.id) };
  const bal = P.effectiveBalance(ctx({ bookings }), [e], { h1: 0 });
  assert.strictEqual(bal.h1, 5);
  const plan = P.allocate(ctx({ bookings }), [e], { h1: 0 });
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

// As the live site shows them: a day voucher from 27 Oct 10:00 runs to 28 Oct 09:59, a week voucher 7 days.
const day = { id: "d", vrn: "TU44VWX", date: "2026-10-27", start: 600, mins: 1440 };
const week = { id: "w", vrn: "TU44VWX", date: "2026-11-02", start: 600, mins: 7 * 1440 };

test("tells a booking's type from its length", () => {
  assert.deepStrictEqual([60, 300, 1440, 7 * 1440].map((mins) => P.bookingType({ mins })), ["h1", "h5", "day", "week"]);
});

test("cuts day and week bookings into each day they cover", () => {
  assert.deepStrictEqual(P.bookingsOn([day], "2026-10-27").map((b) => [b.start, b.mins, b.type]), [[600, 840, "day"]]);
  assert.deepStrictEqual(P.bookingsOn([day], "2026-10-28").map((b) => [b.start, b.mins, b.from]), [[0, 600, "2026-10-27"]]);
  assert.deepStrictEqual(P.bookingsOn([day], "2026-10-29"), []);
  assert.deepStrictEqual(["2026-11-01", "2026-11-02", "2026-11-05", "2026-11-09", "2026-11-10"].map((dk) => P.bookingsOn([week], dk).map((b) => [b.start, b.mins])),
    [[], [[600, 840]], [[0, 1440]], [[0, 600]], []]);
});

test("a booking that started on an earlier day is still in progress", () => {
  const t = new Date(2026, 10, 5);
  assert.strictEqual(P.status(t, 300, week.date, week.start, week.start + week.mins), "live");
  assert.strictEqual(P.status(new Date(2026, 10, 9), 600, week.date, week.start, week.start + week.mins), "past");
  assert.strictEqual(P.status(new Date(2026, 10, 1), 1439, week.date, week.start, week.start + week.mins), "up");
});

test("plans nothing for time a day or week booking already covers, on any of its days", () => {
  const c = ctx({ zone: zoneT, today: new Date(2026, 9, 24), now: 500, bookings: [{ ...day, start: 720 }, week] });
  const plan = P.allocate(c, [entry(1, "TU44VWX", "2026-10-28", 9 * 60, 12 * 60), entry(2, "TU44VWX", "2026-11-05", 9 * 60, 19 * 60), entry(3, "TU44VWX", "2026-11-09", 9 * 60, 11 * 60)], { h1: 9, day: 1 });
  assert.strictEqual(plan.count, 1);
  assert.deepStrictEqual(plan.items.map((it) => it.acts.map((a) => a.type + " " + P.hm(a.start))), [[], [], ["h1 10:00"]]);
});

test("a planned day voucher runs into the next morning", () => {
  const c = ctx({ zone: zoneT, today: new Date(2026, 9, 24), now: 500 });
  const plan = P.allocate(c, [entry(1, "TU44VWX", "2026-10-26", 12 * 60, 19 * 60), entry(2, "TU44VWX", "2026-10-27", 9 * 60, 11 * 60)], { h1: 0, day: 1 });
  assert.deepStrictEqual(plan.items.map((it) => it.acts.map((a) => a.type + " " + P.hm(a.start))), [["day 12:00"], []]);
  assert.ok(plan.items[0].notes.some((n) => n.t === "The day voucher runs until 12:00 the next day."));
  assert.ok(plan.ready);
});

// The live site refused a week voucher at 09:21 in zone P ("during non-enforcement hours"): every voucher, whatever its
// length, has to start while controls apply.
test("5-hour and day vouchers start at the first controlled minute, not at the visit's start", () => {
  const c = ctx({ today: new Date(2026, 9, 24), now: 500 }), e = [entry(1, "TU44VWX", "2026-11-02", 8 * 60, 20 * 60)];
  assert.deepStrictEqual(P.allocate(c, e, { day: 1 }).items[0].acts, [{ type: "day", start: 600 }]);
  assert.deepStrictEqual(P.allocate(c, e, { h5: 1 }).items[0].acts, [{ type: "h5", start: 600 }]);
});

test("no voucher of any length is planned to start outside controlled hours", () => {
  const zones = ["P - Hither Green East", "T - Ladywell", "S - Deptford Central", "B2"].map((n) => Z.findZone(n) || Z.ZONES.find((z) => z.code === n));
  const days = ["2026-10-31", "2026-11-01", "2026-11-02"]; // Sat, Sun, Mon
  const booked = [{ id: "b", vrn: "TU44VWX", date: "2026-11-02", start: 660, mins: 60 }, { id: "d", vrn: "TU44VWX", date: "2026-10-31", start: 720, mins: 1440 }];
  let n = 0;
  for (const zone of zones) for (const bal of [{ h5: 9 }, { day: 9 }, { h1: 9, h5: 9, day: 9 }]) {
    const list = [];
    for (const dk of days) for (let f = 0; f < 1440; f += 90) for (const len of [30, 120, 330, 900]) list.push(entry(list.length, "TU44VWX", dk, f, Math.min(P.LAST_MIN, f + len)));
    const c = ctx({ zone, today: new Date(2026, 9, 24), now: 0, bookings: booked });
    for (const e of list) for (const it of P.allocate(c, [e], bal).items) for (const a of it.acts) {
      n++;
      assert.ok(P.inControls(zone, it.dk, a.start), `${zone.code} ${it.dk} ${a.type} at ${P.hm(a.start)} for ${P.hm(e.from)}–${P.hm(e.to)}`);
    }
  }
  assert.ok(n > 500);
});

test("a chosen voucher type is the only one used, and a week voucher covers the next 7 days", () => {
  const c = ctx({ today: new Date(2026, 9, 24), now: 0 }), bal = { h1: 9, h5: 9, day: 9, week: 1 };
  const kinded = (kind, from = 600, to = 720, dk = "2026-10-26") => ({ ...entry(1, "TU44VWX", dk, from, to), kind });
  const acts = (list, b = bal) => P.allocate(c, list, b).items.map((it) => it.acts.map((a) => a.type + " " + P.hm(a.start)));
  assert.deepStrictEqual(acts([kinded("h5")]), [["h5 10:00"]]);
  assert.deepStrictEqual(acts([kinded("day", 480, 720)]), [["day 10:00"]], "starts at the first controlled minute");
  assert.deepStrictEqual(acts([kinded("h1")]), [["h1 10:00", "h1 11:00"]]);
  const wk = P.allocate(c, [kinded("week"), { ...entry(2, "TU44VWX", "2026-10-30", 600, 720) }, { ...entry(3, "TU44VWX", "2026-11-02", 600, 720) }], bal);
  assert.deepStrictEqual(wk.items.map((it) => it.acts.map((a) => a.type + " " + P.hm(a.start))), [["week 10:00"], [], ["h1 10:00", "h1 11:00"]], "Fri is covered; the next Mon from 10:00 isn't");
  assert.deepStrictEqual(wk.used, { h1: 2, h5: 0, day: 0, week: 1 });
  const none = P.allocate(c, [kinded("week")], { h1: 9 });
  assert.deepStrictEqual([none.items[0].acts, none.short, none.items[0].notes.at(-1).t], [[], 1, "Not enough vouchers left (needs 1 × 1 week)."]);
  assert.strictEqual(P.candidates(c, { vrns: ["A"], days: ["2026-10-26"], from: 600, to: 720, kind: "week" }, [])[0].kind, "week");
});

// Across days, in zone T (Mon–Fri 09:00–19:00) at the council's prices: 1 hour £2.24, 5 hours £5.59, day £8.69, week £37.25.
const across = (list, bal = { h1: 50, h5: 50, day: 20, week: 5 }, over = {}) => {
  const p = P.allocate(ctx({ zone: zoneT, today: new Date(2026, 9, 24), now: 0, prices: { ...prices, week: { price: 37.25, book: 1 } }, ...over }), list, bal);
  return { p, acts: p.items.map((it) => it.acts.map((a) => a.type + " " + P.hm(a.start)).join(", ")), cost: p.cost.toFixed(2) };
};
const days = (dks, f = 9, t = 19) => dks.map((dk, i) => entry(i + 1, "AB12CDE", dk, f * 60, t * 60));

test("one day voucher covers the end of one day's controls and the start of the next, when that's cheaper", () => {
  const r = across([entry(1, "AB12CDE", "2026-10-26", 13 * 60, 19 * 60), entry(2, "AB12CDE", "2026-10-27", 9 * 60, 13 * 60)]);
  assert.deepStrictEqual([r.acts, r.cost], [["day 13:00", ""], "8.69"], "not 5 h + 1 h, then 5 h (£13.42)");
  assert.ok(r.p.items[1].notes.some((n) => /already covered by another planned booking/.test(n.t)));
});

test("one week voucher instead of a day voucher each day, including over a weekend", () => {
  assert.deepStrictEqual(across(days(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"])).acts, ["week 09:00", "", "", "", ""]);
  const r = across(days(["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"]));
  assert.deepStrictEqual([r.acts, r.cost], [["week 09:00", "", "", "", ""], "37.25"], "Thu 09:00 to the next Thu 09:00, not 5 days (£43.45)");
});

test("across days it only uses the day and week vouchers left, and falls back to each day's cheapest", () => {
  const wk = days(["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.deepStrictEqual(across(wk, { h1: 50, h5: 50, day: 20 }).acts, ["day 09:00", "day 09:00", "day 09:00", "day 09:00", "day 09:00"]);
  const two = across(wk, { h1: 50, h5: 50, day: 2 });
  assert.deepStrictEqual([two.p.used, two.cost], [{ h1: 0, h5: 6, day: 2, week: 0 }, "50.92"], "the 2 day vouchers held, then 5 hours twice a day");
  const pair = [entry(1, "AB12CDE", "2026-10-26", 13 * 60, 19 * 60), entry(2, "AB12CDE", "2026-10-27", 9 * 60, 13 * 60)];
  assert.deepStrictEqual(across(pair, { h1: 50, h5: 50 }).acts, ["h5 13:00, h1 18:00", "h5 09:00"]);
});

test("buying a week voucher is suggested when it's cheaper across days", () => {
  const list = days(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]), c = ctx({ zone: zoneT, today: new Date(2026, 9, 24), now: 0, prices: { ...prices, week: { price: 37.25, book: 1 } } });
  const adv = P.purchaseAdvice(c, list, P.allocate(c, list, { h1: 0, h5: 10 }), { h1: 0, h5: 10 });
  assert.deepStrictEqual(adv.buy, { h1: 0, h5: 0, day: 0, week: 1 });
  assert.strictEqual(adv.idealCost, 37.25);
});

test("across days, vouchers still start in controlled hours and booked time isn't paid for twice", () => {
  const booked = [{ id: "b", vrn: "AB12CDE", date: "2026-10-26", start: 540, mins: 600 }]; // Mon covered by a booking
  const r = across(days(["2026-10-26", "2026-10-27"], 7, 21), undefined, { bookings: booked });
  assert.deepStrictEqual(r.acts, ["", "day 09:00"]);
  const late = across([entry(1, "AB12CDE", "2026-10-30", 17 * 60, 23 * 60), entry(2, "AB12CDE", "2026-11-02", 6 * 60, 15 * 60)]);
  assert.deepStrictEqual(late.acts, ["h1 17:00, h1 18:00", "h5 09:00, h1 14:00"], "a Friday-evening day voucher would end Saturday, before Monday's controls");
});

test("across days, no voucher is planned to start outside controlled hours", () => {
  let seed = 7, n = 0;
  const rnd = (k) => { seed = (seed * 16807) % 2147483647; return seed % k; };
  for (const code of ["P", "T", "S", "B2"]) {
    const zone = Z.ZONES.find((z) => z.code === code);
    for (let run = 0; run < 40; run++) {
      const list = [...Array(1 + rnd(8))].map((_, i) => { const f = rnd(1380); return entry(i, "AB12CDE", P.key(new Date(2026, 9, 25 + rnd(14))), f, Math.min(P.LAST_MIN, f + 30 + rnd(900))); });
      const p = P.allocate(ctx({ zone, today: new Date(2026, 9, 24), now: 0, prices: { ...prices, week: { price: 37.25, book: 1 } } }), list, { h1: 99, h5: 99, day: 99, week: 9 });
      for (const it of p.items) for (const a of it.acts) { n++; assert.ok(P.inControls(zone, it.dk, a.start), `${code} ${it.dk} ${a.type} at ${P.hm(a.start)}`); }
    }
  }
  assert.ok(n > 200);
});
