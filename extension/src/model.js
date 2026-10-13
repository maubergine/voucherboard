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

  // ---------- loading ----------
  // One permit's zone, bookings, unused vouchers, favourites and prices. subzone() reads the saved B1/B2 choice.
  async function loadPermitData(permitId, permits, subzone) {
    const details = await W.loadDetails(permitId);
    const permit = permits.find((p) => p.id === permitId);
    const zn = details.zoneName || (permit && permit.zoneName);
    const subzones = Z.subzones(zn);
    const sub = subzones.length ? await subzone() : null;
    const zone = subzones.length ? subzones.find((z) => z.code === sub) || null : Z.findZone(zn);
    const bookings = details.bookings.map((b) => ({ ...b, type: b.mins >= 23 * 60 ? "day" : b.mins >= 300 ? "h5" : "h1" }));
    const balance = { h1: 0, h5: 0, day: 0 };
    let weekVouchers = 0;
    for (const u of details.unused) { if (u.type in balance) balance[u.type]++; else if (u.type === "week") weekVouchers++; }
    const favs = await W.loadVehicles();
    let prices = null;
    try { prices = await W.loadPrices(permitId); if (!Object.keys(prices).length) prices = null; } catch (e) { prices = null; }
    return { details, subzones, zone, bookings, balance, weekVouchers, favs, prices };
  }

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
  // How many requests a run sends, for the progress bar.
  const requestCount = ({ nBook, nCancel, repl }, test) => nBook * W.STEPS.length + (test ? 0 : nCancel * 2 + repl.size) + 2;

  // Sends the operations one at a time and stops at the first failure.
  // on: { stat(i, cls, txt), bump(label), moved(), stopping() }. vehicle(vrn) returns the UI's vehicle object;
  // its pendingFav is cleared once a booking has saved it as a favourite.
  async function runOps({ ops, repl, permitId, test, vehicle, emailFor, on }) {
    let done = 0, cancelled = 0, failed = null, fresh = null;
    const startedAt = new Date().toISOString(), picked = [], booked = [], cancelledE = new Set();
    const nBook = ops.filter((o) => o.kind === "book").length;
    W.clearTrace();
    const poolOf = (d) => { const pl = { h1: [], h5: [], day: [] }; for (const u of d.unused) if (pl[u.type]) pl[u.type].push(u); return pl; };
    try {
      on.bump("Reading your current vouchers");
      fresh = await W.loadDetails(permitId);
      let pool = poolOf(fresh);
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
            on.bump("Reading your vouchers again");
            fresh = await W.loadDetails(permitId); pool = poolOf(fresh);
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
            permitId, voucher, act: a, activateNow, testMode: test,
            vehicle: { vrn: v.vrn, favId: v.favId, saveAsFavourite: !!v.pendingFav, nickname: v.nick }, sendEmail: emailFor(a),
            onStep: (k, label) => { on.stat(i, "run", `${k + 1}/${W.STEPS.length}`); on.bump(`Voucher ${done + 1} of ${nBook}: ${label} · ${fmtDay(fromKey(a.dk))} ${a.type === "day" ? "all day" : hm(a.start)} · ${vText(v)}`); }
          });
        } catch (e) { e.index = i; throw e; }
        if (!test && v.pendingFav) v.pendingFav = false; // saved with this booking
        on.stat(i, test ? "test" : "done", test ? "Checked ✓" : "Booked ✓"); done++; booked.push(a);
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
      L.push(`${i + 1}. book ${a.dk} ${a.type === "day" ? "all day" : hm(a.start)} ${a.type} ${a.vrn}${a.moved ? " (moved to now)" : ""}` +
        (u ? ` · voucher ${u.voucher.permitVehicleId} (${u.voucher.type})${u.activateNow ? " · activate now" : ""}` : " · not started"));
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
  root.VB.model = { DOW, MON, fmtDay, hShort, todayDate, nowMin, vText, plural, ctlText, loadPermitData, mergeVehicles, checkTimes,
    buildOps, requestCount, runOps, missingAfterRun, runNote, runSummary, cancelIds, errorReport };
})(typeof globalThis !== "undefined" ? globalThis : this);
