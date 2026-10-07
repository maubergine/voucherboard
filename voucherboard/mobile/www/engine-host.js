// Lets native screens drive the engine (iOS SwiftUI; see mobile/BRIDGE.md, "Engine API"). Native calls
// VBEngine.call(name, args) and gets JSON back; engine events go to native as VBNative.call("engine.event", ...).
(function (root) {
  "use strict";
  const E = root.VB.engine, V = root.VB.views, N = root.VBNative;
  const json = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));

  // Every name native may call. Views read; the rest change something and return { toast, undo, err } or similar.
  const API = {
    // views
    home: () => V.home(), today: () => V.today(), calendar: (a) => V.calendar(a.dk), agenda: (a) => V.agenda(a.dk), day: (a) => V.day(a.dk),
    board: (a) => V.board(a.zoom || "week", a.dk), vehicles: (a) => V.vehicles(a.q), vehicle: (a) => V.vehicle(a.vrn), suggest: (a) => V.suggest(a.text, a.exclude),
    plan: () => V.plan(), entry: (a) => V.entry(a.id), visit: (a) => V.visit(a.key), bulk: (a) => V.bulk(a.keys || []), list: (a) => V.list(a), bulkTimes: (a) => V.bulkTimes(a.keys || [], a), run: () => V.run(), more: () => V.more(), terms: () => V.terms(),
    // quick-book: the form travels back and forth as q
    quickInit: (a) => V.quick(E.quickInit(a.opts || {})), quickExtend: (a) => V.quick(E.quickExtend(a.vrn, a.dk, +a.end)), quickView: (a) => V.quick(a.q),
    quickWhen: (a) => V.quick(E.quickWhen(a.q, a.when)), quickPreset: (a) => V.quick(E.quickApplyPreset(a.q, a.preset)), quickTime: (a) => V.quick(E.quickTime(a.q, a.which, a.min)),
    quickPickDays: (a) => V.quick(E.quickPickDays(a.q, a.id)), quickToggleDay: (a) => V.quick(E.quickToggleDay(a.q, a.dk)),
    confirm: (a) => V.confirm(a.q, a.email), addVehicle: (a) => E.addVehicle(a), addToPlan: (a) => E.addToPlan(a.q), bookNow: (a) => E.bookNow(a.q, a.email),
    // plan and council
    removeEntry: (a) => E.removeEntry(a.id), clearPlan: () => E.clearPlan(), setEntryTime: (a) => E.setEntryTime(a.id, a.from, a.to), addDraft: (a) => E.addDraft(a.vrn, a.dk, a.from, a.to),
    planChange: (a) => E.planChange(a.key, a.from, a.to), cancelVisit: (a) => E.cancelVisit(a.key), endEarly: (a) => E.endEarly(a.key, a.index), bulkApply: (a) => E.bulk(a.keys || []), bulkMove: (a) => E.bulkMove(a.keys || [], a),
    deleteFavourite: (a) => E.deleteFavourite(a.vrn), saveFavourite: (a) => E.saveFavourite(a.vrn, a.nick, !!a.isNew), buy: (a) => E.buy(a.kind, +a.n), undo: (a) => { E.undo(a.id); return {}; },
    // runs
    review: () => { E.closeRun(); return E.prepareRun(null); }, runGo: () => { E.runGo(); return {}; }, stopRun: () => { E.stopRun(); return {}; }, closeRun: () => { E.closeRun(); return {}; },
    // settings and account
    acceptTerms: () => E.acceptTerms().then(() => ({})), load: (a) => E.load({ keepPermits: !!a.keepPermits }).then(() => ({})), setSetting: (a) => E.setSetting(a.key, a.value),
    setPermit: (a) => { E.setPermit(a.id); return {}; }, setSubzone: (a) => { E.setSubzone(a.code); return {}; },
    signIn: () => E.signIn(), signOut: () => E.signOut(), openCouncil: () => E.openCouncil(), shareReport: () => E.shareReport(),
    scan: (a) => E.scan(a.source).then((r) => ({ ...r, cands: r.cands ? r.cands.map((c) => ({ vrn: c.vrn, plate: root.VB.plates.format(c.vrn), name: E.isFav(E.vehicle(c.vrn)) ? E.vehicle(c.vrn).nick : null })) : undefined }))
  };

  async function call(name, args) {
    const fn = API[name];
    if (!fn) throw new Error("unknown engine call: " + name);
    return json(await fn(args || {}));
  }

  // Engine events, forwarded as they come. Native fetches the views it shows again on "change".
  E.on((type, data) => {
    const d = type === "scan" ? { ...data, cands: data.cands ? data.cands.map((c) => ({ vrn: c.vrn, plate: root.VB.plates.format(c.vrn) })) : undefined }
      : type === "quick" ? { view: V.quick(data.q) } : data;
    N.call("engine.event", { type, data: json(d) }).catch(() => {});
  });

  root.VBEngine = { call, names: Object.keys(API) };
  if (!root.VB_MANUAL_START) E.start();
})(typeof globalThis !== "undefined" ? globalThis : this);
