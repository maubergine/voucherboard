const test = require("node:test");
const assert = require("node:assert");
const Z = require("../src/zones.js");
require("../src/planner.js");
const R = require("../src/reminders.js");

const today = new Date(2026, 8, 28); // Monday
const zoneP = Z.findZone("P - Hither Green East"); // Mon–Fri 10:00–12:00
const bk = (id, vrn, date, start, mins = 60) => ({ id, vrn, date, start, mins, cancellable: true });
const vehicles = [{ vrn: "VW55XYZ", nick: "Blair Visitor", fav: true }, { vrn: "TU44VWX", nick: "TU44VWX", fav: false }];
const ctx = (over) => ({ today, now: 10 * 60 + 30, zone: zoneP, bookings: [], vehicles, lead: 15, ...over });

test("joins back-to-back bookings into one visit", () => {
  const v = R.visits([bk("b", "A1", "2026-09-30", 660), bk("a", "A1", "2026-09-30", 600), bk("c", "A1", "2026-09-30", 780)]);
  assert.deepStrictEqual(v.map((x) => [x.start, x.end, x.ids.join()]), [[600, 720, "a,b"], [780, 840, "c"]]);
});

test("reminds before a visit ends when controls carry on, with an Extend action", () => {
  const [n, ...rest] = R.schedule(ctx({ bookings: [bk("x1", "VW55XYZ", "2026-09-30", 600)] }));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(n.title, "VW55 XYZ: voucher ends at 11:00");
  assert.strictEqual(n.body, "Blair Visitor. Controls run until 12:00.");
  assert.strictEqual(new Date(n.at).getTime(), new Date(2026, 8, 30, 10, 45).getTime());
  assert.deepStrictEqual(n.actions, [{ id: "extend", title: "Extend 1 hour" }]);
  assert.deepStrictEqual(n.data, { vrn: "VW55XYZ", dk: "2026-09-30", end: 660 });
});

test("skips visits that end with the controls, have finished, or whose reminder time has passed", () => {
  const list = R.schedule(ctx({ bookings: [
    bk("a", "TU44VWX", "2026-09-28", 600), bk("b", "TU44VWX", "2026-09-28", 660), // ends 12:00, as controls do
    bk("c", "VW55XYZ", "2026-09-28", 540, 60), // 09:00–10:00, already over
    bk("d", "GH78JKL", "2026-09-28", 600, 45) // ends 10:45, reminder at 10:30 = now
  ] }));
  assert.deepStrictEqual(list, []);
});

test("uses the plate when the vehicle isn't a favourite, and stays inside the booking window", () => {
  const list = R.schedule(ctx({ lead: 30, bookings: [bk("a", "TU44VWX", "2026-10-01", 600), bk("z", "TU44VWX", "2026-11-30", 600)] }));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].body, "Controls run until 12:00.");
  assert.strictEqual(new Date(list[0].at).getTime(), new Date(2026, 9, 1, 10, 30).getTime());
});

test("reminds without knowing the hours when the zone is unknown", () => {
  const [n] = R.schedule(ctx({ zone: null, bookings: [bk("a", "VW55XYZ", "2026-09-29", 600)] }));
  assert.match(n.body, /Check the street signs/);
});
