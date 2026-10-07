// View models for native screens (the iOS app's SwiftUI). Plain JSON built from the engine's state, with the same
// wording and numbers the web UI shows, so both apps say the same thing. No DOM.
(function (root) {
  "use strict";
  const P = root.VB.planner, M = root.VB.model, T = root.VB.terms, W = root.VB.portal, PL = root.VB.plates, E = root.VB.engine;
  const { VT, KINDS, key, fromKey, addDays, hm } = P;
  const { DOW, MON, fmtDay, hShort, vText, plural } = M;
  const S = E.S;
  const ISSUES_URL = "https://github.com/maubergine/voucherboard/issues";
  const plate = (v) => PL.format(v);
  // A vehicle that isn't a favourite is named by its plate, spaced as the badge shows it, so screens can skip repeating it.
  const nameOf = (v) => (v.fav || v.pendingFav ? vText(v) : plate(v.vrn));
  const dayBits = (dk) => { const d = fromKey(dk); return { day: dk === E.TK() ? "Today" : DOW[P.isoDow(d) - 1], date: `${d.getDate()} ${MON[d.getMonth()]}` }; };

  // ---------- shared rows ----------
  function visitRow(v, repl) {
    const veh = E.vehicle(v.vrn), chg = v.ids.some((id) => repl.has(id)), st = E.status(v.dk, v.start, v.end);
    const pill = chg ? { text: "Changing", tone: "change" } : st === "live" ? { text: "On now", tone: "live" } : st === "past" ? { text: "Finished", tone: "past" } : { text: "Booked", tone: "booked" };
    const canCancel = !chg && st === "up" && v.items.every((i) => i.cancellable);
    return { kind: "visit", key: E.vkey(v), dk: v.dk, ...dayBits(v.dk), vrn: v.vrn, plate: plate(v.vrn), name: nameOf(veh), time: E.range(v.start, v.end), start: v.start, pill,
      canCancel, cancelText: canCancel ? `${v.items.length > 1 ? `${v.items.length} vouchers go` : "1 voucher goes"} back to your unused vouchers.` : null };
  }
  function entryRow(e) {
    const veh = E.vehicle(e.vrn);
    return { kind: "entry", id: e.id, dk: e.dk, ...dayBits(e.dk), vrn: e.vrn, plate: plate(e.vrn), name: nameOf(veh), time: (e.replaces ? "Change to " : "") + E.range(e.from, e.to), start: e.from, pill: { text: e.replaces ? "Change" : "Planned", tone: "plan" } };
  }
  // Booked vouchers a change keeps instead of cancelling them and booking again.
  const keptOf = (it) => (it.entry.replaces ? S.bookings.filter((b) => it.entry.replaces.includes(b.id)).length - it.replaces.length : 0);
  const byTime = (a, b) => a.dk.localeCompare(b.dk) || a.start - b.start;
  // Milliseconds from now until minute m of day dk. Native adds these to its own clock (the iOS Live Activity).
  const msUntil = (dk, m) => { const d = fromKey(dk); d.setHours(0, m, 0, 0); return d.getTime() - Date.now(); };
  // The controlled hours across these days (or the zone's widest, if none are chosen), for time pickers. Null if the
  // zone isn't known or has no controls then: any time can be picked.
  function limits(dks) {
    let f = 1440, t = 0;
    for (const dk of dks) for (const c of E.controls(fromKey(dk)) || []) { f = Math.min(f, c.f); t = Math.max(t, c.t); }
    if (f >= t && S.zone && !dks.length) for (const r of S.zone.rules) { f = Math.min(f, r.f); t = Math.max(t, r.t); }
    return f < t ? { f, t } : null;
  }

  // ---------- top level ----------
  function home() {
    const z = S.zone, zs = E.zoneStatus(), name = S.details ? S.details.zoneName : "";
    let tray = null;
    if (S.entries.length) {
      const p = E.plan();
      tray = { title: p.count ? `${plural(p.count, "voucher")} planned${p.cost != null ? " · " + E.gbp(p.cost) : ""}` : `${plural(S.entries.length, "change")} planned`,
        short: `${p.count || S.entries.length} planned${p.count && p.cost != null ? " · " + E.gbp(p.cost) : ""}`, subtitle: p.short ? "Not enough vouchers. See plan." : "Tap to see your plan", ready: p.ready };
    }
    return {
      phase: S.phase, error: S.error, signedOut: S.signedOut, loading: S.loading, updated: S.loadedAt ? E.ago() : "", testMode: S.settings.testMode, version: S.version,
      zone: { code: z ? z.code : (name.split(" - ")[0] || "?"), name: z ? z.name : name.split(" - ")[1] || name, live: zs.live, text: zs.text },
      balance: E.balanceText(), tray, running: !!S.run, busy: S.busy
    };
  }

  function today() {
    const vs = E.visits(), tk = E.TK(), repl = E.replacedSet(), last = key(addDays(S.today, 7));
    const live = vs.filter((v) => v.dk === tk && E.status(v.dk, v.start, v.end) === "live").map((v) => {
      const veh = E.vehicle(v.vrn), carry = E.ctlAt(v.dk, v.end), canExtend = !!(carry && carry.f <= v.end);
      return {
        key: E.vkey(v), vrn: v.vrn, plate: plate(v.vrn), name: nameOf(veh), time: E.range(v.start, v.end), vouchers: plural(v.items.length, "voucher"), ends: `Ends ${hm(v.end)}`,
        startIn: msUntil(v.dk, v.start), endIn: msUntil(v.dk, v.end),
        pct: Math.max(0, Math.min(100, Math.round(((S.now - v.start) / (v.end - v.start)) * 100))),
        note: canExtend ? `Controls run until ${hm(carry.t)}.` : "Covers the rest of today's controls.",
        canExtend, extend: canExtend ? { vrn: v.vrn, dk: v.dk, end: v.end } : null,
        canEndEarly: S.settings.betaLive && P.shrinkOptions(v.items, S.now).length > 0
      };
    });
    const next = [...vs.filter((v) => v.dk <= last && E.status(v.dk, v.start, v.end) === "up").map((v) => visitRow(v, repl)), ...S.entries.filter((e) => e.dk <= last).map(entryRow)].sort(byTime);
    return { live, liveActivity: S.settings.liveActivity, zone: S.zone ? S.zone.code : "", next: next.slice(0, 6), more: Math.max(0, next.length - 6), total: next.length, favourites: S.vehicles.filter((v) => v.fav).sort(E.byVehicle).map((v) => ({ vrn: v.vrn, nick: v.nick, plate: plate(v.vrn) })) };
  }

  // ---------- calendar ----------
  function calendar(sel) {
    const start = E.weekStart(S.today), end = addDays(S.today, P.WINDOW_DAYS), n = Math.ceil(((end - start) / 864e5 + 1) / 7) * 7;
    const booked = new Set(S.bookings.map((b) => b.date)), planned = new Set(S.entries.map((e) => e.dk));
    const dk0 = sel || (E.nextControlled() || { dk: E.TK() }).dk, days = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i), dk = key(d), c = E.controls(d);
      days.push({ dk, date: d.getDate(), label: fmtDay(d), off: !!c && !c.length, today: dk === E.TK(), selected: dk === dk0, enabled: P.inWindow(S.today, d) || booked.has(dk), booked: booked.has(dk), planned: planned.has(dk) });
    }
    return { weekdays: DOW.map((x) => x[0]), days, selected: agenda(dk0) };
  }
  function agenda(dk) {
    const d = fromKey(dk), repl = E.replacedSet();
    const items = [...E.visits().filter((v) => v.dk === dk).map((v) => visitRow(v, repl)), ...S.entries.filter((e) => e.dk === dk).map(entryRow)].sort(byTime);
    return { dk, title: fmtDay(d), ctl: M.ctlText(S.zone, d), items, bookable: P.inWindow(S.today, d) };
  }
  function blocksFor(vrn, keys, repl) {
    const out = [];
    for (const g of E.visits().filter((v) => v.vrn === vrn && keys.includes(v.dk))) {
      const st = E.status(g.dk, g.start, g.end);
      out.push({ kind: "visit", key: E.vkey(g), sel: "b:" + E.vkey(g), dayIndex: keys.indexOf(g.dk), f: g.start, t: g.end, status: st, changing: g.ids.some((id) => repl.has(id)), label: E.range(g.start, g.end) });
    }
    for (const e of S.entries.filter((x) => x.vrn === vrn && keys.includes(x.dk))) out.push({ kind: "entry", id: e.id, sel: "e:" + e.id, dayIndex: keys.indexOf(e.dk), f: e.from, t: e.to, status: "plan", changing: false, label: E.range(e.from, e.to) });
    return out;
  }
  // One day as a timeline: hours down the side, a lane per vehicle.
  function day(dk) {
    const d = fromKey(dk), win = E.dayWindow(dk), repl = E.replacedSet();
    return {
      dk, title: fmtDay(d), ctl: M.ctlText(S.zone, d), bookable: P.inWindow(S.today, d), prev: key(addDays(d, -1)), next: key(addDays(d, 1)),
      from: win.f, to: win.t, hours: hoursIn(win), controls: E.controls(d) || [], now: dk === E.TK() && S.now >= win.f && S.now <= win.t ? S.now : null,
      lanes: E.laneVehicles([dk]).map((v) => ({ vrn: v.vrn, plate: plate(v.vrn), name: E.isFav(v) ? v.nick : "Other", blocks: blocksFor(v.vrn, [dk], repl) }))
    };
  }
  const hoursIn = (win) => { const out = []; for (let m = Math.ceil(win.f / 60) * 60; m <= win.t; m += 60) out.push({ min: m, label: hm(m), short: hShort(m) }); return out; };
  // The landscape board: week, 28 days or one day, vehicles down the side.
  function board(zoom, cursorDk) {
    const c = cursorDk ? fromKey(cursorDk) : S.today;
    const days = zoom === "day" ? [c] : zoom === "week" ? [...Array(7)].map((_, i) => addDays(E.weekStart(c), i)) : [...Array(28)].map((_, i) => addDays(E.weekStart(S.today), i));
    const keys = days.map(key), repl = E.replacedSet();
    let win;
    if (zoom === "day") win = E.dayWindow(keys[0]);
    else if (!S.zone) win = { f: 7 * 60, t: 19 * 60 };
    else { let f = 1440, t = 0; for (const r of S.zone.rules) { f = Math.min(f, r.f); t = Math.max(t, r.t); } win = { f: Math.max(0, f - 60), t: Math.min(1440, t + 60) }; }
    const n = days.length, ti = keys.indexOf(E.TK());
    const step = zoom === "day" ? 1 : 7;
    return {
      zoom, label: zoom === "day" ? fmtDay(days[0]) : `${days[0].getDate()} ${MON[days[0].getMonth()]} – ${days[n - 1].getDate()} ${MON[days[n - 1].getMonth()]}`,
      from: win.f, to: win.t, hours: zoom === "day" ? hoursIn(win) : [],
      days: days.map((d, i) => { const ctl = E.controls(d); return { dk: keys[i], label: n > 7 ? String(d.getDate()) : `${DOW[P.isoDow(d) - 1]} ${d.getDate()}`, today: keys[i] === E.TK(), off: !!ctl && !ctl.length, controls: ctl || [], bookable: P.inWindow(S.today, d) }; }),
      now: ti >= 0 && S.now > win.f && S.now < win.t ? { dayIndex: ti, min: S.now } : null,
      prev: zoom === "cal" ? null : key(addDays(c, -step)), next: zoom === "cal" ? null : key(addDays(c, step)),
      lanes: E.laneVehicles(keys).map((v) => ({ vrn: v.vrn, plate: plate(v.vrn), name: E.isFav(v) ? v.nick : "Other", blocks: blocksFor(v.vrn, keys, repl) }))
    };
  }

  // ---------- vehicles ----------
  function vehicleStatus(v) {
    const vs = E.visits().filter((x) => x.vrn === v.vrn);
    const live = vs.find((x) => E.status(x.dk, x.start, x.end) === "live");
    if (live) return { text: `On now, until ${hm(live.end)}`, tone: "live" };
    const up = vs.filter((x) => E.status(x.dk, x.start, x.end) === "up").sort((a, b) => a.dk.localeCompare(b.dk) || a.start - b.start)[0];
    const n = S.entries.filter((e) => e.vrn === v.vrn).length;
    if (up) return { text: `Next: ${fmtDay(fromKey(up.dk))}, ${hm(up.start)}${n ? ` · ${n} planned` : ""}`, tone: "" };
    return { text: n ? `${n} in your plan` : "Nothing booked", tone: "" };
  }
  function vehicles(q) {
    q = String(q || "").trim().toLowerCase(); const nq = W.normVrn(q);
    const match = (v) => !q || v.nick.toLowerCase().includes(q) || (nq && v.vrn.includes(nq));
    const row = (v) => ({ vrn: v.vrn, plate: plate(v.vrn), name: nameOf(v), status: vehicleStatus(v) });
    return { favourites: S.vehicles.filter((v) => v.fav && match(v)).sort(E.byVehicle).map(row), others: S.vehicles.filter((v) => !v.fav && match(v)).sort(E.byVehicle).map(row) };
  }
  function vehicle(vrn) {
    const v = E.vehicle(vrn), repl = E.replacedSet();
    const items = [...E.visits().filter((x) => x.vrn === v.vrn && E.status(x.dk, x.start, x.end) !== "past").map((x) => visitRow(x, repl)), ...S.entries.filter((e) => e.vrn === v.vrn).map(entryRow)].sort(byTime);
    return { vrn: v.vrn, plate: plate(v.vrn), title: E.isFav(v) ? v.nick : "Vehicle", subtitle: v.fav ? "Favourite" : v.pendingFav ? "Saves as a favourite with its next booking" : "Not a favourite",
      fav: !!v.fav, canDelete: !!(v.fav && v.favId), nick: v.pendingFav ? v.nick : "", bookLabel: `Book ${nameOf(v)}`, items };
  }
  function suggest(text, exclude) {
    const g = E.suggest(text, exclude || []);
    return { matches: g.matches.map((v) => ({ vrn: v.vrn, plate: plate(v.vrn), name: nameOf(v), nick: v.nick })), newVrn: g.newVrn, newPlate: g.newVrn ? plate(g.newVrn) : null };
  }

  // ---------- plan, entries and bookings ----------
  function needText(it) {
    const k = keptOf(it), keeps = `keeps ${plural(k, "booked voucher")}`;
    return it.need ? E.typesText(it.need) + (k ? `, ${keeps}` : "") : k ? keeps : it.bill ? "" : "no voucher needed";
  }
  function costText(it) {
    const k = keptOf(it), kept = plural(k, "booked voucher");
    return it.need ? `Uses ${E.typesText(it.need)}${k ? ` and keeps ${kept}` : ""}` : k ? `Keeps ${kept}. No new voucher needed` : it.bill ? "Not enough vouchers" : "No voucher needed";
  }
  function plan() {
    const p = E.plan(), adv = E.advice();
    const items = p.items.map((it) => {
      const e = it.entry, bad = it.notes.find((n) => n.c === "bad");
      return { id: e.id, dk: it.dk, ...dayBits(it.dk), vrn: e.vrn, plate: plate(e.vrn), change: !!e.replaces, time: E.range(e.from, e.to), need: needText(it), bad: bad ? bad.t : null, start: e.from };
    }).sort(byTime);
    const sub = [p.count && `${plural(p.count, "voucher")} to book`, p.cancels && `${p.cancels} to cancel`].filter(Boolean).join(" · ") || "Nothing to send";
    let advice = null;
    if (adv) {
      const kinds = KINDS.filter((k) => adv.buy[k]);
      const what = kinds.map((k) => { const n = adv.buy[k], bk = S.prices[k].book; return bk > 1 ? `${n / bk} book${n / bk > 1 ? "s" : ""} of ${bk} × ${VT[k].label} (${E.gbp(n * S.prices[k].price)})` : `${n} × ${VT[k].label} (${E.gbp(n * S.prices[k].price)})`; }).join(" and ");
      const buys = kinds.map((k) => ({ kind: k, n: adv.buy[k], label: `Buy ${adv.buy[k]} × ${VT[k].label} on council site` }));
      advice = adv.saving === null
        ? { tone: "warn", title: p.short ? "You need more vouchers." : `Buy ${what}`, text: `Buy ${what}. Then the plan uses ${E.gbp(adv.idealCost)} of vouchers. Your plan is kept while you pay.`, buys }
        : { tone: "info", title: `Save ${E.gbp(adv.saving)} by buying ${what}`, text: "This mix suits these times better. Your plan is kept while you pay.", buys };
    }
    return { items, subtitle: `${sub}. Nothing is sent until you review it.`, cost: p.cost != null && p.count ? `Uses ${E.typesText(p.used)} · ${E.gbp(p.cost)} of vouchers` : null,
      ready: p.ready, reviewLabel: `Review ${plural(p.count + p.cancels, "change")}`, advice, empty: !items.length };
  }
  function entry(id) {
    const e = S.entries.find((x) => x.id === +id); if (!e) return null;
    const v = E.vehicle(e.vrn), it = E.plan().items.find((x) => x.entry === e);
    return { id: e.id, vrn: e.vrn, plate: plate(e.vrn), name: nameOf(v), title: e.replaces ? "Planned change" : "Planned booking", dayText: fmtDay(fromKey(e.dk)), ctl: M.ctlText(S.zone, fromKey(e.dk)), limits: limits([e.dk]),
      from: e.from, to: e.to, cost: it ? costText(it) : null,
      notes: it ? it.notes.map((n) => ({ tone: n.c || "", text: n.t })) : [], removeLabel: e.replaces ? "Drop this change" : "Remove from plan" };
  }
  function visit(k) {
    const v = E.findVisit(k); if (!v) return null;
    const veh = E.vehicle(v.vrn), st = E.status(v.dk, v.start, v.end), d = fromKey(v.dk);
    const canCancel = v.items.every((i) => i.cancellable) && st === "up";
    const shrink = st === "live" ? P.shrinkOptions(v.items, S.now) : [];
    const why = canCancel ? "" : st === "live" ? (shrink.length ? (S.settings.betaLive ? "" : "To end it early, turn on the beta option in More.") : "Started bookings can't be cancelled.") : st === "past" ? "This booking has finished." : "The council site doesn't allow cancelling this booking.";
    return {
      key: k, vrn: v.vrn, plate: plate(v.vrn), name: nameOf(veh), status: st, statusText: { past: "Finished", live: "In progress", up: "Booked" }[st],
      dayText: fmtDay(d), time: E.range(v.start, v.end), start: v.start, end: v.end, limits: limits([v.dk]), vouchersText: plural(v.items.length, "voucher"),
      vouchers: v.items.map((b) => ({ label: `${hShort(b.start)}–${hShort(b.start + b.mins)}`, running: v.dk === E.TK() && b.start <= S.now && S.now < b.start + b.mins, past: st === "past" })),
      refs: v.items.map((i) => i.ref).join(", "), canCancel, canChange: canCancel, note: canCancel ? `You can cancel this until it starts at ${hm(v.start)} on ${fmtDay(d)}.` : why,
      cancelText: `${v.items.length > 1 ? `${v.items.length} vouchers go` : "1 voucher goes"} back to your unused vouchers.`,
      canEndEarly: shrink.length > 0 && S.settings.betaLive, shrink: shrink.map((o, i) => ({ index: i, end: hm(o.end), returns: `Returns ${plural(o.cancel.length, "voucher")}` })),
      keepLabel: `Keep until ${hm(v.end)}`
    };
  }
  function bulk(keys) {
    const ents = keys.filter((k) => k.startsWith("e:")).map((k) => S.entries.find((e) => "e:" + e.id === k)).filter(Boolean);
    const vis = keys.filter((k) => k.startsWith("b:")).map((k) => E.findVisit(k.slice(2))).filter(Boolean);
    const cancellable = vis.filter((v) => v.items.every((i) => i.cancellable) && E.status(v.dk, v.start, v.end) === "up");
    const nV = cancellable.reduce((n, v) => n + v.items.length, 0);
    const what = [cancellable.length && `cancel ${plural(cancellable.length, "booking")} (${plural(nV, "voucher")} back)`, ents.length && `remove ${ents.length} planned`].filter(Boolean).join(" and ");
    return { title: plural(keys.length, "item") + " selected",
      items: [...vis.map((v) => ({ plate: plate(v.vrn), text: `${fmtDay(fromKey(v.dk))} · ${E.range(v.start, v.end)}`, pill: "Booked" })), ...ents.map((e) => ({ plate: plate(e.vrn), text: `${fmtDay(fromKey(e.dk))} · ${E.range(e.from, e.to)}`, pill: "Planned" }))],
      note: vis.length > cancellable.length ? `${vis.length - cancellable.length} of the bookings can't be cancelled: they've started, or the council site doesn't allow it.` : "",
      action: what ? what[0].toUpperCase() + what.slice(1) : "", cancels: cancellable.length > 0, single: keys.length === 1 ? keys[0] : null };
  }

  // Every booking and planned item, for the list tab: filtered by vehicle, finished ones only when asked.
  // Planned items and upcoming bookings the council lets you cancel can be picked for bulk changes.
  function list(o) {
    const repl = E.replacedSet(), vrns = o.vrns || [];
    const why = { live: "In progress. Open it to end early.", past: "Finished.", up: "The council site doesn't allow changing this booking." };
    const rows = [
      ...E.visits().map((v) => {
        const st = E.status(v.dk, v.start, v.end), pick = st === "up" && v.items.every((i) => i.cancellable);
        return { ...visitRow(v, repl), sel: "b:" + E.vkey(v), pick, why: pick ? null : why[st], past: st === "past" };
      }),
      ...S.entries.map((e) => ({ ...entryRow(e), sel: "e:" + e.id, pick: true, why: null, past: false }))
    ];
    const byName = (a, b) => E.byVehicle(E.vehicle(a.vrn), E.vehicle(b.vrn)) || byTime(a, b);
    const shown = rows.filter((r) => (!vrns.length || vrns.includes(r.vrn)) && (o.past || !r.past)).sort(o.sort === "name" ? byName : byTime);
    const vehicles = [...new Set(rows.map((r) => r.vrn))].map((vrn) => E.vehicle(vrn)).sort(E.byVehicle)
      .map((v) => ({ vrn: v.vrn, plate: plate(v.vrn), name: nameOf(v), on: vrns.includes(v.vrn) }));
    return { rows: shown, vehicles, summary: `${shown.length} of ${rows.length} shown.`, empty: rows.length ? "Nothing matches the filter." : "No bookings yet." };
  }
  // What a bulk time change would do, worded like the extension's preview. Set mode starts from the first item's times.
  function bulkTimes(keys, spec) {
    const first = keys.map((k) => k.startsWith("e:") ? S.entries.find((e) => "e:" + e.id === k) : E.findVisit(k.slice(2))).find(Boolean);
    const f0 = first ? (first.from != null ? first.from : first.start) : 600, t0 = first ? (first.to != null ? first.to : first.end) : 660;
    const s = { mode: spec.mode === "shift" ? "shift" : "set", from: spec.from == null || spec.from < 0 ? f0 : +spec.from, to: spec.to == null || spec.to < 0 ? t0 : +spec.to, shift: +spec.shift || 0 };
    const dks = keys.map((k) => k.startsWith("e:") ? (S.entries.find((e) => "e:" + e.id === k) || {}).dk : (E.findVisit(k.slice(2)) || {}).dk).filter(Boolean);
    const base = { from: s.from, to: s.to, limits: limits(dks) };
    if (s.mode === "shift" && !s.shift) return { ...base, ok: 0, text: "Choose how many minutes to move by.", bad: [], apply: "Apply" };
    const { ok, bad } = E.bulkTimes(keys, s), nb = ok.filter((x) => !x.ent).length;
    return { ...base, ok: ok.length,
      text: ok.length ? `${ok.length} will change${nb ? ` (${plural(nb, "booking")} ${nb > 1 ? "go" : "goes"} into your plan to be cancelled and rebooked)` : ""}.` : "None of the selected can change to that.",
      bad: bad.map((b) => `${fmtDay(fromKey(b.x.dk))} ${hm(b.f0)} · ${nameOf(E.vehicle(b.x.vrn))}: ${b.err}`),
      apply: ok.length ? `Apply to ${ok.length}` : "Apply" };
  }

  // ---------- quick-book ----------
  function quick(q) {
    const pv = E.quickPreview(q), sel = E.quickSel(q);
    return {
      q, when: q.when, presets: E.quickPresets(q), days: q.when === "days" ? E.quickDays(q) : null,
      from: sel.from, to: sel.to, fromText: hm(sel.from), toText: hm(sel.to), fromEditable: q.when !== "now", limits: limits(sel.days),
      note: q.when === "now" ? "Starts now. Hours outside controls are skipped; no voucher is needed then." : "Hours outside controls are skipped; no voucher is needed then.",
      vehicles: q.vrns.map((vrn) => { const v = E.vehicle(vrn); return { vrn, plate: plate(vrn), name: E.isFav(v) ? v.nick : plate(vrn) }; }),
      preview: { text: pv.text, notes: pv.notes, ok: pv.ok, bad: pv.bad, canAdd: pv.cands.length > 0, canBook: pv.ok }
    };
  }
  function confirm(q, email) {
    const pv = E.quickPreview(q); if (!pv.cands.length) return null;
    const need = { h1: 0, h5: 0, day: 0 }; for (const it of pv.items) if (it.need) for (const k of KINDS) need[k] += it.need[k];
    const n = need.h1 + need.h5 + need.day, days = [...new Set(pv.cands.map((c) => c.dk))], c0 = pv.cands[0], test = S.settings.testMode;
    const one = q.vrns.length === 1 ? E.vehicle(q.vrns[0]) : null;
    return {
      plate: one ? plate(one.vrn) : null, name: one ? nameOf(one) : null, plates: q.vrns.map(plate),
      dayLabel: days.length > 1 ? "Days" : "Day", dayText: days.length > 2 ? plural(days.length, "day") + ", from " + fmtDay(fromKey(days[0])) : days.map((d) => (d === E.TK() ? "Today, " : "") + fmtDay(fromKey(d))).join(" and "),
      timeText: E.range(c0.from, c0.to) + (q.when === "now" ? ", starting now" : ""), vouchersText: E.typesText(need), email: !!email, test,
      note: test ? "Test mode: this checks the booking with the council site but doesn't book it or use a voucher." : "This books for real on the council site. Once a voucher starts it can't be cancelled.",
      goLabel: test ? "Run test" : `Book ${plural(n, "voucher")}`
    };
  }

  // ---------- review and run ----------
  function run() {
    const R0 = S.run; if (!R0) return null;
    const { ops, nBook, nCancel } = R0.run, test = R0.test;
    const what = [nBook && `book ${plural(nBook, "voucher")}`, nCancel && `cancel ${nCancel}`].filter(Boolean).join(", ");
    const cap = (x) => x[0].toUpperCase() + x.slice(1);
    const title = R0.phase === "review" ? (test ? "Test your plan" : "Review plan") : R0.phase === "running" ? (test ? "Testing" : "Running plan")
      : test ? (R0.failed ? "Test stopped" : "Test passed") : R0.failed ? "Stopped" : R0.paused ? "Paused" : R0.stop ? "Stopped" : "Done";
    return {
      phase: R0.phase, test, title, tag: test || S.settings.testMode ? "Test mode" : "Live", balance: E.balanceText(),
      heading: test ? "Check " + what : cap(what), goLabel: test ? "Run test" : cap(what),
      progress: Math.round((Math.min(R0.sent, R0.total) / R0.total) * 100), label: R0.label || "Starting", stopping: !!R0.stop && R0.phase === "running",
      ops: ops.map((o, i) => {
        const s = R0.stat[i];
        if (o.kind === "cancel") { const b0 = o.bookings[0], bl = o.bookings[o.bookings.length - 1]; return { kind: "cancel", tag: "Cancel", plate: plate(o.vrn), text: `${fmtDay(fromKey(o.dk))} · ${E.range(b0.start, bl.start + bl.mins)}`, status: s.cls, statusText: s.txt, err: s.err || null }; }
        const a = o.a;
        return { kind: "book", tag: VT[a.type].short, plate: plate(a.vrn), text: `${fmtDay(fromKey(a.dk))} · ${a.type === "day" ? "all day" : hm(a.start)}`, status: s.cls, statusText: s.txt, err: s.err || null };
      }),
      info: "Each step goes to the council site one at a time, about half a second apart. Keep Voucherboard open until it finishes. If a step fails, the run stops and the rest stays in your plan.",
      modeNote: test ? "Test mode: every check runs with the council site, but nothing is booked or cancelled and no vouchers are used." : "Live mode: this books for real. Turn on test mode in More to check a plan without booking.",
      note: R0.note || "", failed: !!R0.failed, ok: R0.phase === "done" && !R0.failed && !R0.stop, reminder: R0.reminder || null,
      canResume: R0.phase === "done" && !!R0.stop && S.entries.length > 0, hasReport: !!R0.report
    };
  }

  // ---------- more ----------
  function more() {
    const usable = S.permits.filter(W.isUsableVisitorPermit);
    return {
      permits: usable.length > 1 ? usable.map((p) => ({ id: p.id, label: `${p.ref} · ${p.zoneName.split(" - ")[0]}`, selected: p.id === S.permitId })) : [],
      subzones: S.subzones.map((z) => ({ code: z.code, label: `${z.code} · ${z.name}`, selected: !!(S.zone && S.zone.code === z.code) })),
      settings: { ...S.settings }, leads: [5, 10, 15, 30], hasReport: !!S.lastReport, issuesUrl: ISSUES_URL,
      footer: `Voucherboard Beta${S.version ? " v" + S.version : ""}. © 2026 ${T.OWNER}. An independent tool, not made or endorsed by Lewisham Council. You use it entirely at your own risk.`
    };
  }
  const terms = () => ({ html: T.html, version: T.VERSION, owner: T.OWNER });

  root.VB.views = { home, today, calendar, agenda, day, board, vehicles, vehicle, suggest, plan, entry, visit, bulk, list, bulkTimes, quick, confirm, run, more, terms };
})(typeof globalThis !== "undefined" ? globalThis : this);
