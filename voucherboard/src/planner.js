// Planning: turns requested visits into voucher activations. Pure functions, no DOM or network.
(function (root) {
  "use strict";
  const Zs = (root.VB && root.VB.zones) || (typeof require === "function" ? require("./zones.js") : null);

  // Voucher types. Prices are not stored here: they are read from the portal's buy page at run time
  // and passed in as ctx.prices = { h1: { price, book, periodPriceId }, ... }.
  const VT = {
    h1: { label: "1 hour", short: "1h", mins: 60 },
    h5: { label: "5 hours", short: "5h", mins: 300 },
    day: { label: "1 day", short: "Day", mins: null }
  };
  const KINDS = ["h1", "h5", "day"];
  const WINDOW_DAYS = 28; // e-permits can be booked 28 days ahead
  const LAST_MIN = 23 * 60 + 59;

  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fromKey = (k) => { const [a, b, c] = k.split("-").map(Number); return new Date(a, b - 1, c); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isoDow = (d) => { const w = d.getDay(); return w === 0 ? 7 : w; };
  const hm = (m) => pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60);
  // Total price of a voucher mix, or null when any needed price is unknown.
  const valueOf = (u, prices) => {
    let sum = 0;
    for (const k of KINDS) {
      if (!u[k]) continue;
      const p = prices && prices[k] && prices[k].price;
      if (p == null) return null;
      sum += u[k] * p;
    }
    return sum;
  };
  const fmtMins = (m) => { const h = Math.floor(m / 60), mm = m % 60; return ((h ? h + " h" : "") + (h && mm ? " " : "") + (mm ? mm + " min" : "")) || "0 min"; };

  // Controlled periods on a date. null means the zone's hours are unknown.
  function controls(zone, d) {
    if (!zone) return null;
    return zone.rules.filter((r) => r.d.includes(isoDow(d))).map((r) => ({ f: r.f, t: r.t }));
  }
  function inWindow(today, d) { const k = key(d); return k >= key(today) && k <= key(addDays(today, WINDOW_DAYS)); }

  function subtract(segs, busy) {
    let out = segs.map((s) => ({ ...s }));
    for (const b of busy) {
      const n = [];
      for (const s of out) {
        if (b.t <= s.f || b.f >= s.t) { n.push(s); continue; }
        if (b.f > s.f) n.push({ f: s.f, t: b.f });
        if (b.t < s.t) n.push({ f: b.t, t: s.t });
      }
      out = n;
    }
    return out.filter((s) => s.t - s.f > 0);
  }
  function intersect(a, b) {
    const o = [];
    for (const x of a) for (const y of b) { const f = Math.max(x.f, y.f), t = Math.min(x.t, y.t); if (t > f) o.push({ f, t }); }
    return o;
  }
  const total = (segs) => segs.reduce((a, s) => a + s.t - s.f, 0);

  // Voucher type a booking used, from its length.
  const bookingType = (b) => b.type || (b.mins >= 23 * 60 ? "day" : b.mins >= 300 ? "h5" : "h1");

  // Bookings that planned changes will cancel, by id. Only bookings that still exist count.
  function replacedIds(ctx, entries) {
    const ids = new Set();
    for (const e of entries) if (!e.pending && e.replaces) for (const id of e.replaces) if (ctx.bookings.some((b) => b.id === id)) ids.add(id);
    return ids;
  }
  // Unused vouchers plus the ones that planned cancellations give back.
  function effectiveBalance(ctx, entries, balance) {
    const out = { h1: balance.h1 || 0, h5: balance.h5 || 0, day: balance.day || 0 };
    const ids = replacedIds(ctx, entries);
    for (const b of ctx.bookings) if (ids.has(b.id)) { const k = bookingType(b); if (k in out) out[k]++; }
    return out;
  }

  // Existing bookings for one vehicle on one day, as covered intervals. Bookings being replaced don't count.
  function bookedBusy(ctx, vrn, dk, skip) {
    const out = [];
    for (const b of ctx.bookings) {
      if (b.vrn !== vrn || b.date !== dk || (skip && skip.has(b.id))) continue;
      out.push({ f: b.start, t: b.start + b.mins });
    }
    return out;
  }

  // All voucher combinations that cover the segments.
  function options(segs, ctl) {
    const opts = [];
    if (!total(segs)) return opts;
    const perSeg = segs.map((s) => {
      const m = s.t - s.f, res = [];
      for (let a = 0; a <= Math.ceil(m / 300); a++) {
        if (a > 0 && 300 * (a - 1) >= m) break;
        res.push({ a, b: Math.ceil(Math.max(0, m - 300 * a) / 60) });
      }
      return { s, res };
    });
    let combos = [[]];
    for (const ps of perSeg) {
      const n = [];
      for (const c of combos) for (const r of ps.res) n.push(c.concat([{ s: ps.s, ...r }]));
      combos = n.slice(0, 200);
    }
    for (const c of combos) {
      const a = c.reduce((x, y) => x + y.a, 0), b = c.reduce((x, y) => x + y.b, 0), acts = [];
      for (const p of c) {
        let t = p.s.f;
        for (let i = 0; i < p.a; i++) { acts.push({ type: "h5", start: t }); t += 300; }
        for (let i = 0; i < p.b; i++) { acts.push({ type: "h1", start: t }); t += 60; }
      }
      opts.push({ need: { h1: b, h5: a, day: 0 }, count: a + b, acts });
    }
    if (ctl && ctl.length) opts.push({ need: { h1: 0, h5: 0, day: 1 }, count: 1, acts: [{ type: "day", start: Math.max(ctl[0].f, segs[0].f) }] });
    return opts;
  }
  function choose(opts, left, strategy, prices) {
    const fits = opts.filter((o) => o.need.h1 <= left.h1 && o.need.h5 <= left.h5 && o.need.day <= left.day);
    if (!fits.length) return null;
    // Without prices, fall back to the fewest vouchers.
    const heavy = (o) => o.need.h5 * 5 + o.need.day * 10, cost = (o) => { const v = valueOf(o.need, prices); return v == null ? o.count : v; };
    fits.sort((x, y) => strategy === "save"
      ? (heavy(x) - heavy(y)) || (cost(x) - cost(y))
      : (cost(x) - cost(y)) || (x.count - y.count));
    return fits[0];
  }

  // Composer selection -> one candidate entry per vehicle and day. Today never starts before `now`.
  function candidates(ctx, sel, entries) {
    if (!sel.vrns.length || !sel.days.length || sel.from == null || sel.to == null || sel.to <= sel.from) return [];
    const tk = key(ctx.today), out = [];
    for (const dk of [...sel.days].sort()) for (const vrn of sel.vrns) {
      let f = sel.from, t = sel.to;
      if (dk === tk && f < ctx.now) { const d = t - f; f = ctx.now; t = Math.min(LAST_MIN, ctx.now + d); }
      if (entries.some((e) => e.vrn === vrn && e.dk === dk && e.from === f && e.to === t)) continue;
      out.push({ id: "c:" + vrn + dk, vrn, dk, from: f, to: t, pending: true, shifted: f !== sel.from });
    }
    return out;
  }

  // Move today's planned entries forward once their start has passed. Mutates entries.
  function advanceEntries(ctx, entries) {
    const tk = key(ctx.today);
    for (const e of entries) {
      if (e.dk < tk) e.expired = true;
      if (e.dk === tk && e.from < ctx.now) {
        const d = e.to - e.from;
        e.movedFrom = e.movedFrom != null ? e.movedFrom : e.from;
        e.from = ctx.now; e.to = Math.min(LAST_MIN, ctx.now + d);
      }
    }
    return entries.filter((e) => !e.expired);
  }

  // Allocate vouchers to entries in order. Earlier entries' vouchers count as cover for later ones.
  function allocate(ctx, list, balance, strategy) {
    const skip = replacedIds(ctx, list);
    const left = effectiveBalance(ctx, list, balance);
    let cancels = 0;
    const used = { h1: 0, h5: 0, day: 0 };
    const cover = {}, items = [];
    let short = 0;
    const sorted = [...list].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.dk.localeCompare(b.dk) || a.from - b.from);
    for (const e of sorted) {
      const d = fromKey(e.dk), ctl = controls(ctx.zone, d), notes = [], ck = e.vrn + "|" + e.dk;
      if (e.movedFrom != null) notes.push({ c: "warn", t: `Moved to ${hm(e.from)} because ${hm(e.movedFrom)} has passed.` });
      const repl = (e.replaces || []).filter((id) => skip.has(id));
      if (!e.pending && repl.length) {
        cancels += repl.length;
        const rb = ctx.bookings.filter((b) => repl.includes(b.id)).sort((a, b) => a.start - b.start);
        notes.push({ c: "warn", t: `Replaces the booking at ${hm(rb[0].start)}–${hm(rb[rb.length - 1].start + rb[rb.length - 1].mins)}. It's cancelled first and its ${rb.length} voucher${rb.length > 1 ? "s go" : " goes"} back to your unused vouchers.` });
      }
      if (e.shifted) notes.push({ c: "warn", t: `Today starts at ${hm(e.from)} because the chosen time has passed.` });
      const req = { f: e.from, t: e.to };
      let segs = ctl ? intersect([req], ctl) : [req];
      if (!ctl) notes.push({ c: "warn", t: "This zone's hours aren't known here. The council site checks each start time." });
      else if (!ctl.length) notes.push({ c: "", t: "No controls this day. No voucher needed." });
      else { const skipped = (req.t - req.f) - total(segs); if (skipped > 0) notes.push({ c: "", t: `${fmtMins(skipped)} outside controlled hours skipped.` }); }
      if (Zs.BANK_HOLIDAYS[e.dk]) notes.push({ c: "warn", t: `${Zs.BANK_HOLIDAYS[e.dk]}. Check street signs; controls may not apply.` });
      const b0 = total(segs);
      segs = subtract(segs, bookedBusy(ctx, e.vrn, e.dk, skip));
      const b1 = total(segs);
      if (b0 > b1) notes.push({ c: "", t: `${fmtMins(b0 - b1)} already booked for this vehicle.` });
      segs = subtract(segs, cover[ck] || []);
      const after = total(segs);
      if (b1 > after) notes.push({ c: "", t: `${fmtMins(b1 - after)} already covered by another planned booking.` });
      const opt = choose(options(segs, ctl), left, strategy, ctx.prices);
      if (after > 0 && !opt) {
        const need = Math.ceil(after / 60);
        if (!e.pending) short += need;
        notes.push({ c: "bad", t: `Not enough vouchers left (needs ${need} × 1 hour).` });
      }
      if (opt) {
        for (const k of KINDS) { left[k] -= opt.need[k]; if (!e.pending) used[k] += opt.need[k]; }
        const cv = cover[ck] = cover[ck] || [];
        for (const a of opt.acts) {
          if (a.type === "day") (ctl || []).forEach((c) => cv.push({ f: c.f, t: c.t }));
          else cv.push({ f: a.start, t: a.start + VT[a.type].mins });
        }
        const covered = opt.acts.reduce((a, x) => a + (x.type === "day" ? 0 : VT[x.type].mins), 0);
        if (opt.need.day === 0 && covered > after) notes.push({ c: "", t: `Last voucher runs ${fmtMins(covered - after)} past ${hm(Math.max(...segs.map((x) => x.t)))}.` });
      }
      items.push({ entry: e, dk: e.dk, vrn: e.vrn, acts: opt ? opt.acts : [], need: opt ? opt.need : null, bill: after, notes, pending: !!e.pending, replaces: e.pending ? [] : repl });
    }
    const n = used.h1 + used.h5 + used.day;
    return { items, used, short, count: n, cancels, cost: valueOf(used, ctx.prices), ready: (n > 0 || cancels > 0) && short === 0 };
  }

  // What to buy so the plan can use the cheapest mix, and what that saves. null when nothing to suggest.
  function purchaseAdvice(ctx, entries, plan, balance) {
    if (!ctx.prices) return null;
    const inf = {}, raw = balance;
    balance = effectiveBalance(ctx, entries, raw);
    for (const k of KINDS) inf[k] = ctx.prices[k] ? 1e4 : (raw[k] || 0); // allocate adds returned vouchers itself
    const ideal = allocate(ctx, entries, inf, "cheapest");
    if (!ideal.count) return null;
    const buy = { h1: 0, h5: 0, day: 0 };
    let any = false;
    for (const k of KINDS) {
      const lack = ideal.used[k] - (balance[k] || 0);
      if (lack > 0) {
        if (!ctx.prices[k]) return null; // can't be bought on this permit
        const book = ctx.prices[k].book || 1;
        buy[k] = Math.ceil(lack / book) * book; any = true;
      }
    }
    if (!any || ideal.cost == null) return null;
    const saving = plan.short || plan.cost == null ? null : plan.cost - ideal.cost;
    if (saving !== null && saving < 0.005) return null;
    return { buy, saving, idealCost: ideal.cost, ideal };
  }

  // Ways to end a booking in progress early: only vouchers that haven't started can be cancelled.
  // items: one booking's vouchers in time order. Returns [{ end, cancel: [ids] }], latest end first.
  function shrinkOptions(items, now) {
    const i = items.findIndex((b) => b.start <= now && now < b.start + b.mins);
    if (i < 0) return [];
    const out = [];
    for (let k = items.length - 2; k >= i; k--) {
      const later = items.slice(k + 1);
      if (!later.every((b) => b.start >= now && b.cancellable)) break;
      out.push({ end: items[k].start + items[k].mins, cancel: later.map((b) => b.id) });
    }
    return out;
  }

  // Flatten a plan into activations in booking order.
  function activations(plan) {
    const acts = [];
    for (const it of plan.items) if (!it.pending) for (const a of it.acts) acts.push({ ...a, vrn: it.vrn, dk: it.dk, eid: it.entry.id });
    return acts.sort((a, b) => a.dk.localeCompare(b.dk) || a.start - b.start);
  }

  const api = { VT, KINDS, WINDOW_DAYS, LAST_MIN, key, fromKey, addDays, isoDow, hm, pad, fmtMins, valueOf,
    controls, inWindow, subtract, intersect, options, choose, candidates, advanceEntries, allocate, purchaseAdvice, activations, bookingType, replacedIds, effectiveBalance, shrinkOptions };
  root.VB = root.VB || {};
  root.VB.planner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
