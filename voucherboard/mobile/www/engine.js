// Voucherboard mobile engine: the app's state and everything it does with the council site, with no DOM.
// The web UI (mobile.js) and the native iOS UI (through engine-host.js) both drive it. Actions return plain results
// ({ toast, undo, err }); state changes are announced with on("change"), run progress with on("run").
(function (root) {
  "use strict";
  const P = root.VB.planner, W = root.VB.portal, T = root.VB.terms, M = root.VB.model, R = root.VB.reminders, PL = root.VB.plates, N = root.VBNative;
  const { VT, KINDS, key, fromKey, addDays, hm } = P;
  const { DOW, fmtDay, todayDate, nowMin, vText, plural } = M;
  const LOGGED_OUT = /logged out/i;

  // ---------- helpers ----------
  const gbp = (n) => (n == null ? "" : "£" + n.toFixed(2));
  const typesText = (u) => KINDS.filter((k) => u[k]).map((k) => `${u[k]} × ${VT[k].label}`).join(" + ");
  const range = (f, t) => `${hm(f)} – ${hm(t)}`;
  const weekStart = (d) => addDays(d, -(P.isoDow(d) - 1));
  const vkey = (v) => `${v.vrn}|${v.dk}|${v.start}`;

  // ---------- state ----------
  const S = {
    phase: "boot", error: "", signedOut: false, loadedAt: 0, loading: false, busy: false,
    permits: [], permitId: null, details: null, zone: null, subzones: [], prices: null,
    vehicles: [], bookings: [], balance: { h1: 0, h5: 0, day: 0 }, entries: [],
    settings: { testMode: false, betaLive: false, emailAll: false, reminders: true, lead: 15, liveActivity: true },
    today: todayDate(), now: nowMin(), run: null, version: "", platform: "", lastReport: null
  };
  let seq = 1, pendingShare = null, undoSeq = 1;
  const undos = new Map();
  const store = N.store;
  const listeners = [];
  const on = (fn) => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  const emit = (type, data) => { for (const fn of [...listeners]) { try { fn(type, data || {}); } catch (e) { /* a listener's problem */ } } };
  const changed = () => emit("change");

  const ctx = () => ({ zone: S.zone, today: S.today, now: S.now, bookings: S.bookings, prices: S.prices });
  const TK = () => key(S.today);
  const vehicle = (vrn) => S.vehicles.find((v) => v.vrn === vrn) || { vrn, nick: vrn, fav: false };
  const isFav = (v) => v.fav || v.pendingFav;
  const controls = (d) => P.controls(S.zone, d);
  const shortZone = () => !!S.zone && S.zone.rules.every((r) => r.t - r.f <= 180);
  const planKey = () => "vb:plan:" + S.permitId;
  const savePlan = () => store.set(planKey(), S.entries.map(({ id, vrn, dk, from, to, replaces, email }) => ({ id, vrn, dk, from, to, ...(replaces ? { replaces } : {}), ...(email ? { email } : {}) })));
  const saveSettings = () => store.set("vb:settings", S.settings);
  const haptic = (kind) => N.call("haptic", { kind }).catch(() => {});
  const status = (dk, f, t) => { const k = TK(); if (dk < k) return "past"; if (dk > k) return "up"; if (t <= S.now) return "past"; if (f <= S.now) return "live"; return "up"; };
  const byVehicle = (a, b) => (isFav(b) - isFav(a)) || (isFav(a) ? a.nick.localeCompare(b.nick, "en-GB", { sensitivity: "base" }) : 0) || a.vrn.localeCompare(b.vrn);
  // A way to take an action back, by token, so both UIs can offer Undo.
  const undoable = (fn) => { const id = undoSeq++; undos.set(id, fn); setTimeout(() => undos.delete(id), 60000); return id; };
  function undo(id) { const fn = undos.get(+id); undos.delete(+id); if (fn) { fn(); savePlan(); changed(); } }

  // Bookings back to back for one vehicle on one day are one visit, with its vouchers in time order.
  function visits() {
    const byId = new Map(S.bookings.map((b) => [b.id, b]));
    return R.visits(S.bookings).map((v) => ({ ...v, items: v.ids.map((id) => byId.get(id)).sort((a, b) => a.start - b.start) }));
  }
  const findVisit = (k) => visits().find((v) => vkey(v) === k);
  // Planned changes only count while the booking they replace is still upcoming.
  function cleanEntries() {
    for (const e of S.entries) if (e.replaces) {
      e.replaces = e.replaces.filter((id) => { const b = S.bookings.find((x) => x.id === id); return b && status(b.date, b.start, b.start + b.mins) === "up"; });
      if (!e.replaces.length) delete e.replaces;
    }
  }
  function plan() { cleanEntries(); return P.allocate(ctx(), S.entries, S.balance, "cheapest"); }
  const advice = () => P.purchaseAdvice(ctx(), S.entries, P.allocate(ctx(), S.entries, S.balance, "cheapest"), S.balance);
  const replacedSet = () => new Set(S.entries.flatMap((e) => e.replaces || []));
  // The controlled period running at a time on a day, or the next one later that day.
  function ctlAt(dk, m) { const c = controls(fromKey(dk)); if (!c) return null; return c.filter((x) => x.t > m).sort((a, b) => a.f - b.f)[0] || null; }
  function nextControlled() {
    for (let i = 0; i <= P.WINDOW_DAYS; i++) {
      const d = addDays(S.today, i), c = controls(d);
      if (!c) return null;
      const p = c.filter((x) => i || x.t > S.now).sort((a, b) => a.f - b.f)[0];
      if (p) return { dk: key(d), f: i ? p.f : Math.max(p.f, S.now), t: p.t };
    }
    return null;
  }
  function zoneStatus() {
    if (!S.zone) return { live: false, text: S.subzones.length ? "Choose where you're parking, in More" : "Hours not known for this zone" };
    const c = controls(S.today);
    const cur = c.find((x) => x.f <= S.now && S.now < x.t);
    if (cur) return { live: true, text: `Controlled now, until ${hm(cur.t)}` };
    const later = c.filter((x) => x.f > S.now).sort((a, b) => a.f - b.f)[0];
    if (later) return { live: false, text: `Controlled today ${range(later.f, later.t)}` };
    return { live: false, text: c.length ? "No more controls today" : "No controls today" };
  }
  const balanceText = () => { const b = S.balance, ks = KINDS.filter((k) => b[k]); return ks.length ? ks.map((k) => `${b[k]} × ${VT[k].label}`).join(" · ") : "No unused vouchers"; };
  const ago = () => { const m = Math.round((Date.now() - S.loadedAt) / 60000); return m < 1 ? "updated just now" : `updated ${m} min ago`; };
  // The hours a day view shows: an hour either side of controls, widened to fit bookings and plans.
  function dayWindow(dk) {
    const c = controls(fromKey(dk)) || [];
    let f = c.length ? Math.min(...c.map((x) => x.f)) - 60 : 7 * 60, t = c.length ? Math.max(...c.map((x) => x.t)) + 60 : 19 * 60;
    for (const b of S.bookings) if (b.date === dk) { f = Math.min(f, b.start); t = Math.max(t, b.start + b.mins); }
    for (const e of S.entries) if (e.dk === dk) { f = Math.min(f, e.from); t = Math.max(t, e.to); }
    return { f: Math.max(0, Math.floor(f / 60) * 60), t: Math.min(24 * 60, Math.ceil(t / 60) * 60) };
  }
  // Vehicles with something on these days first, then the other favourites.
  function laneVehicles(dks) {
    const used = new Set([...S.bookings.filter((b) => dks.includes(b.date)).map((b) => b.vrn), ...S.entries.filter((e) => dks.includes(e.dk)).map((e) => e.vrn)]);
    return S.vehicles.filter((v) => used.has(v.vrn) || v.fav).sort((a, b) => (used.has(b.vrn) - used.has(a.vrn)) || byVehicle(a, b));
  }

  // ---------- loading ----------
  const termsOk = async () => { const a = await store.get("vb:terms", null); return !!a && a.version === T.VERSION; };
  async function load(opts = {}) {
    if (!(await termsOk())) { S.phase = "terms"; changed(); return; }
    if (!S.loadedAt) S.phase = "loading";
    S.loading = true; changed();
    try {
      if (!opts.keepPermits || !S.permits.length) S.permits = await W.loadPermits();
      const usable = S.permits.filter(W.isUsableVisitorPermit);
      if (!usable.length) { S.phase = "nopermit"; S.loading = false; changed(); return; }
      const saved = await store.get("vb:permit", null);
      if (!S.permitId || !usable.some((p) => p.id === S.permitId)) S.permitId = usable.some((p) => p.id === saved) ? saved : usable[0].id;
      await loadPermitData();
      const stored = await store.get(planKey(), []);
      S.entries = P.advanceEntries(ctx(), stored.map((e) => ({ ...e, id: seq++ })));
      Object.assign(S, { phase: "ready", signedOut: false, loadedAt: Date.now(), error: "", loading: false });
      changed(); scheduleReminders();
      if (pendingShare) { const d = pendingShare; pendingShare = null; emit("scan", scanOutcome(d.lines || [])); }
    } catch (e) {
      S.loading = false;
      if (LOGGED_OUT.test(e.message || "")) { S.signedOut = true; if (!S.loadedAt) S.phase = "signin"; }
      else if (S.loadedAt) emit("toast", { text: e.message });
      else { S.phase = "error"; S.error = e.message || String(e); }
      changed();
    }
  }
  async function loadPermitData() {
    const r = await M.loadPermitData(S.permitId, S.permits, () => store.get("vb:subzone:" + S.permitId, null));
    Object.assign(S, { details: r.details, subzones: r.subzones, zone: r.zone, bookings: r.bookings, balance: r.balance, prices: r.prices });
    S.vehicles = M.mergeVehicles(S.vehicles, r.favs, S.bookings, S.entries.map((e) => e.vrn));
  }
  function scheduleReminders() {
    if (!N.available || S.phase !== "ready") return;
    const items = S.settings.reminders ? R.schedule({ today: S.today, now: S.now, zone: S.zone, bookings: S.bookings, vehicles: S.vehicles, lead: S.settings.lead }) : [];
    N.call("notify.schedule", { items }).catch(() => {});
  }
  async function acceptTerms() { await store.set("vb:terms", { version: T.VERSION, at: new Date().toISOString() }); S.phase = "loading"; changed(); await load(); }

  // ---------- quick-book form ----------
  // q: { vrns, when: "now" | "today" | "days", days, from, to, preset }. Both UIs keep one and pass it in.
  function quickInit(o = {}) {
    const n = nextControlled(), now = ctlAt(TK(), S.now);
    const q = { vrns: o.vrns || [], when: "now", days: [TK()], from: S.now, to: S.now + 60, preset: "1h" };
    if (o.days) {
      q.when = o.days.length === 1 && o.days[0] === TK() ? "today" : "days"; q.days = o.days;
      const d0 = o.days[0], c = d0 ? ctlAt(d0, d0 === TK() ? S.now : 0) : null;
      q.from = o.from != null ? o.from : c ? Math.max(c.f, d0 === TK() ? S.now : 0) : S.now; q.to = o.to != null ? o.to : q.from + 60; q.preset = o.from != null ? "" : "1h";
    } else if (!(now && now.f <= S.now) && n) { q.when = n.dk === TK() ? "today" : "days"; q.days = [n.dk]; q.from = n.f; q.to = n.f + 60; }
    return q;
  }
  // Extending a visit: the hour straight after it, inside controls.
  function quickExtend(vrn, dk, end) { const c = ctlAt(dk, end); return quickInit({ vrns: [vrn], days: [dk], from: end, to: Math.min(end + 60, c ? c.t : end + 60) }); }
  function quickSel(q) {
    const from = q.when === "now" ? S.now : q.from, to = q.when === "now" ? Math.max(q.to, S.now + 15) : q.to;
    return { vrns: q.vrns, days: q.when === "days" ? q.days : [TK()], from, to };
  }
  function quickPresets(q) {
    const dayMode = q.when === "days", sel = quickSel(q), dk0 = sel.days[0], carry = dk0 ? ctlAt(dk0, sel.from) : null;
    return [["1h", "1 hour"], ["2h", "2 hours"], !shortZone() && ["5h", "5 hours"], !dayMode && carry && ["end", "Until controls end"], dayMode && S.zone && ["whole", "Whole controlled period"]]
      .filter(Boolean).map(([id, label]) => ({ id, label, on: q.preset === id }));
  }
  function quickApplyPreset(q, p) {
    const sel = quickSel(q), f = sel.from;
    q.preset = p;
    if (p === "1h" || p === "2h" || p === "5h") { q.to = f + { "1h": 60, "2h": 120, "5h": 300 }[p]; if (q.when !== "now") q.from = f; }
    else if (p === "end") { const c = ctlAt(sel.days[0], f); if (c) { q.from = Math.max(f, c.f); q.to = c.t; } }
    else if (p === "whole" && S.zone) { let a = 1440, b = 0; for (const r of S.zone.rules) { a = Math.min(a, r.f); b = Math.max(b, r.t); } q.from = a; q.to = b; }
    q.to = Math.min(P.LAST_MIN, q.to);
    return q;
  }
  function quickWhen(q, w) {
    q.when = w;
    if (w === "now") { q.from = S.now; q.to = S.now + (q.preset === "2h" ? 120 : q.preset === "5h" ? 300 : 60); if (q.preset === "whole") q.preset = "1h"; }
    if (w === "today") { q.days = [TK()]; const c = ctlAt(TK(), S.now); if (q.from < S.now || (c && q.from < c.f)) { q.from = c ? Math.max(c.f, S.now) : S.now; q.to = q.from + 60; q.preset = "1h"; } }
    if (w === "days") { if (q.days.length === 1 && q.days[0] === TK()) { const n = nextControlled(); q.days = n && n.dk !== TK() ? [n.dk] : [key(addDays(S.today, 1))]; } const c = ctlAt(q.days[0], 0); if (c && q.from < c.f) { q.from = c.f; q.to = c.f + 60; } }
    if (q.preset && q.preset !== "end") quickApplyPreset(q, q.preset);
    return q;
  }
  function quickTime(q, which, m) {
    if (m == null) return q;
    if (which === "from") { const d = q.to - q.from; q.from = m; q.to = Math.min(P.LAST_MIN, m + Math.max(15, d)); } else q.to = m;
    q.preset = ""; return q;
  }
  // The day picker: quick choices and the next four weeks.
  function quickDays(q) {
    const ws = weekStart(S.today), inW = (d) => P.inWindow(S.today, d);
    const first = q.days.length ? fromKey([...q.days].sort()[0]) : null;
    const choices = [["tom", "Tomorrow"], ["rest", "Rest of this week"], ["next", "Next week"]];
    if (first) choices.push(["every", `Every ${DOW[P.isoDow(first) - 1]} for 4 weeks`]);
    const end = addDays(S.today, P.WINDOW_DAYS), n = Math.ceil(((end - ws) / 864e5 + 1) / 7) * 7, days = [];
    for (let i = 0; i < n; i++) { const d = addDays(ws, i), dk = key(d), c = controls(d); days.push({ dk, date: d.getDate(), label: fmtDay(d), off: !!c && !c.length, today: dk === TK(), on: q.days.includes(dk), enabled: inW(d) }); }
    return { choices: choices.map(([id, label]) => ({ id, label })), days, count: q.days.length };
  }
  function quickPickDays(q, id) {
    const ws = weekStart(S.today), inW = (d) => P.inWindow(S.today, d), first = q.days.length ? fromKey([...q.days].sort()[0]) : null;
    const ctlDays = (a, b) => { const out = []; for (let d = new Date(a); key(d) <= key(b); d = addDays(d, 1)) { const c = controls(d); if (inW(d) && (!c || c.length)) out.push(key(d)); } return out; };
    const f = { tom: () => [key(addDays(S.today, 1))], rest: () => ctlDays(S.today, addDays(ws, 6)), next: () => ctlDays(addDays(ws, 7), addDays(ws, 13)), every: () => (first ? [0, 7, 14, 21].map((o) => addDays(first, o)).filter(inW).map(key) : q.days) }[id];
    if (f) q.days = f();
    return q;
  }
  function quickToggleDay(q, dk) { q.days = q.days.includes(dk) ? q.days.filter((x) => x !== dk) : [...q.days, dk].sort(); return q; }
  function quickPreview(q) {
    const cands = P.candidates(ctx(), quickSel(q), S.entries);
    if (!cands.length) return { cands, items: [], text: q.vrns.length ? "Choose a day and a time." : "Choose a vehicle.", notes: [], ok: false, bad: false, need: null };
    cleanEntries();
    const p = P.allocate(ctx(), S.entries.concat(cands), S.balance, "cheapest"), items = p.items.filter((i) => i.pending);
    const need = { h1: 0, h5: 0, day: 0 }; let bad = false;
    for (const it of items) { if (it.need) for (const k of KINDS) need[k] += it.need[k]; if (it.notes.some((n) => n.c === "bad")) bad = true; }
    const n = need.h1 + need.h5 + need.day, val = P.valueOf(need, S.prices);
    const left = KINDS.filter((k) => need[k] || S.balance[k]).map((k) => `${S.balance[k] - need[k]} × ${VT[k].label}`).join(" · ");
    const notes = [...new Set(items.flatMap((i) => i.notes.filter((x) => x.c !== "bad").map((x) => x.t)))].slice(0, 2);
    const text = bad ? "Not enough vouchers for all of these. Add them to your plan to see what to buy." : n ? `Uses ${typesText(need)}${val != null ? ` (${gbp(val)})` : ""}. ${left} left after.` : items.some((i) => i.notes.some((x) => /already (booked|covered)/.test(x.t))) ? "Already covered at these times. No voucher needed." : "No voucher needed at these times.";
    return { cands, items, text, notes, ok: !bad && n > 0, bad, need };
  }
  // Vehicles matching what's typed, and a new plate if it's not one of them.
  function suggest(text, exclude = []) {
    const t = String(text || "").trim(), nq = W.normVrn(t);
    if (!t) return { matches: S.vehicles.filter((v) => v.fav && !exclude.includes(v.vrn)).sort(byVehicle).slice(0, 12), newVrn: null };
    const matches = S.vehicles.filter((v) => !exclude.includes(v.vrn) && (v.nick.toLowerCase().includes(t.toLowerCase()) || (nq && v.vrn.includes(nq)))).sort(byVehicle).slice(0, 5);
    return { matches, newVrn: nq.length >= 2 && nq.length <= 10 && !S.vehicles.some((v) => v.vrn === nq) ? nq : null };
  }
  // A new vehicle for this plan: checks the plate and, when saving it as a favourite, the nickname with the council.
  // Returns { vrn } (possibly an existing favourite's) or { err }.
  async function addVehicle({ vrn, save, nick }) {
    vrn = W.normVrn(vrn); nick = String(nick || "").trim();
    if (vrn.length < 2 || vrn.length > 10) return { err: "Enter a number plate of 2 to 10 letters and numbers." };
    if (S.vehicles.find((v) => v.vrn === vrn && isFav(v))) return { vrn }; // a corrected plate that's already a favourite
    if (save) {
      if (!nick) return { err: "Enter a nickname to save this vehicle as a favourite." };
      if (S.vehicles.some((v) => isFav(v) && v.nick.toLowerCase() === nick.toLowerCase())) return { err: `You already have a favourite called "${nick}".` };
      try { const r = await W.checkNickname(nick); if (!r.ok) return { err: r.message || "The council site won't accept that nickname." }; }
      catch (e) { return { err: e.message }; }
    }
    const ex = S.vehicles.find((v) => v.vrn === vrn);
    if (ex && !ex.fav) { ex.pendingFav = !!save; if (save) ex.nick = nick; }
    else if (!ex) S.vehicles.push({ vrn, fav: false, pendingFav: !!save, nick: save ? nick : vrn });
    changed(); return { vrn };
  }
  function quickToEntries(q, email) {
    const pv = quickPreview(q), ids = [];
    for (const c of pv.cands) { const e = { id: seq++, vrn: c.vrn, dk: c.dk, from: c.from, to: c.to, ...((email == null ? S.settings.emailAll : email) ? { email: true } : {}) }; S.entries.push(e); ids.push(e.id); }
    return ids;
  }
  function addToPlan(q) {
    const ids = quickToEntries(q); if (!ids.length) return { err: "Nothing to add." };
    savePlan(); haptic("light"); changed();
    return { toast: `Added ${plural(ids.length, "booking")} to your plan.`, undo: undoable(() => { S.entries = S.entries.filter((e) => !ids.includes(e.id)); }) };
  }
  // Book now: add to the plan, then run just those.
  function bookNow(q, email) {
    const ids = quickToEntries(q, !!email); if (!ids.length) return { err: "Nothing to book." };
    savePlan();
    const r = prepareRun(new Set(ids)); if (r.err) return r;
    S.run.added = ids; runGo(); return {};
  }

  // ---------- plan ----------
  function removeEntry(id) {
    const e = S.entries.find((x) => x.id === +id); if (!e) return { err: "This is no longer in your plan." };
    S.entries = S.entries.filter((x) => x !== e); savePlan(); changed();
    return { toast: e.replaces ? "Change dropped. The booking stays as it is." : "Removed from your plan.", undo: undoable(() => { S.entries.push(e); }) };
  }
  function clearPlan() {
    const old = S.entries; S.entries = []; savePlan(); changed();
    return { toast: "Plan cleared.", undo: undoable(() => { S.entries = old; }) };
  }
  function setEntryTime(id, f, t) {
    const e = S.entries.find((x) => x.id === +id); if (!e) return { err: "This is no longer in your plan." };
    const r = M.checkTimes(ctx(), e.dk, f, t); if (r.err) return { err: r.err };
    e.from = r.f; e.to = r.t; delete e.movedFrom; savePlan(); changed();
    return { toast: r.msg || `Changed to ${range(r.f, r.t)}.` };
  }
  // A booking drawn on a timeline: at least 15 minutes, otherwise an hour.
  function addDraft(vrn, dk, a, b) {
    if (b - a < 15) b = a + 60;
    const r = M.checkTimes(ctx(), dk, a, Math.min(P.LAST_MIN, b)); if (r.err) return { err: r.err };
    const id = seq++;
    S.entries.push({ id, vrn, dk, from: r.f, to: r.t, ...(S.settings.emailAll ? { email: true } : {}) });
    savePlan(); haptic("light"); changed();
    return { toast: `Added ${range(r.f, r.t)} to your plan.`, undo: undoable(() => { S.entries = S.entries.filter((x) => x.id !== id); }) };
  }
  // A booking's new time goes into the plan as an entry that replaces it.
  function planChange(k, f, t) {
    const v = findVisit(k); if (!v) return { err: "This booking is no longer on the council site." };
    const r = M.checkTimes(ctx(), v.dk, f, t); if (r.err) return { err: r.err };
    if (r.f === v.start && r.t === v.end) return { err: "That's the booking's current time." };
    const old = S.entries.find((e) => (e.replaces || []).some((id) => v.ids.includes(id)));
    if (old) { old.from = r.f; old.to = r.t; old.replaces = v.ids; delete old.movedFrom; }
    else S.entries.push({ id: seq++, vrn: v.vrn, dk: v.dk, from: r.f, to: r.t, replaces: v.ids, ...(S.settings.emailAll ? { email: true } : {}) });
    savePlan(); changed();
    return { toast: `Change to ${range(r.f, r.t)} added to your plan. Review it to apply.` };
  }

  // ---------- straight to the council: cancel, end early, favourites ----------
  const cancelProgress = (done, total) => emit("progress", { done, total });
  async function afterCancel(ids, done) {
    const gone = new Set(ids.slice(0, done)), before = S.entries.length;
    S.entries = S.entries.filter((e) => !(e.replaces || []).some((id) => gone.has(id)));
    if (S.entries.length !== before) await savePlan();
    try { await loadPermitData(); } catch (e) { /* shown on the next refresh */ }
    changed(); scheduleReminders();
    return before - S.entries.length;
  }
  async function cancelVisit(k) {
    const v = findVisit(k); if (!v) return { err: "This booking is no longer on the council site." };
    const { done, err } = await M.cancelIds(v.ids, cancelProgress);
    const dropped = await afterCancel(v.ids, done);
    haptic(err ? "error" : "success");
    return { err: err ? `Cancelled ${done} of ${v.ids.length}. ${err.message}` : null, toast: err ? null : `Cancelled. ${plural(done, "voucher")} returned.${dropped ? " Its planned change was removed from your plan." : ""}` };
  }
  async function endEarly(k, i) {
    const v = findVisit(k); if (!v) return { err: "This booking is no longer on the council site." };
    const o = P.shrinkOptions(v.items, S.now)[+i || 0]; if (!o) return { err: "This booking can't end early now." };
    const { done, err } = await M.cancelIds([...o.cancel].reverse(), cancelProgress); // latest first, so what's left stays unbroken
    try { await loadPermitData(); } catch (e) { /* shown on the next refresh */ }
    changed(); scheduleReminders(); haptic(err ? "error" : "success");
    return { err: err ? `Cancelled ${done} of ${o.cancel.length}. ${err.message}` : null, toast: err ? null : `Now ends at ${hm(o.end)}. ${plural(done, "voucher")} returned.` };
  }
  // Several at once, from the board: planned items are removed, upcoming bookings cancelled.
  async function bulk(keys) {
    const ents = new Set(keys.filter((k) => k.startsWith("e:")).map((k) => +k.slice(2)));
    S.entries = S.entries.filter((e) => !ents.has(e.id));
    const ids = keys.filter((k) => k.startsWith("b:")).map((k) => findVisit(k.slice(2))).filter((v) => v && v.items.every((i) => i.cancellable) && status(v.dk, v.start, v.end) === "up").flatMap((v) => v.ids);
    const { done, err } = ids.length ? await M.cancelIds(ids, cancelProgress) : { done: 0, err: null };
    if (done) { const gone = new Set(ids.slice(0, done)); S.entries = S.entries.filter((e) => !(e.replaces || []).some((id) => gone.has(id))); }
    await savePlan();
    if (done) { try { await loadPermitData(); } catch (e) { /* shown on the next refresh */ } }
    changed(); scheduleReminders();
    if (done) haptic(err ? "error" : "success");
    return { err: err ? `Cancelled ${done} of ${ids.length}. ${err.message}` : null, toast: err ? null : [done && `${done} cancelled`, ents.size && `${ents.size} removed from your plan`].filter(Boolean).join(", ") + "." };
  }
  // New times for several items at once, checked like a single change. Planned items move; bookings go into the plan
  // as changes. spec: { mode: "set" | "shift", from, to, shift }.
  function bulkTimes(keys, spec) {
    const ok = [], bad = [];
    for (const k of keys) {
      const ent = k.startsWith("e:"), x = ent ? S.entries.find((e) => "e:" + e.id === k) : findVisit(k.slice(2));
      if (!x) continue;
      const f0 = ent ? x.from : x.start, t0 = ent ? x.to : x.end, it = { k, x, ent, f0 };
      if (!ent && !(status(x.dk, x.start, x.end) === "up" && x.items.every((i) => i.cancellable))) { bad.push({ ...it, err: "It has started, or the council site doesn't allow changing it." }); continue; }
      const nf = spec.mode === "set" ? +spec.from : f0 + (+spec.shift || 0), nt = spec.mode === "set" ? +spec.to : t0 + (+spec.shift || 0);
      const r = nf < 0 || nt > 24 * 60 ? { err: "That moves it into another day." } : M.checkTimes(ctx(), x.dk, nf, nt);
      if (r.err) bad.push({ ...it, err: r.err });
      else if (r.f === f0 && r.t === t0) bad.push({ ...it, err: "No change." });
      else ok.push({ ...it, f: r.f, t: r.t });
    }
    return { ok, bad };
  }
  function bulkMove(keys, spec) {
    const { ok } = bulkTimes(keys, spec);
    if (!ok.length) return { err: "None of the selected can change to that." };
    const before = JSON.parse(JSON.stringify(S.entries));
    let nb = 0;
    for (const o of ok) {
      if (o.ent) { o.x.from = o.f; o.x.to = o.t; delete o.x.movedFrom; }
      else if (!planChange(o.k.slice(2), o.f, o.t).err) nb++;
    }
    savePlan(); haptic("light"); changed();
    return { toast: `${ok.length} changed.${nb ? ` ${nb} booking change${nb > 1 ? "s are" : " is"} in your plan. Review it to apply.` : ""}`, undo: undoable(() => { S.entries = before; }) };
  }
  async function deleteFavourite(vrn) {
    const v = vehicle(vrn);
    try {
      await W.deleteFavourite(v.favId);
      const favs = await W.loadVehicles();
      if (favs.some((f) => f.favId === v.favId)) throw new W.PortalError("The council site didn't delete it. Try on its Vehicles page.");
      S.vehicles = M.mergeVehicles(S.vehicles, favs, S.bookings, S.entries.map((e) => e.vrn));
    } catch (e) { changed(); return { err: `Couldn't delete "${v.nick}". ${e.message}` }; }
    changed(); return { toast: `Deleted "${v.nick}" from your favourites.` };
  }
  // Saves a plate as a favourite on the council site now. For a new plate too (from Vehicles).
  async function saveFavourite(vrnIn, nickIn, isNew) {
    const vrn = W.normVrn(vrnIn), nick = String(nickIn || "").trim(), v = vehicle(vrn);
    if (vrn.length < 2) return { err: "Enter a number plate." };
    if (!nick) return { err: "Enter a nickname." };
    if (isNew && S.vehicles.some((x) => x.fav && x.vrn === vrn)) return { err: "That vehicle is already a favourite." };
    if (S.vehicles.some((x) => x.vrn !== vrn && isFav(x) && x.nick.toLowerCase() === nick.toLowerCase())) return { err: `You already have a favourite called "${nick}".` };
    try {
      const r = await W.checkNickname(nick); if (!r.ok) return { err: r.message || "The council site won't accept that nickname." };
      await W.createFavourite(nick, v.vrn);
      const favs = await W.loadVehicles(); if (!favs.some((f) => f.vrn === vrn)) return { err: "The council site didn't save it. Try on its Vehicles page." };
      S.vehicles = M.mergeVehicles(S.vehicles, favs, S.bookings, S.entries.map((e) => e.vrn));
    } catch (e) { return { err: e.message }; }
    changed(); return { toast: `Saved "${nick}" as a favourite.` };
  }
  async function buy(kind, n) {
    const pr = S.prices && S.prices[kind]; if (!pr) return { err: "Prices aren't known for that voucher." };
    const count = Math.max(1, Math.round(n / (pr.book || 1))), bk = pr.book || 1;
    try {
      await W.buyUrl(S.permitId, pr.periodPriceId, count); // checks the council allows that many
      await savePlan();
      const label = bk > 1 ? `${count} book${count > 1 ? "s" : ""} of ${bk} × ${VT[kind].label}` : `${count} × ${VT[kind].label}`;
      await N.call("council.show", { reason: "buy", path: "/Home/ApplicantPermits", buy: { permitId: S.permitId, periodPriceId: pr.periodPriceId, count, label } });
    } catch (e) { return { err: e.message }; }
    return {};
  }

  // ---------- settings and account ----------
  async function setSetting(k, v) {
    if (!(k in S.settings)) return { err: "Unknown setting." };
    if (k === "reminders" && v) { try { const r = await N.call("notify.permission"); if (!r || !r.granted) return { err: "Notifications are off for Voucherboard. Turn them on in your phone's settings." }; } catch (e) { /* no shell: keep the setting */ } }
    S.settings[k] = k === "lead" ? +v : !!v; saveSettings();
    if (k === "emailAll") { for (const e of S.entries) e.email = !!v; savePlan(); }
    if (k === "reminders" || k === "lead") scheduleReminders();
    changed(); return {};
  }
  function setPermit(id) { if (id === S.permitId) return; S.permitId = id; store.set("vb:permit", id); load({ keepPermits: true }); }
  function setSubzone(code) { S.zone = S.subzones.find((z) => z.code === code) || null; store.set("vb:subzone:" + S.permitId, S.zone && S.zone.code); changed(); scheduleReminders(); }
  const signIn = () => N.call("council.show", { reason: "signin", path: "/Account/Login" }).then(() => ({}), (e) => ({ err: e.message }));
  const openCouncil = () => N.call("council.show", { reason: "browse", path: "/Home/ApplicantPermits" }).then(() => ({}), (e) => ({ err: e.message }));
  async function signOut() {
    try { await N.call("council.signOut"); } catch (e) { /* cleared or not, sign in again */ }
    Object.assign(S, { signedOut: true, loadedAt: 0, phase: "signin" });
    N.call("notify.schedule", { items: [] }).catch(() => {}); changed(); return {};
  }
  const shareReport = () => (S.lastReport ? N.call("share", { title: "Voucherboard error report", text: S.lastReport }).then(() => ({}), () => ({ err: "Couldn't open sharing." })) : Promise.resolve({}));

  // ---------- number plate scanning ----------
  // The phone reads the text on device; VB.plates picks out plates. A scan only fills in a plate: the user still books.
  function scanResults(lines, tapped) {
    const first = tapped ? PL.find([{ text: tapped, confidence: 1 }]).map((c) => c.vrn) : [];
    const known = new Set(S.vehicles.filter(isFav).map((v) => v.vrn));
    return PL.find(lines).sort((a, b) => (first.includes(b.vrn) - first.includes(a.vrn)) || (known.has(b.vrn) - known.has(a.vrn)) || b.score - a.score);
  }
  function scanOutcome(lines, tapped) {
    const c = scanResults(lines, tapped);
    haptic(c.length ? "light" : "warning");
    return c.length ? { cands: c } : { err: "No number plate found. Try a closer, straight-on picture, or type it." };
  }
  async function scan(source) {
    let r;
    try { r = await N.call("plate.scan", { source }); }
    catch (e) { return { err: /camera-denied/.test(e.message) ? "Camera access is off for Voucherboard. Turn it on in your phone's settings, or choose a photo." : /unavailable/.test(e.message) ? "This phone can't scan with the camera. Choose a photo instead." : "Couldn't read the picture. Try again, or type the plate." }; }
    if (!r || r.cancelled) return { cancelled: true };
    return scanOutcome(r.lines || [], r.tapped);
  }

  // ---------- running a plan ----------
  function prepareRun(only) {
    cleanEntries();
    let p = P.allocate(ctx(), S.entries, S.balance, "cheapest");
    if (only) p = { ...p, items: p.items.filter((it) => only.has(it.entry.id)) };
    const run = M.buildOps(p, S.bookings);
    if (!run.ops.length) return { err: "Nothing to send." };
    const test = S.settings.testMode;
    S.run = { run, test, phase: "review", sent: 0, total: M.requestCount(run, test), label: "", stop: false, paused: false,
      stat: run.ops.map((o) => ({ cls: "wait", txt: o.kind === "book" && o.a.moved ? "Moved to now" : "Waiting" })) };
    changed(); return {};
  }
  function stopRun() { if (S.run && S.run.phase === "running") { S.run.stop = true; emit("run", {}); } }
  function closeRun() { if (S.busy) return; S.run = null; changed(); }
  async function runGo() {
    const R0 = S.run; if (!R0 || R0.phase !== "review") return;
    const { ops, repl } = R0.run, test = R0.test;
    R0.phase = "running"; S.busy = true; changed();
    N.call("run.begin").catch(() => {});
    const emailFor = (a) => { const en = S.entries.find((x) => x.id === a.eid); return !!(en && en.email); };
    const r = await M.runOps({ ops, repl, permitId: S.permitId, test, vehicle, emailFor, on: {
      stat: (i, cls, txt) => { R0.stat[i] = { cls, txt }; emit("run", { i }); },
      bump: (label) => { R0.sent++; R0.label = label; emit("run", {}); },
      moved: () => { ops.forEach((o, j) => { if (o.kind === "book" && o.a.moved && R0.stat[j].cls === "wait") R0.stat[j].txt = "Moved to now"; }); emit("run", { all: true }); },
      stopping: () => R0.stop
    } });
    let failed = r.failed;
    if (failed && failed.index != null) R0.stat[failed.index] = { cls: "fail", txt: "Failed", err: failed.message };
    for (const s of R0.stat) if (/^(wait|run)$/.test(s.cls)) { s.cls = "wait"; s.txt = "Not sent"; }
    R0.sent++; R0.label = "Finishing"; emit("run", {});
    let missing = 0;
    if (!test && (r.done || r.cancelled)) {
      try {
        await loadPermitData();
        missing = M.missingAfterRun(r.booked, S.bookings);
        // The council may list the new booking under the cancelled one's id, so done cancellations aren't planned again.
        for (const en of S.entries) if (r.cancelledE.has(en.id)) delete en.replaces;
        S.entries = P.advanceEntries(ctx(), S.entries);
        const p = plan();
        S.entries = S.entries.filter((en) => p.items.some((it) => it.entry === en && (it.acts.length || it.replaces.length)));
      } catch (e) { failed = failed || e; }
    }
    if (test && R0.added) S.entries = S.entries.filter((e) => !R0.added.includes(e.id)); // Book now in test mode: nothing joins the plan
    await savePlan();
    if (LOGGED_OUT.test((failed && failed.message) || "")) S.signedOut = true;
    let note = M.runNote(R0.run, { ...r, failed, stop: R0.stop, missing }, test);
    if (R0.paused) note = "Voucherboard went into the background, so the run paused. " + note;
    Object.assign(R0, { phase: "done", failed, note, summary: M.runSummary(r) });
    if (failed) S.lastReport = R0.report = M.errorReport({ failed, test, ops, picked: r.picked, done: r.done, stop: R0.stop, startedAt: r.startedAt, available: r.fresh },
      { version: S.version, page: `Voucherboard app (${N.platform})`, browser: root.navigator ? root.navigator.userAgent : "", permitId: S.permitId });
    if (!test && r.done && S.settings.reminders) {
      const vrns = new Set(r.booked.map((a) => a.vrn));
      const n = R.schedule({ today: S.today, now: S.now, zone: S.zone, bookings: S.bookings, vehicles: S.vehicles, lead: S.settings.lead }).find((x) => vrns.has(x.data.vrn));
      if (n) { const d = new Date(n.at); R0.reminder = `Reminder set for ${hm(d.getHours() * 60 + d.getMinutes())}${key(d) === TK() ? "" : " on " + fmtDay(d)}.`; }
    }
    S.busy = false;
    N.call("run.end").catch(() => {});
    haptic(failed ? "error" : "success");
    emit("run", { done: true }); changed(); scheduleReminders();
  }

  // ---------- clock and app events ----------
  function tick() {
    const t = todayDate();
    if (key(t) !== key(S.today)) { S.today = t; S.now = nowMin(); if (!S.busy && S.phase === "ready") load({ keepPermits: true }); return; }
    const n = nowMin(); if (n === S.now) return;
    S.now = n;
    if (S.phase !== "ready") return;
    const before = S.entries.map((e) => e.from).join();
    S.entries = P.advanceEntries(ctx(), S.entries);
    if (S.entries.map((e) => e.from).join() !== before) savePlan();
    emit("tick");
  }
  function wire() {
    N.on("app.state", (d) => {
      if (d.state === "background" && S.run && S.run.phase === "running") { S.run.stop = true; S.run.paused = true; emit("run", {}); }
      if (d.state === "active" && S.phase === "ready" && !S.busy && Date.now() - S.loadedAt > 5 * 60 * 1000) load({ keepPermits: true });
    });
    N.on("council.closed", (d) => { if (d.reason === "signin" && !d.signedIn) return; load({ keepPermits: d.reason !== "signin" }); });
    N.on("notification", (d) => {
      if (S.phase !== "ready") return;
      const x = d.data || {};
      if (d.action === "extend" && x.vrn && x.dk && x.end != null) emit("quick", { q: quickExtend(x.vrn, x.dk, +x.end) });
      else emit("home");
    });
    N.on("plate.shared", (d) => {
      if (S.phase !== "ready") { pendingShare = d; return; }
      emit("scan", scanOutcome(d.lines || []));
    });
  }
  let started = false;
  async function start() {
    if (started) return; started = true;
    W.transport = N.transport;
    wire();
    try { const h = await N.call("hello"); S.version = (h && h.version) || ""; S.platform = (h && h.platform) || ""; } catch (e) { /* no shell */ }
    S.settings = { ...S.settings, ...(await store.get("vb:settings", {})) };
    changed();
    setInterval(tick, 15000);
    await load();
  }

  root.VB.engine = {
    S, on, start, load, acceptTerms, tick, undo,
    // reading
    ctx, TK, vehicle, isFav, controls, shortZone, status, byVehicle, visits, findVisit, vkey, plan, advice, replacedSet, ctlAt, nextControlled,
    zoneStatus, balanceText, ago, dayWindow, laneVehicles, weekStart, range, gbp, typesText,
    // quick-book
    quickInit, quickExtend, quickSel, quickPresets, quickApplyPreset, quickWhen, quickTime, quickDays, quickPickDays, quickToggleDay, quickPreview, suggest, addVehicle, addToPlan, bookNow,
    // plan and council
    removeEntry, clearPlan, setEntryTime, addDraft, planChange, cancelVisit, endEarly, bulk, bulkTimes, bulkMove, deleteFavourite, saveFavourite, buy,
    setSetting, setPermit, setSubzone, signIn, signOut, openCouncil, shareReport,
    scan, scanResults, prepareRun, runGo, stopRun, closeRun
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
