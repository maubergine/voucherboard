// What the planner does with the council site, shared by the extension's UI (app.js) and the mobile app's UI.
// No DOM: loading a permit, merging vehicles, checking times, running a plan, and the error report.
(function (root) {
  "use strict";
  const P = root.VB.planner, W = root.VB.portal, Z = root.VB.zones;
  const { VT, key, fromKey, hm, pad } = P;
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDay = (d) => DOW[P.isoDow(d) - 1] + " " + d.getDate() + " " + MON[d.getMonth()];
  const hShort = (m) => { const h = Math.floor(m / 60), mm = m % 60; return mm ? h + ":" + pad(mm) : String(h); };
  const todayDate = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const vText = (v) => (v.fav || v.pendingFav ? v.nick : v.vrn);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  // Minute t of day dk, which can run past midnight: "11:00", or "Tue 28 Oct 10:00" for a later day.
  const endText = (dk, t) => (t <= 1440 ? hm(t) : `${fmtDay(P.addDays(fromKey(dk), Math.floor(t / 1440)))} ${hm(t % 1440)}`);
  // A booking that runs past midnight, as its start and end: { starts: "Mon 26 Oct, 09:00", ends: "Mon 2 Nov, 09:00" }.
  // null for one within a day, which shows as its day and times.
  const startEnd = (dk, f, t) => (t <= 1440 ? null : { starts: `${fmtDay(fromKey(dk))}, ${hm(f)}`, ends: `${fmtDay(P.addDays(fromKey(dk), Math.floor(t / 1440)))}, ${hm(t % 1440)}` });
  const rangeText = (dk, f, t, sep = "–") => `${hm(f)}${t > 1440 ? ` ${sep} ` : sep}${endText(dk, t)}`;

  // ---------- permits ----------
  // Visitor permits in the same zone pool their vouchers, so the user picks a zone, then which of its permits to use.
  const zoneCode = (p) => String((p && p.zoneName) || "").split(" - ")[0].trim().toUpperCase();
  // Usable permits by zone, in the council's order: [{ code, name, permits }].
  function zoneGroups(usable) {
    const out = [];
    for (const p of usable) {
      const code = zoneCode(p);
      let g = out.find((x) => x.code === code);
      if (!g) out.push(g = { code, name: String(p.zoneName || "").split(" - ").slice(1).join(" - ").trim() || code, permits: [] });
      g.permits.push(p);
    }
    return out;
  }
  // The zone and permits to use. saved is { zone, off }: permits turned off are listed, so a new permit joins by default.
  // legacyId is the single permit older versions saved. At least one permit always stays on.
  function pickPermits(usable, saved, legacyId) {
    const groups = zoneGroups(usable);
    if (!groups.length) return { zone: null, ids: [], group: null };
    const legacy = usable.find((p) => p.id === legacyId);
    const g = (saved && groups.find((x) => x.code === saved.zone)) || (legacy && groups.find((x) => x.code === zoneCode(legacy))) || groups[0];
    const off = (saved && saved.zone === g.code && saved.off) || [];
    const ids = g.permits.filter((p) => !off.includes(p.id)).map((p) => p.id);
    return { zone: g.code, ids: ids.length ? ids : g.permits.map((p) => p.id), group: g };
  }
  // A zone with several permits keeps one plan, whichever of them are on; a lone permit keeps its own, as before.
  const planKey = (sel) => (sel.group && sel.group.permits.length > 1 ? "vb:plan:zone:" + sel.zone : "vb:plan:" + sel.ids[0]);
  // The saved plan, or, the first time a zone's shared plan is read, its permits' own plans joined.
  async function readPlan(get, sel) {
    const k = planKey(sel), p = await get(k, null);
    if (p || !k.startsWith("vb:plan:zone:")) return p || [];
    const out = [];
    for (const x of sel.group.permits) out.push(...((await get("vb:plan:" + x.id, null)) || []));
    return out;
  }
  // The saved B1/B2 choice: any permit's in the group, since they share a zone.
  async function readSubzone(get, ids) { for (const id of ids) { const v = await get("vb:subzone:" + id, null); if (v) return v; } return null; }
  // "LV-1" or "LV-1 and LV-2": the permits a booking's vouchers came from. refOf(id) names a permit.
  function permitsText(items, refOf) {
    const refs = [...new Set(items.map((b) => b.permitId).filter(Boolean))].map(refOf);
    return refs.length > 1 ? refs.slice(0, -1).join(", ") + " and " + refs[refs.length - 1] : refs[0] || "";
  }
  // Oldest permit first, by the council's apply date, then by reference (issued in order). Unknown dates go last.
  // Vouchers are used oldest first; purchases go to the newest.
  const byAge = (a, b) => (a.applied ? 0 : 1) - (b.applied ? 0 : 1) || String(a.applied || "").localeCompare(String(b.applied || "")) || String(a.ref).localeCompare(String(b.ref), "en-GB", { numeric: true });
  // Permits read (loadPermitData's perPermit) that have vouchers Voucherboard can book. Only these count as in use:
  // an empty permit shows unticked, though its bookings still show, and it's back once a voucher returns to it.
  const withVouchers = (perPermit) => perPermit.filter((x) => P.KINDS.some((k) => x.balance[k] > 0)).map((x) => x.id);
  // A zone's permits oldest first, by apply dates seen before (ages: { id: "2026-07-11" }), so the list keeps its order
  // while permits are turned on and off: one turned off isn't read, but its date is remembered.
  const orderPermits = (permits, ages) => permits.map((p) => ({ ...p, applied: (ages && ages[p.id]) || null })).sort(byAge);
  // ages plus the dates just read; null when nothing new, so callers only save a change.
  function addAges(ages, perPermit) {
    const out = { ...ages };
    for (const x of perPermit) if (x.applied) out[x.id] = x.applied;
    return Object.keys(out).some((k) => out[k] !== (ages || {})[k]) ? out : null;
  }
  // Planned changes to bookings on permits no longer in use: without those bookings they'd book as new visits.
  function dropChangesOff(entries, bookings, ids) {
    const off = new Set(bookings.filter((b) => b.permitId && !ids.includes(b.permitId)).map((b) => b.id));
    const kept = entries.filter((e) => !(e.replaces || []).some((id) => off.has(id)));
    return { kept, dropped: entries.length - kept.length };
  }

  // ---------- loading ----------
  // One permit's details: its bookings (each noting its permitId) and unused vouchers, counted.
  async function readPermit(id, permits) {
    const d = await W.loadDetails(id), p = permits.find((x) => x.id === id), balance = P.zero();
    for (const u of d.unused) if (u.type in balance) balance[u.type]++;
    const bookings = d.bookings.map((b) => ({ ...b, type: P.bookingType(b), permitId: id }));
    return { id, ref: (p && p.ref) || d.ref || id, applied: d.applied || null, balance, bookings, details: d };
  }
  // Permits read with readPermit, together: bookings, unused vouchers added up, perPermit (each one's counts) and
  // order, oldest first: the order runOps uses their vouchers in. Switching permits in a zone combines again without
  // reading the ones already read.
  function combine(reads) {
    const balance = P.zero();
    for (const r of reads) for (const k of P.KINDS) balance[k] += r.balance[k];
    const perPermit = reads.map(({ id, ref, applied, balance: b }) => ({ id, ref, applied, balance: b })).sort(byAge);
    return { bookings: reads.flatMap((r) => r.bookings), balance, perPermit, order: perPermit.map((x) => x.id) };
  }
  // The permits' zone, bookings, unused vouchers, favourites and prices: combine()'s result plus details, subzones,
  // zone, favs, prices and reads (for combining again). ids is one permit id or several in one zone. subzone() reads
  // the saved B1/B2 choice. Prices are the newest permit's that sells vouchers; pricesPermitId says which, for buying.
  async function loadPermitData(ids, permits, subzone) {
    const reads = [];
    for (const id of [].concat(ids)) reads.push(await readPermit(id, permits));
    const details = reads[0].details; // zone and subzones: the permits share them
    const permit = permits.find((p) => p.id === reads[0].id);
    const zn = details.zoneName || (permit && permit.zoneName);
    const subzones = Z.subzones(zn);
    const sub = subzones.length ? await subzone() : null;
    const zone = subzones.length ? subzones.find((z) => z.code === sub) || null : Z.findZone(zn);
    const all = combine(reads);
    const favs = await W.loadVehicles();
    let prices = null, pricesPermitId = null;
    for (const id of [...all.order].reverse()) {
      try { const pr = await W.loadPrices(id); if (Object.keys(pr).length) { prices = pr; pricesPermitId = id; break; } } catch (e) { /* try the next permit */ }
    }
    return { ...all, details, subzones, zone, favs, prices, pricesPermitId, reads };
  }
  // "9 × 1 hour": one permit's unused vouchers, for the permit pickers.
  const balanceShort = (b) => P.KINDS.filter((k) => b[k]).map((k) => `${b[k]} × ${VT[k].label}`).join(", ") || "No unused vouchers";

  // Favourites from the council site, then plates already in use that aren't favourites: added by the user,
  // booked, or listed in keep.
  function mergeVehicles(current, favs, bookings, keep = []) {
    const added = current.filter((v) => !v.fav && !favs.some((f) => f.vrn === v.vrn));
    const out = favs.map((f) => ({ ...f, fav: true }));
    for (const v of added) out.push(v);
    const other = (vrn) => { if (!out.some((v) => v.vrn === vrn)) out.push({ vrn, nick: vrn, fav: false }); };
    for (const b of bookings) other(b.vrn);
    for (const vrn of keep) other(vrn);
    return out;
  }

  // ---------- times ----------
  // "Controls 10–12", "No controls" or "Hours unknown": a day's controls, for start and end pickers.
  const ctlLine = (zone, d) => { const t = ctlText(zone, d); return /\d/.test(t) ? "Controls " + t : t; };
  const ctlText = (zone, d) => { const c = P.controls(zone, d); if (!c) return "Hours unknown"; return c.length ? c.map((x) => hShort(x.f) + "–" + hShort(x.t)).join(", ") : "No controls"; };
  // A booking time on one day, to the minute: not in the past, and partly in controlled hours (the rest is
  // skipped when vouchers are chosen). ctx: { zone, today, now }. Returns { f, t, msg } or { err }.
  function checkTimes(ctx, dk, f, t) {
    if (f == null || t == null) return { err: "Enter a start and an end time." };
    if (t <= f) return { err: "The end must be after the start." };
    t = Math.min(t, P.LAST_MIN);
    let msg = "";
    if (dk === key(ctx.today) && f < ctx.now) {
      if (t <= ctx.now) return { err: "That time has already passed." };
      msg = `Starts at ${hm(ctx.now)} because ${hm(f)} has passed.`; f = ctx.now;
    }
    const d = fromKey(dk), c = P.controls(ctx.zone, d);
    if (c && !P.intersect([{ f, t }], c).length) return { err: c.length ? `${hm(f)}–${hm(t)} is outside controlled hours (${ctlText(ctx.zone, d)}). No voucher is needed then.` : "There are no controls that day. No voucher is needed." };
    return { f, t, msg };
  }

  // A start-to-end booking: from minute f of day dk to minute t of day toDk, over as many days as it takes. Not in the
  // past, and ending by the last day bookings can be made. Returns { dk, f, t, msg } with t counted from dk's midnight,
  // as the plan keeps it, or { err }.
  function checkStay(ctx, dk, f, toDk, t) {
    if (!dk || !toDk || f == null || t == null) return { err: "Choose a start and an end." };
    const tk = key(ctx.today), last = key(P.addDays(ctx.today, P.WINDOW_DAYS));
    t += P.daysBetween(dk, toDk) * 1440;
    if (t <= f) return { err: "The end must be after the start." };
    if (toDk > last) return { err: `Bookings can only be made up to ${fmtDay(fromKey(last))}.` };
    let msg = "";
    if (dk < tk || (dk === tk && f < ctx.now)) {
      const off = P.daysBetween(dk, tk) * 1440;
      if (t - off <= ctx.now) return { err: "That time has already passed." };
      msg = `Starts now, ${hm(ctx.now)}, because the start has passed.`; dk = tk; f = ctx.now; t -= off;
    }
    return { dk, f, t, msg };
  }

  // ---------- running a plan ----------
  // Operations in order: a changed booking is cancelled just before its replacement is booked.
  function buildOps(plan, bookings) {
    const acts = P.activations(plan).map((a) => ({ ...a }));
    const byId = new Map(bookings.map((b) => [b.id, b])), repl = new Map();
    for (const it of plan.items) if (!it.pending && it.replaces.length) repl.set(it.entry.id, it.replaces.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.start - b.start));
    const ops = [], emitted = new Set();
    const cancelOp = (eid) => { emitted.add(eid); const bs = repl.get(eid); ops.push({ kind: "cancel", eid, bookings: bs, vrn: bs[0].vrn, dk: bs[0].date }); };
    for (const a of acts) { if (repl.has(a.eid) && !emitted.has(a.eid)) cancelOp(a.eid); ops.push({ kind: "book", a }); }
    for (const eid of repl.keys()) if (!emitted.has(eid)) cancelOp(eid);
    const nCancel = [...repl.values()].reduce((n, bs) => n + bs.length, 0);
    return { ops, acts, repl, nBook: acts.length, nCancel };
  }
  // How many requests a run sends, for the progress bar. Each permit's vouchers are read at the start.
  const requestCount = ({ nBook, nCancel, repl }, test, nPermits = 1) => nBook * W.STEPS.length + (test ? 0 : nCancel * 2 + repl.size) + nPermits + 1;

  // Sends the operations one at a time and stops at the first failure. Vouchers come from every permit in permitIds,
  // in that order (oldest first: loadPermitData's order), and each is booked on its own permit.
  // on: { stat(i, cls, txt), bump(label), moved(), stopping() }. vehicle(vrn) returns the UI's vehicle object;
  // its pendingFav is cleared once a booking has saved it as a favourite. permitRef(id) names a permit in statuses.
  async function runOps({ ops, repl, permitIds, permitId, test, vehicle, emailFor, permitRef, on, zone = null }) {
    let done = 0, cancelled = 0, failed = null, fresh = null;
    const startedAt = new Date().toISOString(), picked = [], booked = [], cancelledE = new Set();
    const nBook = ops.filter((o) => o.kind === "book").length, ids = permitIds || [permitId], read = new Map();
    const from = (u) => (ids.length > 1 && permitRef ? ` · ${permitRef(u.permitId)}` : "");
    W.clearTrace();
    const readDetails = async (list) => { for (const id of list) { on.bump("Reading your current vouchers"); read.set(id, await W.loadDetails(id)); } };
    // Every permit's unused vouchers, tagged with their permit; fresh is the same, for the error report.
    const poolOf = () => {
      const pl = Object.fromEntries(P.KINDS.map((k) => [k, []])), unused = [];
      for (const id of ids) for (const u of read.get(id).unused) { const x = { ...u, permitId: id }; unused.push(x); if (pl[u.type]) pl[u.type].push(x); }
      fresh = { unused };
      return pl;
    };
    try {
      await readDetails(ids);
      let pool = poolOf();
      const lastV = {}; // test mode: checks don't use vouchers up, so one can be checked again
      for (let i = 0; i < ops.length; i++) {
        if (on.stopping()) break;
        const o = ops[i];
        if (o.kind === "cancel") {
          const v = vehicle(o.vrn);
          if (test) { on.stat(i, "test", "Would cancel ✓"); continue; }
          on.stat(i, "run", "Cancelling…");
          try {
            for (const b of [...o.bookings].reverse()) {
              on.bump(`Cancelling ${hm(b.start)} · ${fmtDay(fromKey(o.dk))} · ${vText(v)}`);
              await W.cancelBooking(b.id); on.bump(`Cancelled ${hm(b.start)}`); cancelled++;
            }
            // cancelled vouchers go back to their own permits
            const back = [...new Set(o.bookings.map((b) => b.permitId).filter((id) => ids.includes(id)))];
            for (const id of back.length ? back : ids) { on.bump("Reading your vouchers again"); read.set(id, await W.loadDetails(id)); }
            pool = poolOf();
          } catch (e) { e.index = i; throw e; }
          cancelledE.add(o.eid); on.stat(i, "done", "Cancelled ✓");
          continue;
        }
        const a = o.a, v = vehicle(a.vrn);
        // nothing may start before the current minute: move today's remaining starts forward, keeping their order
        const nowM = nowMin();
        if (a.dk === key(todayDate()) && a.start < nowM) {
          const shift = nowM - a.start;
          for (let j = i; j < ops.length; j++) if (ops[j].kind === "book" && ops[j].a.dk === a.dk) { ops[j].a.start += shift; ops[j].a.moved = true; }
          on.moved();
        }
        // moved past the end of controls: the council site refuses a start then, whatever the voucher's length
        if (!P.inControls(zone, a.dk, a.start)) throw Object.assign(new W.PortalError(`${hm(a.start)} is outside controlled hours, so the council site won't take a voucher starting then.`), { index: i });
        on.stat(i, "run", "Starting");
        let voucher = pool[a.type].shift();
        if (!voucher && test) voucher = lastV[a.type];
        if (voucher) lastV[a.type] = voucher;
        if (!voucher && test && repl.has(a.eid)) { on.stat(i, "test", "Not checked: needs the cancelled voucher"); continue; }
        if (!voucher) throw Object.assign(new W.PortalError(`No unused ${VT[a.type].label} voucher left.`), { index: i });
        const activateNow = a.dk === key(todayDate()) && a.start <= nowMin();
        picked[i] = { voucher, activateNow };
        try {
          await W.bookOne({
            permitId: voucher.permitId, voucher, act: a, activateNow, testMode: test,
            vehicle: { vrn: v.vrn, favId: v.favId, saveAsFavourite: !!v.pendingFav, nickname: v.nick }, sendEmail: emailFor(a),
            onStep: (k, label) => { on.stat(i, "run", `${k + 1}/${W.STEPS.length}`); on.bump(`Voucher ${done + 1} of ${nBook}: ${label} · ${fmtDay(fromKey(a.dk))} ${hm(a.start)} · ${vText(v)}`); }
          });
        } catch (e) { e.index = i; throw e; }
        if (!test && v.pendingFav) v.pendingFav = false; // saved with this booking
        on.stat(i, test ? "test" : "done", (test ? "Checked ✓" : "Booked ✓") + from(voucher)); done++; booked.push(a);
      }
    } catch (e) { failed = e; }
    return { done, cancelled, failed, fresh, startedAt, picked, booked, cancelledE };
  }

  // Booked activations that the council site doesn't list yet.
  const missingAfterRun = (booked, bookings) => booked.filter((a) => !bookings.some((b) => b.vrn === a.vrn && b.date === a.dk && Math.abs(b.start - a.start) <= 1)).length;

  // What a finished run says, in plain words. r is runOps' result plus { stop, missing }.
  function runNote({ ops, nCancel }, r, test) {
    const { failed, stop, done, cancelled, missing, cancelledE } = r;
    const fo = failed && failed.index != null ? ops[failed.index] : null;
    const vNum = fo ? ops.slice(0, failed.index + 1).filter((o) => o.kind === "book").length : 1;
    const lost = fo && fo.kind === "book" && cancelledE.has(fo.a.eid) ? " The old booking for this change was already cancelled; its vouchers are back in your unused vouchers and the change stays in your plan." : "";
    const summary = runSummary(r);
    if (test) return failed ? `Test stopped at ${fo && fo.kind === "cancel" ? "a cancellation" : "voucher " + vNum}: ${failed.message}` : `Test passed for all ${plural(done, "voucher")}${nCancel ? ` (${nCancel} cancellation${nCancel === 1 ? "" : "s"} skipped: they can't be tested)` : ""}. Nothing was booked. Turn off test mode in Settings to book them.`;
    if (failed) return `${summary}. Then: ${failed.message}${lost} The rest were not sent and stay in your plan.`;
    if (stop) return `${summary}. The rest were not sent and stay in your plan.`;
    return missing ? `${summary}, but ${missing} don't appear on the council site yet. Check its Active permits list.` : `${summary}. The council site now lists these under Active permits.`;
  }
  const runSummary = ({ done, cancelled }) => [done && `${done} booked`, cancelled && `${cancelled} cancelled`].filter(Boolean).join(", ") || "Nothing changed";

  // Cancels booked vouchers one by one, stopping at the first failure.
  async function cancelIds(ids, onProgress) {
    let done = 0, err = null;
    for (const id of ids) { onProgress && onProgress(done, ids.length); try { await W.cancelBooking(id); done++; } catch (e) { err = e; break; } }
    return { done, err };
  }

  // ---------- error report ----------
  // Plain text for pasting into a bug report. Includes plates and permit ids, but no tokens or cookies.
  // env: { version, page, browser, permitId }.
  function errorReport({ failed, test, ops, picked, done, stop, startedAt, available }, env) {
    const j = (o) => { try { return JSON.stringify(o, null, 2); } catch (e) { return String(o); } };
    const L = [];
    L.push("Voucherboard error report", "========================");
    L.push(`Version: ${env.version || "?"}`, `Run started: ${startedAt}`, `Reported: ${new Date().toISOString()}`, `Mode: ${test ? "test" : "live"}`);
    L.push(`Page: ${env.page}`, `Browser: ${env.browser}`, `Permit: ${env.permitId}`, "");
    L.push("Error", "-----");
    L.push(`Message: ${failed.message}`);
    L.push(`Type: ${failed.name || "Error"}`);
    if (failed.index != null) L.push(`Operation: ${failed.index + 1} of ${ops.length} (${ops[failed.index].kind})`);
    if (failed.step != null) L.push(`Step: ${failed.step + 1}/${W.STEPS.length} ${W.STEPS[failed.step] || ""}`);
    L.push(`Completed before failure: ${done}${stop ? " (stop requested)" : ""}`);
    if (failed.detail !== undefined) L.push("Detail:", j(failed.detail));
    if (failed.stack) L.push("Stack:", failed.stack);
    L.push("", "Plan", "----");
    ops.forEach((o, i) => {
      if (o.kind === "cancel") { L.push(`${i + 1}. cancel ${o.dk} ${o.vrn} bookings ${o.bookings.map((b) => `${b.id} (${hm(b.start)})`).join(", ")}`); return; }
      const a = o.a, u = picked[i];
      L.push(`${i + 1}. book ${a.dk} ${hm(a.start)} ${a.type} ${a.vrn}${a.moved ? " (moved to now)" : ""}` +
        (u ? ` · voucher ${u.voucher.permitVehicleId} (${u.voucher.type})${u.voucher.permitId ? ` on permit ${u.voucher.permitId}` : ""}${u.activateNow ? " · activate now" : ""}` : " · not started"));
    });
    if (available) L.push("", "Unused vouchers at start", "------------------------", j(available.unused));
    L.push("", `Requests (${W.trace.length})`, "--------");
    W.trace.forEach((r, i) => {
      L.push(`#${i + 1} ${r.at} ${r.method} ${r.path}`);
      if (r.body) L.push(`  body: ${r.body}`);
      if (r.error) L.push(`  network error: ${r.error}`);
      if (r.status != null) L.push(`  -> ${r.status} ${r.finalUrl || ""} (${r.ms} ms)`);
      if (r.reply != null) L.push(`  reply (${r.replyLength} chars): ${r.reply}`);
    });
    return L.join("\n");
  }

  root.VB = root.VB || {};
  root.VB.model = { DOW, MON, fmtDay, hShort, endText, rangeText, startEnd, todayDate, nowMin, vText, plural, ctlText, ctlLine, zoneCode, zoneGroups, pickPermits, planKey, readPlan, readSubzone,
    permitsText, dropChangesOff, byAge, orderPermits, addAges, withVouchers, balanceShort, readPermit, combine, loadPermitData, mergeVehicles, checkTimes, checkStay,
    buildOps, requestCount, runOps, missingAfterRun, runNote, runSummary, cancelIds, errorReport };
})(typeof globalThis !== "undefined" ? globalThis : this);
