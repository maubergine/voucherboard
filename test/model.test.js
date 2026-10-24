// The model's permit helpers: zones, which permits to use, where the plan is kept, and naming a booking's permits.
const test = require("node:test");
const assert = require("node:assert");
require("../extension/src/zones.js"); require("../extension/src/planner.js"); require("../extension/src/portal.js"); require("../extension/src/model.js");
const M = globalThis.VB.model;

const permit = (id, ref, zoneName) => ({ id, ref, zoneName, type: "Visitor Permits", status: "Active" });
const A = permit("a", "LV-1", "P - Hither Green East"), B = permit("b", "LV-2", "P - Hither Green East"), C = permit("c", "LV-3", "V - Lee");

test("groups permits by zone, in the council's order", () => {
  assert.deepStrictEqual(M.zoneGroups([A, C, B]).map((g) => [g.code, g.name, g.permits.map((p) => p.id)]), [["P", "Hither Green East", ["a", "b"]], ["V", "Lee", ["c"]]]);
});

test("uses every permit in a zone unless turned off, and keeps at least one", () => {
  const ids = (s) => M.pickPermits([A, B, C], s.saved, s.legacy).ids;
  assert.deepStrictEqual(ids({}), ["a", "b"], "the first zone, all of it");
  assert.deepStrictEqual(ids({ legacy: "c" }), ["c"], "an older saved permit picks its zone");
  assert.deepStrictEqual(ids({ legacy: "b" }), ["a", "b"]);
  assert.deepStrictEqual(ids({ saved: { zone: "P", off: ["a"] } }), ["b"]);
  assert.deepStrictEqual(ids({ saved: { zone: "P", off: ["a", "b"] } }), ["a", "b"], "never none");
  assert.deepStrictEqual(ids({ saved: { zone: "Q", off: [] }, legacy: "c" }), ["c"], "a zone that's gone falls back");
  assert.deepStrictEqual(M.pickPermits([], null, null), { zone: null, ids: [], group: null });
});

test("a zone with several permits shares one plan; a lone permit keeps its own", async () => {
  const many = M.pickPermits([A, B], null, null), one = M.pickPermits([A, C], null, null);
  assert.strictEqual(M.planKey(many), "vb:plan:zone:P");
  assert.strictEqual(M.planKey(one), "vb:plan:a");
  const store = { "vb:plan:a": [{ id: 1 }], "vb:plan:b": [{ id: 2 }] }, get = async (k, d) => (k in store ? store[k] : d);
  assert.deepStrictEqual(await M.readPlan(get, many), [{ id: 1 }, { id: 2 }], "first read joins the permits' plans");
  store["vb:plan:zone:P"] = [];
  assert.deepStrictEqual(await M.readPlan(get, many), [], "then the zone's own, even when empty");
  assert.deepStrictEqual(await M.readPlan(get, one), [{ id: 1 }]);
  assert.strictEqual(await M.readSubzone(async (k) => ({ "vb:subzone:b": "B2" })[k] || null, ["a", "b"]), "B2");
});

test("names the permits a booking used, and drops planned changes to permits turned off", () => {
  const ref = (id) => ({ a: "LV-1", b: "LV-2", c: "LV-3" })[id];
  assert.strictEqual(M.permitsText([{ permitId: "a" }, { permitId: "a" }], ref), "LV-1");
  assert.strictEqual(M.permitsText([{ permitId: "a" }, { permitId: "b" }, { permitId: "c" }], ref), "LV-1, LV-2 and LV-3");
  const bookings = [{ id: "x1", permitId: "a" }, { id: "x2", permitId: "b" }];
  const r = M.dropChangesOff([{ id: 1, replaces: ["x2"] }, { id: 2, replaces: ["x1"] }, { id: 3 }], bookings, ["a"]);
  assert.deepStrictEqual([r.kept.map((e) => e.id), r.dropped], [[2, 3], 1]);
  assert.strictEqual(M.balanceShort({ h1: 2, h5: 0, day: 1, week: 1 }), "2 × 1 hour, 1 × 1 day, 1 × 1 week");
});

test("orders permits oldest first: by apply date, then reference, unknown dates last", () => {
  const ids = (list) => [...list].sort(M.byAge).map((p) => p.id);
  assert.deepStrictEqual(ids([{ id: "new", ref: "LV-1", applied: "2026-09-02" }, { id: "old", ref: "LV-2", applied: "2026-07-11" }]), ["old", "new"]);
  assert.deepStrictEqual(ids([{ id: "b", ref: "LV-10", applied: "2026-07-11" }, { id: "a", ref: "LV-9", applied: "2026-07-11" }]), ["a", "b"], "same day: by reference, as numbers");
  assert.deepStrictEqual(ids([{ id: "x", ref: "LV-1", applied: null }, { id: "y", ref: "LV-2", applied: "2026-01-01" }]), ["y", "x"]);
});

test("remembers apply dates, and orders a zone's permits by them", () => {
  assert.deepStrictEqual(M.addAges({ a: "2026-07-11" }, [{ id: "a", applied: "2026-07-11" }]), null, "nothing new");
  const ages = M.addAges({ a: "2026-07-11" }, [{ id: "b", applied: "2026-01-01" }, { id: "c", applied: null }]);
  assert.deepStrictEqual(ages, { a: "2026-07-11", b: "2026-01-01" });
  assert.deepStrictEqual(M.orderPermits([A, B, C], ages).map((p) => p.id), ["b", "a", "c"]);
});
