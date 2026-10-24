// Planning: turns requested visits into voucher activations. Pure functions, no DOM or network.
(function (root) {
  "use strict";
  const Zs = (root.VB && root.VB.zones) || (typeof require === "function" ? require("./zones.js") : null);

  // Voucher types. Prices are not stored here: they are read from the portal's buy page at run time
  // and passed in as ctx.prices = { h1: { price, book, periodPriceId }, ... }.
  // A day voucher runs 24 hours and a week voucher 7 days from their start, as the council site shows them
  // (10:00 to 09:59 the next day). The planner only picks a week voucher when the user chooses one (entry.kind).
  const VT = {
    h1: { label: "1 hour", short: "1h", mins: 60 },
    h5: { label: "5 hours", short: "5h", mins: 300 },
    day: { label: "1 day", short: "Day", mins: 1440 },
    week: { label: "1 week", short: "Week", mins: 7 * 1440 }
  };
  const KINDS = ["h1", "h5", "day", "week"];
  const zero = () => Object.fromEntries(KINDS.map((k) => [k, 0]));
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
  // Whether a voucher can start at minute m of day dk: the council site only takes starts while controls apply,
  // whatever the voucher's length (seen live: a week voucher at 09:21 in a 10:00–12:00 zone was refused). True when the
  // zone's hours aren't known, so the site's own check decides.
  function inControls(zone, dk, m) { const c = controls(zone, fromKey(dk)); return !c || c.some((x) => x.f <= m && m < x.t); }
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
  const bookingType = (b) => b.type || (b.mins > 1440 ? "week" : b.mins >= 23 * 60 ? "day" : b.mins >= 300 ? "h5" : "h1");
  // Whole days from day key a to day key b.
  const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
  // A booking's part on day dk, cut to that day, or null. Day and week vouchers reach into later days; a part
  // on a later day notes the day it started in `from`.
  function onDay(b, dk) {
    const off = daysBetween(b.date, dk) * 1440, f = Math.max(0, b.start - off), t = Math.min(1440, b.start + b.mins - off);
    return t > f ? { ...b, type: bookingType(b), date: dk, start: f, mins: t - f, ...(off ? { from: b.date } : {}) } : null;
  }
  const bookingsOn = (list, dk) => list.map((b) => onDay(b, dk)).filter(Boolean);
  // "past", "live" or "up" for minutes f to t of day dk. t can run past midnight.
  function status(today, now, dk, f, t) {
    const off = daysBetween(key(today), dk) * 1440;
    return off + t <= now ? "past" : off + f <= now ? "live" : "up";
  }
  // Time a booking covers on the day it starts.
  const span = (b) => ({ f: b.start, t: Math.min(1440, b.start + b.mins) });

  // Bookings that planned changes will cancel, by id. Only bookings that still exist count.
  function replacedIds(ctx, entries) {
    const ids = new Set();
    for (const e of entries) if (!e.pending && e.replaces) for (const id of e.replaces) if (ctx.bookings.some((b) => b.id === id)) ids.add(id);
    return ids;
  }
  // Unused vouchers plus the ones that planned cancellations give back.
  function effectiveBalance(ctx, entries, balance) {
    const out = Object.fromEntries(KINDS.map((k) => [k, balance[k] || 0]));
    const ids = replacedIds(ctx, entries);
    for (const b of ctx.bookings) if (ids.has(b.id)) { const k = bookingType(b); if (k in out) out[k]++; }
    return out;
  }

  // Existing bookings for one vehicle on one day, as covered intervals. Bookings being replaced don't count.
  function bookedBusy(ctx, vrn, dk, skip) {
    return bookingsOn(ctx.bookings.filter((b) => b.vrn === vrn && !(skip && skip.has(b.id))), dk).map((b) => ({ f: b.start, t: b.start + b.mins }));
  }

  // All voucher combinations that cover the segments. kind, when the user chose one, allows only that type; a week
  // voucher is only ever used then. Each starts at a controlled minute: the start of a segment.
  function options(segs, ctl, kind) {
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
      opts.push({ need: { ...zero(), h1: b, h5: a }, count: a + b, acts });
    }
    const first = Math.min(...segs.map((s) => s.f));
    if ((ctl && ctl.length) || kind === "day") opts.push({ need: { ...zero(), day: 1 }, count: 1, acts: [{ type: "day", start: first }] });
    if (kind === "week") opts.push({ need: { ...zero(), week: 1 }, count: 1, acts: [{ type: "week", start: first }] });
    return kind ? opts.filter((o) => KINDS.every((k) => k === kind || !o.need[k])) : opts;
  }
  // Orders voucher mixes ({ need, count }) cheapest first. Without prices, fall back to the fewest vouchers.
  function byCost(prices) {
    const cost = (o) => { const v = valueOf(o.need, prices); return v == null ? o.count : Math.round(v * 100); };
    return (x, y) => (cost(x) - cost(y)) || (x.count - y.count);
  }
  function choose(opts, left, prices) {
    const fits = opts.filter((o) => KINDS.every((k) => o.need[k] <= left[k]));
    if (!fits.length) return null;
    return fits.sort(byCost(prices))[0];
  }

  // Composer selection -> one candidate entry per vehicle and day. Today never starts before `now`.
  // A start-to-end booking (sel.stay) is one day whose `to` can run past midnight, in minutes from that day's start; a
  // start that has passed moves to now and its end stays.
  function candidates(ctx, sel, entries) {
    if (!sel.vrns.length || !sel.days.length || sel.from == null || sel.to == null || sel.to <= sel.from) return [];
    const tk = key(ctx.today), out = [];
    for (const dk of [...sel.days].sort()) for (const vrn of sel.vrns) {
      let f = sel.from, t = sel.to;
      if (dk === tk && f < ctx.now) {
        if (sel.stay || t > 1440) { if (t <= ctx.now) continue; f = ctx.now; }
        else { const d = t - f; f = ctx.now; t = Math.min(LAST_MIN, ctx.now + d); }
      }
      if (entries.some((e) => e.vrn === vrn && e.dk === dk && e.from === f && e.to === t && (e.kind || "") === (sel.kind || ""))) continue;
      out.push({ id: "c:" + vrn + dk, vrn, dk, from: f, to: t, pending: true, shifted: f !== sel.from, ...(sel.kind ? { kind: sel.kind } : {}) });
    }
    return out;
  }

  // Move today's planned entries forward once their start has passed. Mutates entries.
  function advanceEntries(ctx, entries) {
    const tk = key(ctx.today);
    for (const e of entries) {
      if (e.dk < tk && e.to > 1440) { // a start-to-end booking that began on an earlier day goes on from today
        const off = daysBetween(e.dk, tk) * 1440;
        if (e.to - off > ctx.now) { e.dk = tk; e.from = Math.max(0, e.from - off); e.to -= off; }
      }
      if (e.dk < tk) e.expired = true;
      if (e.dk === tk && e.from < ctx.now && e.to > 1440) { e.from = ctx.now; continue; } // its end stays
      if (e.dk === tk && e.from < ctx.now) {
        const d = e.to - e.from;
        e.movedFrom = e.movedFrom != null ? e.movedFrom : e.from;
        e.from = ctx.now; e.to = Math.min(LAST_MIN, ctx.now + d);
      }
    }
    return entries.filter((e) => !e.expired);
  }

  // A start-to-end booking's part on each day it covers, each pointing back to it in `of`.
  function dayParts(e) {
    if (e.to <= 1440) return [e];
    const out = [], d = fromKey(e.dk);
    for (let i = 0; i * 1440 < e.to; i++) {
      const f = i ? 0 : e.from, t = Math.min(1440, e.to - i * 1440), p = { ...e, dk: key(addDays(d, i)), from: f, to: t, of: e };
      if (i) { delete p.shifted; delete p.movedFrom; delete p.replaces; } // the bookings it changes start on its first day
      if (t > f) out.push(p);
    }
    return out;
  }
  // Puts a start-to-end booking's day parts back into one item. Its vouchers carry their day in `dk`.
  function joinParts(ctx, items) {
    const out = [], by = new Map();
    for (const it of items) {
      const e = it.entry.of;
      if (!e) { out.push(it); continue; }
      if (!by.has(e)) { const m = { entry: e, dk: e.dk, vrn: e.vrn, acts: [], need: null, bill: 0, notes: [], pending: it.pending, replaces: [], parts: [] }; by.set(e, m); out.push(m); }
      const m = by.get(e);
      m.acts.push(...it.acts.map((a) => ({ ...a, dk: it.dk })));
      if (it.need) { m.need = m.need || zero(); for (const k of KINDS) m.need[k] += it.need[k] || 0; }
      m.bill += it.bill; m.replaces.push(...it.replaces); m.parts.push(it);
    }
    for (const m of by.values()) {
      let ctl = 0, n = 0, lack = 0, lk = "";
      for (const it of m.parts) { const c = controls(ctx.zone, fromKey(it.dk)), x = c ? total(intersect([{ f: it.entry.from, t: it.entry.to }], c)) : 0; ctl += x; n += x > 0; if (it.lack) { lack += it.lack.n; lk = it.lack.k; } }
      const known = m.parts.every((it) => controls(ctx.zone, fromKey(it.dk))), notes = [];
      if (known) notes.push(ctl ? { c: "", t: `${fmtMins(ctl)} of controlled hours over ${n} day${n > 1 ? "s" : ""}. The rest needs no voucher.` } : { c: "", t: "No controls in this time. No voucher needed." });
      for (const it of m.parts) for (const x of it.notes) if (x.c !== "bad" && !/outside controlled hours skipped|^No controls this day/.test(x.t) && !notes.some((y) => y.t === x.t)) notes.push(x);
      if (lack) notes.push({ c: "bad", t: `Not enough vouchers left (needs ${lack} × ${VT[lk].label}).` });
      m.notes = notes; delete m.parts;
    }
    return out;
  }

  // Allocate vouchers to entries in order. Earlier entries' vouchers count as cover for later ones. A start-to-end
  // booking is planned day by day, so day and week vouchers are worked out across its days, then shown as one item.
  function allocate(ctx, entries, balance) {
    const list = entries.flatMap(dayParts);
    const skip = replacedIds(ctx, list);
    const left = effectiveBalance(ctx, list, balance);
    let cancels = 0;
    const used = zero(), kept = zero();
    const cover = {}, items = [];
    let short = 0;
    const sorted = [...list].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || a.dk.localeCompare(b.dk) || a.from - b.from);
    // The time an entry still needs: inside controls, not booked, not covered by entries placed before it.
    const needed = (e) => { const ctl = controls(ctx.zone, fromKey(e.dk)); return subtract(subtract(ctl ? intersect([{ f: e.from, t: e.to }], ctl) : [], bookedBusy(ctx, e.vrn, e.dk, skip)), cover[e.vrn + "|" + e.dk] || []); };
    // Planned entries first, then the composer's preview. In each, entries with a chosen type or a booking to change
    // go first; the rest get their day and week vouchers worked out across days. A smart replan's changes (e.smart) are
    // worked out across days too: that's what they're for.
    const own = (e) => !!e.kind || !!(e.replaces && e.replaces.length && !e.smart) || !controls(ctx.zone, fromKey(e.dk));
    for (const batch of [sorted.filter((e) => !e.pending), sorted.filter((e) => e.pending)]) {
      for (const e of batch.filter(own)) place(e, []);
      const rest = batch.filter((e) => !own(e)), long = acrossDays(ctx, rest, left, needed);
      for (const acts of long.values()) for (const a of acts) left[a.type]--; // held for their entries, so earlier days can't take them
      for (const e of rest) { const f = long.get(e) || []; for (const a of f) left[a.type]++; place(e, f); }
    }
    function place(e, forced) {
      const d = fromKey(e.dk), ctl = controls(ctx.zone, d), notes = [], ck = e.vrn + "|" + e.dk;
      if (e.movedFrom != null) notes.push({ c: "warn", t: `Moved to ${hm(e.from)} because ${hm(e.movedFrom)} has passed.` });
      const rb = e.pending ? [] : ctx.bookings.filter((b) => (e.replaces || []).includes(b.id) && skip.has(b.id)).sort((a, b) => a.start - b.start);
      const noteAt = notes.length;
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
      let lack = null, plan = null; // { keep: booked vouchers kept, acts: new ones, need: every voucher the time uses }
      let best;
      forced = forced.filter((a) => segs.some((x) => x.f <= a.start && a.start < x.t)); // still needed
      if (forced.length) { // day and week vouchers chosen across days, and the cheapest mix for the rest of this day
        const need = zero(); for (const a of forced) need[a.type]++;
        const lft = Object.fromEntries(KINDS.map((k) => [k, left[k] - need[k]]));
        const rest = subtract(segs, forced.map((a) => ({ f: a.start, t: Math.min(1440, a.start + VT[a.type].mins) })));
        const fill = total(rest) ? choose(options(rest, ctl), lft, ctx.prices) : { need: zero(), acts: [] };
        if (fill) { for (const k of KINDS) need[k] += fill.need[k] || 0; best = { need, acts: [...forced, ...fill.acts].sort((a, b) => a.start - b.start), count: forced.length + fill.acts.length }; }
      } else best = choose(options(segs, ctl, e.kind), left, ctx.prices);
      if (best) {
        // A planned voucher identical to one in the booking being changed keeps that one: no cancel, no new booking.
        const all = rb.length ? arrange(best.acts, rb) : best.acts, keep = [];
        const acts = all.filter((a) => { const b = rb.find((x) => !keep.includes(x) && bookingType(x) === a.type && x.start === a.start); return !(b && keep.push(b)); });
        plan = { keep, acts, need: best.need, count: all.length };
      }
      // Booked vouchers that overlap the new time already pay for it. Keeping them and booking only the gaps wins when
      // it costs no more, e.g. 10:00–12:00 changed to 10:30–12:00.
      // A voucher type the user chose wins over keeping other types.
      // Not against day and week vouchers chosen across days: they pay off over several days, not this one.
      const over = forced.length ? [] : rb.filter((b) => segs.some((x) => span(b).f < x.t && span(b).t > x.f) && (!e.kind || bookingType(b) === e.kind));
      if (over.length) {
        const need = zero();
        for (const b of over) { const k = bookingType(b); if (k in need) need[k]++; }
        const gaps = subtract(segs, over.map(span));
        const fill = total(gaps) ? choose(options(gaps, ctl, e.kind), Object.fromEntries(KINDS.map((k) => [k, left[k] - need[k]])), ctx.prices) : { need: {}, acts: [] };
        if (fill) {
          for (const k of KINDS) need[k] += fill.need[k] || 0;
          const alt = { keep: over, acts: fill.acts, need, count: over.length + fill.acts.length };
          if (!plan || byCost(ctx.prices)(alt, plan) <= 0) plan = alt;
        }
      }
      if (after > 0 && !plan) {
        const k = e.kind || "h1", need = k === "h1" ? Math.ceil(after / 60) : k === "h5" ? segs.reduce((n, x) => n + Math.ceil((x.t - x.f) / 300), 0) : 1;
        if (!e.pending) short += need;
        lack = { k, n: need };
        notes.push({ c: "bad", t: `Not enough vouchers left (needs ${need} × ${VT[k].label}).` });
      }
      const keep = plan ? plan.keep : [], acts = plan ? plan.acts : [];
      const repl = rb.filter((b) => !keep.includes(b)).map((b) => b.id);
      if (rb.length) { cancels += repl.length; notes.splice(noteAt, 0, { c: "warn", t: changeNote(rb, keep) }); }
      let need = null, bill = after;
      if (plan) {
        need = { ...plan.need };
        for (const b of keep) { const k = bookingType(b); if (k in need) { need[k]--; kept[k]++; } }
        if (!acts.length) need = null;
        bill = total(subtract(segs, keep.map(span)));
        for (const k of KINDS) { left[k] -= plan.need[k] || 0; if (!e.pending && need) used[k] += need[k] || 0; }
        const cv = cover[ck] = cover[ck] || [];
        // a day or week voucher, booked and kept or new, also covers the rest of its 24 hours or 7 days, on later days
        const later = (type, start) => { const n = type === "day" ? 1 : type === "week" ? 7 : 0; for (let i = 1; i <= n; i++) { const nk = e.vrn + "|" + key(addDays(d, i)); (cover[nk] = cover[nk] || []).push({ f: 0, t: i < n ? 1440 : start }); } };
        for (const b of keep) { cv.push(span(b)); later(bookingType(b), b.start); }
        for (const a of acts) {
          cv.push({ f: a.start, t: Math.min(1440, a.start + VT[a.type].mins) });
          later(a.type, a.start);
          if (a.type === "day" || a.type === "week") notes.push({ c: "", t: a.type === "day" ? `The day voucher runs until ${hm(a.start)} the next day.` : `The week voucher runs 7 days, until ${hm(a.start)} a week later.` });
        }
        const ends = keep.map((b) => span(b).t).concat(acts.map((a) => a.start + VT[a.type].mins)), segEnd = Math.max(...segs.map((x) => x.t));
        if (!plan.need.day && !plan.need.week && Math.max(...ends) > segEnd) notes.push({ c: "", t: `Last voucher runs ${fmtMins(Math.max(...ends) - segEnd)} past ${hm(segEnd)}.` });
      }
      items.push({ entry: e, dk: e.dk, vrn: e.vrn, acts, need, bill, notes, pending: !!e.pending, replaces: repl, ...(lack ? { lack } : {}) });
    }
    items.sort((a, b) => sorted.indexOf(a.entry) - sorted.indexOf(b.entry));
    const n = KINDS.reduce((x, k) => x + used[k], 0);
    return { items: joinParts(ctx, items), used, kept, short, count: n, cancels, cost: valueOf(used, ctx.prices), ready: (n > 0 || cancels > 0) && short === 0 };
  }
  // The cheapest vouchers for each vehicle's entries taken together, across days and gaps: a day voucher runs 24 hours
  // and a week voucher 7 days, so one can cover the end of one day's controls and the start of the next, or a week of
  // days over a weekend; a 5-hour voucher can cover two stretches with a gap between them, in one entry or two, e.g.
  // 10:00–12:00 and 12:30–14:30. Exact over the minutes still needed (dynamic programming): each voucher starts at the
  // earliest minute not yet covered, which is always in controlled hours, and 5-hour, day and week vouchers stay within
  // those left. Needs prices. Returns the 5-hour, day and week vouchers it uses, by the entry they start in; place()
  // fills the rest of each day with the cheapest mix of 1-hour vouchers, which is what the whole-plan answer uses there.
  function acrossDays(ctx, batch, left, needed) {
    const out = new Map(), pr = (k) => ctx.prices && ctx.prices[k] && ctx.prices[k].price, tk = key(ctx.today);
    if (!pr("h1") || !pr("h5") || !(left.h5 > 0 || (left.day > 0 && pr("day")) || (left.week > 0 && pr("week")))) return out;
    const byVrn = new Map();
    for (const e of batch) { if (!byVrn.has(e.vrn)) byVrn.set(e.vrn, []); byVrn.get(e.vrn).push(e); }
    let fives = left.h5, days = left.day, weeks = left.week;
    for (const list of byVrn.values()) {
      const iv = [];
      for (const e of list) { const o = daysBetween(tk, e.dk) * 1440; for (const x of needed(e)) iv.push({ f: o + x.f, t: o + x.t, e, o }); }
      if (!iv.length) continue;
      iv.sort((a, b) => a.f - b.f);
      const next = (m) => { for (const x of iv) if (x.t > m) return { m: Math.max(m, x.f), x }; return null; };
      // where a voucher starting at m stops covering: 1-hour and 5-hour vouchers stop at midnight, as place() counts them
      const end = (type, m) => (type === "day" || type === "week" ? m + VT[type].mins : Math.min(m + VT[type].mins, (Math.floor(m / 1440) + 1) * 1440));
      const memo = new Map();
      // Cheapest cover from minute at.m on, in pence, with f 5-hour, d day and w week vouchers to spare.
      const best = (at, f, d, w) => {
        if (!at) return { cost: 0 };
        const k = at.m + "|" + f + "|" + d + "|" + w; if (memo.has(k)) return memo.get(k);
        let r = null;
        for (const type of ["h5", "h1", "day", "week"]) { // a 5-hour voucher first, as options() lays them
          if ((type === "h5" && !(f > 0)) || (type === "day" && !(d > 0 && pr("day"))) || (type === "week" && !(w > 0 && pr("week")))) continue;
          const to = next(end(type, at.m)), f2 = f - (type === "h5"), d2 = d - (type === "day"), w2 = w - (type === "week"), sub = best(to, f2, d2, w2);
          const cost = Math.round(pr(type) * 100) + sub.cost;
          if (!r || cost < r.cost) r = { cost, type, to, f2, d2, w2 }; // ties keep the first tried
        }
        memo.set(k, r); return r;
      };
      const nDays = new Set(list.map((e) => e.dk)).size, mins = iv.reduce((n, x) => n + x.t - x.f, 0);
      let at = next(-Infinity), f = Math.min(fives, Math.ceil(mins / 60)), d = Math.min(days, nDays), w = Math.min(weeks, nDays);
      while (at) {
        const r = best(at, f, d, w);
        if (r.type !== "h1") { const e = at.x.e; if (!out.has(e)) out.set(e, []); out.get(e).push({ type: r.type, start: at.m - at.x.o }); fives -= r.type === "h5"; days -= r.type === "day"; weeks -= r.type === "week"; }
        at = r.to; f = r.f2; d = r.d2; w = r.w2;
      }
    }
    return out;
  }

  // Reorders each unbroken run of planned vouchers so as many as possible start where an identical booked voucher
  // does. The mix and the time covered stay the same.
  function arrange(acts, rb) {
    const out = [];
    for (let i = 0; i < acts.length;) {
      let j = i + 1;
      while (j < acts.length && acts[j].type !== "day" && acts[j - 1].type !== "day" && acts[j].start === acts[j - 1].start + VT[acts[j - 1].type].mins) j++;
      const run = acts.slice(i, j); i = j;
      if (run[0].type === "day" || run.length > 10) { out.push(...run); continue; }
      let best = run, most = -1;
      for (const types of orders(run.map((a) => a.type))) {
        let t = run[0].start;
        const laid = types.map((type) => { const a = { type, start: t }; t += VT[type].mins; return a; });
        const hits = laid.filter((a) => rb.some((b) => bookingType(b) === a.type && b.start === a.start)).length;
        if (hits > most) { most = hits; best = laid; }
      }
      out.push(...best);
    }
    return out;
  }
  // Distinct orderings of a list of voucher types, the given order first.
  function orders(types) {
    if (types.length < 2) return [types];
    const out = [];
    for (const k of new Set(types)) { const rest = [...types]; rest.splice(rest.indexOf(k), 1); for (const o of orders(rest)) out.push([k, ...o]); }
    return out;
  }
  function changeNote(rb, keep) {
    // a day or week voucher's end is on a later day: name it by its length instead
    const lb = rb.find((b) => b.start + b.mins > 1440), range = lb ? `from ${hm(rb[0].start)} (${VT[bookingType(lb)].label})` : `at ${hm(rb[0].start)}–${hm(rb[rb.length - 1].start + rb[rb.length - 1].mins)}`, gone = rb.filter((b) => !keep.includes(b));
    const times = (bs) => bs.map((b) => hm(b.start)).join(", ");
    if (!gone.length) return `Keeps the booking ${range}. Nothing is cancelled.`;
    if (!keep.length) return `Replaces the booking ${range}. It's cancelled first and its ${rb.length} voucher${rb.length > 1 ? "s go" : " goes"} back to your unused vouchers.`;
    return `Changes the booking ${range}. Keeps ${times(keep)} and cancels ${times(gone)} first; ${gone.length > 1 ? "their vouchers go" : "its voucher goes"} back to your unused vouchers.`;
  }

  // What to buy so the plan can use the cheapest mix, and what that saves. null when nothing to suggest.
  function purchaseAdvice(ctx, entries, plan, balance) {
    if (!ctx.prices) return null;
    const inf = {}, raw = balance;
    balance = effectiveBalance(ctx, entries, raw);
    for (const k of KINDS) inf[k] = ctx.prices[k] ? 1e4 : (raw[k] || 0); // allocate adds returned vouchers itself
    const ideal = allocate(ctx, entries, inf);
    if (!ideal.count) return null;
    // Compare whole mixes: a kept voucher is one the plan uses without booking it again.
    const all = (p) => Object.fromEntries(KINDS.map((k) => [k, p.used[k] + ((p.kept && p.kept[k]) || 0)])), want = all(ideal);
    const buy = zero();
    let any = false;
    for (const k of KINDS) {
      const lack = want[k] - (balance[k] || 0);
      if (lack > 0) {
        if (!ctx.prices[k]) return null; // can't be bought on this permit
        const book = ctx.prices[k].book || 1;
        buy[k] = Math.ceil(lack / book) * book; any = true;
      }
    }
    const have = valueOf(all(plan), ctx.prices), best = valueOf(want, ctx.prices);
    if (!any || ideal.cost == null || best == null) return null;
    const saving = plan.short || have == null ? null : have - best;
    if (saving !== null && saving < 0.005) return null;
    return { buy, saving, idealCost: ideal.cost, ideal };
  }

  // Smart replans: for each vehicle, whether cancelling its upcoming bookings and booking them again together with its
  // planned visits costs less, e.g. Mon–Thu booked one day at a time and Fri added later, where one week voucher is
  // cheaper. Bookings booked in another session, or outside Voucherboard, are planned as if they'd been planned together.
  // Only bookings the council lets you cancel and that haven't started count; the time they cover stays covered.
  // Each is one entry per booking day ({ smart: true, replaces }), so the planner can keep identical vouchers. Planned
  // visits that touch a booking on its day join it (absorbs), so the time is planned as one stretch: 10:00–12:00 booked
  // as two 1-hour vouchers and 12:00–13:00 added is one 5-hour voucher. Using it replaces those entries; unreplan gives
  // them back.
  // Returns [{ vrn, entries, absorbs, saving, before, after, cancels, buy }] for vehicles where it saves, biggest first:
  // saving uses only vouchers held (or given back by the cancellations), null when it needs vouchers bought; buy is
  // { saving, need } when buying vouchers first would save more; before and after are the voucher mixes that change;
  // cancels counts booked vouchers cancelled; deadline ({ dk, min }) is when the first of them starts, after which the
  // replan no longer holds. Needs prices.
  // up(b): a booking a replan may cancel. spend(plan, vrn): what a plan spends on the vehicle, booked vouchers it keeps and
  // new ones, as a mix and in pence; null if a price is unknown or some of its time isn't covered.
  function replanTools(ctx) {
    const st = (b) => status(ctx.today, ctx.now, b.date, b.start, b.start + b.mins);
    // a voucher still to start in a visit that's under way stays: that visit is ended early, not replanned
    const going = (b) => ctx.bookings.some((x) => x.vrn === b.vrn && x.date === b.date && x.start < b.start && x.start + x.mins >= b.start && (st(x) !== "up" || going(x)));
    const up = (b) => b.cancellable && st(b) === "up" && !going(b);
    const spend = (plan, vrn) => {
      const gone = new Set(plan.items.flatMap((it) => it.replaces)), mix = zero();
      for (const b of ctx.bookings) if (b.vrn === vrn && up(b) && !gone.has(b.id)) mix[bookingType(b)]++;
      for (const it of plan.items) if (it.vrn === vrn && !it.pending) {
        if (it.notes.some((n) => n.c === "bad")) return null;
        if (it.need) for (const k of KINDS) mix[k] += it.need[k] || 0;
      }
      const v = valueOf(mix, ctx.prices);
      return v == null ? null : { mix, pence: Math.round(v * 100) };
    };
    // What a plan saves against another over every vehicle, in pence, so a replan that takes a voucher another vehicle's
    // plan was using is counted as such. null when it leaves some vehicle's time uncovered that wasn't before.
    const saved = (base, alt) => {
      let pence = 0;
      for (const vrn of new Set([...ctx.bookings.filter(up).map((b) => b.vrn), ...base.items.map((it) => it.vrn), ...alt.items.map((it) => it.vrn)])) {
        const a = spend(base, vrn), b = spend(alt, vrn);
        if (a && !b) return null;
        if (a && b) pence += a.pence - b.pence;
      }
      return pence;
    };
    return { up, spend, saved };
  }
  // Several replans used together: the entries after, and what they save together with the vouchers held, in pounds.
  // Less than their savings added up when two want the same voucher; 0 when they need vouchers bought.
  function withReplans(entries, opts) {
    const absorbs = new Set(opts.flatMap((o) => o.absorbs));
    return entries.filter((e) => !absorbs.has(e.id)).concat(opts.flatMap((o) => o.entries));
  }
  // { saving, complete }: complete is false when, together, they don't each save what their own offer says, because
  // they want the same vouchers or leave some time uncovered. Offers that need vouchers bought aren't counted: they
  // already say so.
  function replanTogether(ctx, entries, balance, opts) {
    if (!opts.length) return { saving: 0, complete: true };
    const { saved } = replanTools(ctx), pence = saved(allocate(ctx, entries, balance), allocate(ctx, withReplans(entries, opts), balance));
    const expected = opts.reduce((n, o) => n + Math.round((o.saving || 0) * 100), 0);
    return { saving: Math.max(0, pence || 0) / 100, complete: pence != null && pence >= expected - 1 };
  }
  let replanMemo = null; // the last answer: both UIs ask again on every redraw, and it takes several whole plans
  function replanOptions(ctx, entries, balance) {
    const pr = (k) => ctx.prices && ctx.prices[k] && ctx.prices[k].price;
    if (!ctx.prices) return [];
    const sig = JSON.stringify([key(ctx.today), ctx.now, ctx.zone && ctx.zone.code, ctx.prices, ctx.bookings, entries, balance]);
    if (replanMemo && replanMemo.sig === sig) return replanMemo.out;
    const { up, spend, saved } = replanTools(ctx);
    const taken = new Set(entries.flatMap((e) => e.replaces || [])), out = [];
    const inf = Object.fromEntries(KINDS.map((k) => [k, pr(k) ? 1e4 : balance[k] || 0]));
    const vrns = [...new Set(ctx.bookings.filter((b) => up(b) && !taken.has(b.id)).map((b) => b.vrn))];
    const base = vrns.length ? allocate(ctx, entries, balance) : null, baseI = vrns.length ? allocate(ctx, entries, inf) : null;
    for (const vrn of vrns) {
      const groups = [];
      for (const b of ctx.bookings.filter((x) => x.vrn === vrn && up(x) && !taken.has(x.id)).sort((x, y) => x.date.localeCompare(y.date) || x.start - y.start)) {
        const g = groups[groups.length - 1];
        if (g && g.dk === b.date && b.start <= g.to) { g.to = Math.max(g.to, b.start + b.mins); g.replaces.push(b.id); }
        else groups.push({ dk: b.date, from: b.start, to: b.start + b.mins, replaces: [b.id], absorbs: [] });
      }
      const plain = entries.filter((e) => e.vrn === vrn && !e.kind && !e.replaces && !e.smart && !e.pending);
      for (let grew = true; grew;) {
        grew = false;
        for (const g of groups) for (const e of plain) if (g.dk === e.dk && !g.absorbs.includes(e.id) && e.from <= g.to && e.to >= g.from) { g.from = Math.min(g.from, e.from); g.to = Math.max(g.to, e.to); g.absorbs.push(e.id); grew = true; }
        for (let i = groups.length - 1; i > 0; i--) { // a visit between two bookings joins them
          const a = groups[i - 1], b = groups[i];
          if (a.dk === b.dk && b.from <= a.to) { a.to = Math.max(a.to, b.to); a.replaces.push(...b.replaces); a.absorbs.push(...b.absorbs.filter((x) => !a.absorbs.includes(x))); groups.splice(i, 1); grew = true; }
        }
      }
      const absorbs = groups.flatMap((g) => g.absorbs), mine = groups.map(({ absorbs: _, ...g }, i) => ({ id: `r:${vrn}:${i}`, vrn, ...g, smart: true }));
      const list = entries.filter((e) => !absorbs.includes(e.id)).concat(mine);
      const was = spend(base, vrn), alt = allocate(ctx, list, balance), now = spend(alt, vrn);
      const altI = allocate(ctx, list, inf), wasI = spend(baseI, vrn), nowI = spend(altI, vrn);
      const net = was && now ? saved(base, alt) : null, netI = wasI && nowI ? saved(baseI, altI) : null;
      const saving = net >= 1 ? net : 0, savingI = netI || 0;
      const buy = savingI - saving >= 1 ? { saving: savingI / 100, need: null } : null;
      if (!saving && !buy) continue;
      if (buy) { const adv = purchaseAdvice(ctx, list, alt, balance); buy.need = adv ? adv.buy : null; }
      const use = saving ? [was, now, alt] : [wasI, nowI, altI], mineIt = use[2].items.filter((it) => it.vrn === vrn);
      const cancels = mineIt.reduce((n, it) => n + it.replaces.length, 0);
      // only the entries that change something: a booking kept as it is needs no part in it
      const changes = mine.filter((e, i) => groups[i].absorbs.length || mineIt.some((it) => it.entry.id === e.id && it.replaces.length));
      // only what changes, as vouchers in both stay as they are; but whole mixes when one side would be left empty
      let before = zero(), after = zero();
      for (const k of KINDS) { const same = Math.min(use[0].mix[k], use[1].mix[k]); before[k] = use[0].mix[k] - same; after[k] = use[1].mix[k] - same; }
      if (!KINDS.some((k) => before[k]) || !KINDS.some((k) => after[k])) { before = use[0].mix; after = use[1].mix; }
      out.push({ vrn, entries: changes, absorbs, deadline: firstStart(ctx.bookings, mineIt.flatMap((it) => it.replaces)), saving: saving ? saving / 100 : null, before, after, cancels, buy });
    }
    out.sort((a, b) => ((b.saving || 0) - (a.saving || 0)) || ((b.buy ? b.buy.saving : 0) - (a.buy ? a.buy.saving : 0)));
    replanMemo = { sig, out };
    return out;
  }

  // When the first of these bookings starts, as { dk, min }, or null. A smart replan holds only until then.
  function firstStart(bookings, ids) {
    const bs = bookings.filter((b) => ids.includes(b.id)).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    return bs.length ? { dk: bs[0].date, min: bs[0].start } : null;
  }
  // Milliseconds from now to minute min of day dk.
  const msUntil = (at, now = Date.now()) => { const d = fromKey(at.dk); d.setMinutes(at.min); return d.getTime() - now; };
  // Applied smart replans that no longer hold, because a booking one cancels has started or gone: each such vehicle's
  // replan is dropped as a whole (its planned visits back, as unreplan gives them), as part of one isn't cheaper.
  // isUp(b) says a booking hasn't started. Returns { entries, dropped: [vrn] }.
  function expireReplans(entries, bookings, isUp) {
    const bad = new Set(entries.filter((e) => e.smart && (e.replaces || []).some((id) => { const b = bookings.find((x) => x.id === id); return !b || !isUp(b); })).map((e) => e.vrn));
    if (!bad.size) return { entries, dropped: [] };
    const gone = entries.filter((e) => e.smart && bad.has(e.vrn)), back = unreplan(gone, bookings);
    return { entries: entries.filter((e) => !gone.includes(e)).concat(back), dropped: [...bad] };
  }

  // The plan after bookings are cancelled straight away (Cancel, End early, bulk cancel): a change to one goes, so it
  // isn't booked as a new visit, and a smart replan that would have cancelled one goes as a whole, its planned visits
  // back, as part of one isn't cheaper. gone: a Set of booking ids. Returns { entries, dropped } (entries removed).
  function dropCancelled(entries, gone, bookings) {
    const hit = (e) => (e.replaces || []).some((id) => gone.has(id)), vrns = new Set(entries.filter((e) => e.smart && hit(e)).map((e) => e.vrn));
    const out = entries.filter((e) => hit(e) || (e.smart && vrns.has(e.vrn)));
    if (!out.length) return { entries, dropped: 0 };
    return { entries: entries.filter((e) => !out.includes(e)).concat(unreplan(out.filter((e) => e.smart), bookings)), dropped: out.length };
  }

  // A smart replan's entries, dropped: the time they cover beyond their bookings goes back to the plan as visits.
  function unreplan(smart, bookings) {
    const out = [];
    for (const e of smart) {
      const busy = bookings.filter((b) => (e.replaces || []).includes(b.id)).map((b) => ({ f: b.start, t: b.start + b.mins }));
      for (const x of subtract([{ f: e.from, t: e.to }], busy)) out.push({ vrn: e.vrn, dk: e.dk, from: x.f, to: x.t, ...(e.email ? { email: true } : {}) });
    }
    return out;
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
    for (const it of plan.items) if (!it.pending) for (const a of it.acts) acts.push({ ...a, vrn: it.vrn, dk: a.dk || it.dk, eid: it.entry.id });
    return acts.sort((a, b) => a.dk.localeCompare(b.dk) || a.start - b.start);
  }

  const api = { VT, KINDS, zero, WINDOW_DAYS, LAST_MIN, key, fromKey, addDays, isoDow, hm, pad, fmtMins, valueOf,
    controls, inControls, inWindow, subtract, intersect, options, choose, candidates, advanceEntries, dayParts, allocate, purchaseAdvice, activations, bookingType, onDay, bookingsOn, status, daysBetween, replacedIds, effectiveBalance, shrinkOptions, replanOptions, replanTogether, withReplans, unreplan, dropCancelled, firstStart, msUntil, expireReplans };
  root.VB = root.VB || {};
  root.VB.planner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
