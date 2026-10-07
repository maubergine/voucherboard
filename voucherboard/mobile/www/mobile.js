// Voucherboard mobile web UI. Draws the engine's state (engine.js holds the data and does the work) and keeps only
// what's on screen: tab, sheets, board zoom. render() redraws the current screen; one delegated click, input and
// change handler each, keyed by data-a and data-in. The iOS app draws the same engine with SwiftUI instead.
(function (root) {
  "use strict";
  const P = root.VB.planner, W = root.VB.portal, T = root.VB.terms, M = root.VB.model, N = root.VBNative, E = root.VB.engine;
  const { VT, KINDS, key, fromKey, addDays, hm } = P;
  const { DOW, fmtDay, hShort, todayDate, nowMin, vText, plural } = M;
  const ISSUES_URL = "https://github.com/maubergine/voucherboard/issues";
  const doc = root.document;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s) => doc.querySelector(s);
  const spaced = (v) => root.VB.plates.format(v);
  const plateHTML = (v, cls) => `<span class="plate${cls ? " " + cls : ""}">${esc(spaced(v))}</span>`;
  const gbp = (n) => (n == null ? "" : "£" + n.toFixed(2));
  const typesText = (u) => KINDS.filter((k) => u[k]).map((k) => `${u[k]} × ${VT[k].label}`).join(" + ");
  const range = (f, t) => `${hm(f)} – ${hm(t)}`;
  const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const svg = (d, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    today: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    car: svg('<path d="M3 17v-4l2-5h14l2 5v4z"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>'),
    more: svg('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 2.5),
    rotate: svg('<rect x="3" y="8" width="18" height="11" rx="2"/><path d="M8 4h5a4 4 0 0 1 4 4"/><path d="M15 6l2 2 2-2"/>'),
    phone: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
    left: svg('<path d="M15 6l-6 6 6 6"/>', 2.5),
    right: svg('<path d="M9 6l6 6-6 6"/>', 2.5),
    check: svg('<path d="M5 12l5 5L20 7"/>', 3),
    cross: svg('<path d="M6 6l12 12M18 6L6 18"/>', 3),
    camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>')
  };

  // ---------- state ----------
  const S = E.S; // the engine's data, read-only here
  const U = { tab: "today", calDay: null, dayView: null, vq: "", confirmSignOut: false, board: { zoom: "week", cursor: E.S.today, force: false, select: null }, sheets: [] };
  const { TK, vehicle, isFav, controls, ctlAt, status, byVehicle, visits, findVisit, vkey, plan, replacedSet, nextControlled, zoneStatus, balanceText, ago, dayWindow, laneVehicles, weekStart } = E;
  const vName = (v) => esc(vText(v));

  // ---------- toast ----------
  let toastT;
  function toast(msg, undo) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" data-a="undo">Undo</button>` : ""}`;
    t.hidden = false; t._undo = undo || null;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, undo ? 5000 : 3200);
  }

  // An action's result: an error or a message, with Undo when the engine offers it.
  function result(r) { if (!r) return r; if (r.err) toast(r.err); else if (r.toast) toast(r.toast, r.undo ? () => E.undo(r.undo) : null); return r; }

  // ---------- shell ----------
  const landMQ = root.matchMedia ? root.matchMedia("(orientation: landscape) and (max-height: 600px)") : { matches: false, addEventListener() {} };
  const isBoard = () => S.phase === "ready" && (landMQ.matches || U.board.force);
  function render() {
    const app = $("#app");
    app.classList.toggle("land", isBoard());
    const body = $(".portrait .body"), keep = body && body.dataset.tab === U.tab + (U.dayView || "") ? body.scrollTop : 0;
    $(".portrait").innerHTML = portraitHTML();
    const nb = $(".portrait .body"); if (nb && keep) nb.scrollTop = keep;
    if (isBoard() || (root.matchMedia && root.matchMedia("(orientation: landscape) and (min-width: 1000px)").matches && S.phase === "ready")) renderBoard();
    renderSheet();
    renderPage();
  }
  function portraitHTML() {
    if (S.phase === "boot" || S.phase === "loading") return stateHTML("Loading your permits", "Reading your vouchers, bookings and vehicles from the council site.", true);
    if (S.phase === "error") return stateHTML("Couldn't load your permits", S.error, false, `<button type="button" class="btn pri" data-a="retry">Try again</button>`);
    if (S.phase === "signin") return stateHTML("Sign in to the council site", "Voucherboard uses your own council account. You sign in on Lewisham's own page. Voucherboard never sees or uses any of your login details.", false, `<button type="button" class="btn pri" data-a="signin">Sign in</button>`);
    if (S.phase === "nopermit") return stateHTML("No active visitor permit", "Voucherboard works with active visitor permits. Buy visitor vouchers on the council site first.", false, `<button type="button" class="btn" data-a="council">Open the council site</button>`);
    if (S.phase !== "ready") return "";
    const body = { today: todayHTML, cal: calHTML, veh: vehiclesHTML, more: moreHTML }[U.tab]();
    return body + trayHTML() + tabsHTML();
  }
  const stateHTML = (title, text, spin, acts) => `<div class="top"><div class="toprow"><div class="brand"><span class="mark" aria-hidden="true">V</span>Voucherboard</div><span class="tag">Beta</span></div></div>
    <div class="state">${spin ? '<div class="spin" aria-hidden="true"></div>' : ""}<h2>${esc(title)}</h2><p class="note">${esc(text)}</p>${acts || ""}</div>`;
  function headerHTML(title, extra, opts = {}) {
    const z = S.zone, zs = zoneStatus(), name = S.details ? S.details.zoneName : "";
    return `<header class="top"><div class="toprow"><h1 class="brand"><span class="mark" aria-hidden="true">V</span>${esc(title)}</h1>${extra || `<span class="tags">${S.settings.testMode ? '<span class="tag test">Test mode</span>' : ""}<span class="tag">Beta</span></span>`}</div>
      ${opts.zone === false ? "" : `<div class="zone"><span class="zl">${esc(z ? z.code : (name.split(" - ")[0] || "?"))}</span><div><b>${esc(z ? z.name : name.split(" - ")[1] || name)}</b><small><span class="dot${zs.live ? "" : " off"}"></span>${esc(zs.text)}</small></div></div>
      <div class="chiprow"><span class="bal num">${esc(balanceText())}</span><span class="upd">${S.loading ? "Updating…" : esc(ago())}</span><button type="button" class="btn sm onacc" data-a="refresh" style="margin-left:auto">Refresh</button></div>`}</header>`;
  }
  const signedOutHTML = () => S.signedOut ? `<div class="warn" role="alert"><b>You've been signed out of the council site.</b><span class="note">Your plan is saved on this phone. Sign in again to carry on.</span><button type="button" class="btn pri sm" data-a="signin" style="align-self:flex-start">Sign in again</button></div>` : "";
  function tabsHTML() {
    const t = (id, label, ic) => `<button type="button" class="tab" data-a="tab" data-tab="${id}"${U.tab === id ? ' aria-current="page"' : ""}>${ic}${label}</button>`;
    return `<nav class="tabs" aria-label="Sections">${t("today", "Today", ICON.today)}${t("cal", "Calendar", ICON.cal)}${t("veh", "Vehicles", ICON.car)}${t("more", "More", ICON.more)}</nav>`;
  }
  function trayHTML() {
    if (!S.entries.length) return "";
    const p = plan(), n = S.entries.length;
    const title = p.count ? `${plural(p.count, "voucher")} planned${p.cost != null ? " · " + gbp(p.cost) : ""}` : `${plural(n, "change")} planned`;
    return `<div class="tray"><button type="button" class="grow" data-a="plan" style="background:none;border:0;color:inherit;text-align:left;padding:0"><b>${esc(title)}</b><small>${p.short ? "Not enough vouchers. See plan." : "Tap to see your plan"}</small></button><button type="button" class="btn sm" data-a="review"${p.ready ? "" : " disabled"}>Review</button></div>`;
  }

  // ---------- Today ----------
  function todayHTML() {
    const vs = visits(), tk = TK(), repl = replacedSet();
    const live = vs.filter((v) => v.dk === tk && status(v.dk, v.start, v.end) === "live");
    const last = key(addDays(S.today, 7));
    const next = [
      ...vs.filter((v) => v.dk <= last && status(v.dk, v.start, v.end) === "up").map((v) => ({ dk: v.dk, f: v.start, html: visitRow(v, repl) })),
      ...S.entries.filter((e) => e.dk <= last).map((e) => ({ dk: e.dk, f: e.from, html: entryRow(e) }))
    ].sort((a, b) => a.dk.localeCompare(b.dk) || a.f - b.f);
    const favs = S.vehicles.filter((v) => v.fav).sort(byVehicle);
    return `${headerHTML("Today")}<main class="body" data-tab="today">${signedOutHTML()}
      <h2 class="h">On now</h2>${live.length ? live.map(liveCard).join("") : `<p class="empty">No visitor is booked right now.</p>`}
      <h2 class="h">Next 7 days</h2>${next.length ? `<div class="list">${next.slice(0, 6).map((x) => x.html).join("")}</div>${next.length > 6 ? `<button type="button" class="btn sm flat" data-a="tab" data-tab="cal">See all ${next.length} in Calendar</button>` : ""}` : `<p class="empty">Nothing booked or planned.</p>`}
      ${favs.length ? `<h2 class="h">Book a favourite</h2><div class="chiprow scroll">${favs.map((v) => `<button type="button" class="chip" data-a="quick" data-vrn="${esc(v.vrn)}">${esc(v.nick)}</button>`).join("")}</div>` : ""}
      <button type="button" class="btn pri wide" data-a="quick">${ICON.plus}Book a visitor</button></main>`;
  }
  function liveCard(v) {
    const veh = vehicle(v.vrn), pct = Math.round(((S.now - v.start) / (v.end - v.start)) * 100);
    const carry = ctlAt(v.dk, v.end), canExtend = carry && carry.f <= v.end;
    const shrink = P.shrinkOptions(v.items, S.now);
    const endBtn = shrink.length && S.settings.betaLive ? `<button type="button" class="btn sm dan" data-a="visit" data-k="${esc(vkey(v))}" data-mode="end">End early</button>` : "";
    return `<div class="card now"><div class="row between"><div class="row" style="min-width:0"><span class="name">${vName(veh)}</span>${plateHTML(v.vrn)}</div><span class="pill live">In progress</span></div>
      <div class="prog" role="progressbar" aria-label="Time used" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="row between"><span class="sub num">${range(v.start, v.end)} · ${plural(v.items.length, "voucher")}</span><b class="sub">Ends ${hm(v.end)}</b></div>
      <div class="row between"><span class="sub">${canExtend ? `Controls run until ${hm(carry.t)}.` : "Covers the rest of today's controls."}</span><span class="row">${endBtn}${canExtend ? `<button type="button" class="btn sm" data-a="extend" data-vrn="${esc(v.vrn)}" data-dk="${v.dk}" data-end="${v.end}">Extend</button>` : ""}</span></div></div>`;
  }
  const dayCell = (dk) => { const d = fromKey(dk); return `<div class="col day"><b>${dk === TK() ? "Today" : DOW[P.isoDow(d) - 1]}</b><span class="sub">${d.getDate()} ${M.MON[d.getMonth()]}</span></div>`; };
  function visitRow(v, repl, noDay) {
    const veh = vehicle(v.vrn), chg = v.ids.some((id) => repl.has(id)), st = status(v.dk, v.start, v.end);
    const pill = chg ? `<span class="pill red">Changing</span>` : st === "live" ? `<span class="pill live">On now</span>` : st === "past" ? `<span class="pill past">Finished</span>` : `<span class="pill">Booked</span>`;
    return `<button type="button" class="li" data-a="visit" data-k="${esc(vkey(v))}">${noDay ? "" : dayCell(v.dk)}<div class="grow col"><span class="name">${vName(veh)}</span><div class="row" style="gap:8px">${plateHTML(v.vrn, "sm")}<span class="sub num">${range(v.start, v.end)}</span></div></div>${pill}</button>`;
  }
  function entryRow(e, noDay) {
    const veh = vehicle(e.vrn);
    return `<button type="button" class="li" data-a="entry" data-id="${e.id}">${noDay ? "" : dayCell(e.dk)}<div class="grow col"><span class="name">${vName(veh)}</span><div class="row" style="gap:8px">${plateHTML(e.vrn, "sm")}<span class="sub num">${e.replaces ? "Change to " : ""}${range(e.from, e.to)}</span></div></div><span class="pill plan">${e.replaces ? "Change" : "Planned"}</span></button>`;
  }

  // ---------- Calendar ----------
  function calHTML() {
    if (U.dayView) return dayViewHTML();
    const start = weekStart(S.today), end = addDays(S.today, P.WINDOW_DAYS), n = Math.ceil(((end - start) / 864e5 + 1) / 7) * 7;
    const booked = new Set(S.bookings.map((b) => b.date)), planned = new Set(S.entries.map((e) => e.dk));
    let grid = DOW.map((x) => `<span class="w">${x[0]}</span>`).join("");
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i), dk = key(d), c = controls(d), off = c && !c.length;
      grid += `<button type="button" class="${off ? "off" : ""}${dk === TK() ? " today" : ""}" data-a="calday" data-dk="${dk}" aria-pressed="${U.calDay === dk}" aria-label="${fmtDay(d)}${booked.has(dk) ? ", booked" : ""}${planned.has(dk) ? ", planned" : ""}"${P.inWindow(S.today, d) || booked.has(dk) ? "" : " disabled"}>${d.getDate()}<span class="mk">${booked.has(dk) ? "<i></i>" : ""}${planned.has(dk) ? '<i class="p"></i>' : ""}</span></button>`;
    }
    const dk = U.calDay || TK(), d = fromKey(dk), repl = replacedSet();
    const items = [...visits().filter((v) => v.dk === dk).map((v) => ({ f: v.start, html: visitRow(v, repl, true) })), ...S.entries.filter((e) => e.dk === dk).map((e) => ({ f: e.from, html: entryRow(e, true) }))].sort((a, b) => a.f - b.f);
    const extra = `<button type="button" class="btn sm" data-a="board" style="background:#fff">${ICON.rotate}Timeline</button>`;
    return `${headerHTML("Calendar", extra, { zone: false })}<main class="body" data-tab="cal">${signedOutHTML()}
      <div class="cal" aria-label="Next 4 weeks">${grid}</div>
      <div class="legend"><span><span class="mk"><i></i></span>Booked</span><span><span class="mk"><i class="p"></i></span>In your plan</span><span><i style="width:12px;height:12px;border-radius:3px;background:#eef1f5;border:1px solid var(--line)"></i>No controls</span></div>
      <div class="row between"><h2 class="h" style="margin:0">${fmtDay(d)}</h2><span class="sub">${esc(M.ctlText(S.zone, d))}</span></div>
      ${items.length ? `<div class="list">${items.map((x) => x.html).join("")}</div>` : `<p class="empty">Nothing booked or planned.</p>`}
      <div class="acts"><button type="button" class="btn" data-a="dayview" data-dk="${dk}">Day timeline</button>${P.inWindow(S.today, d) ? `<button type="button" class="btn pri" data-a="quick" data-dk="${dk}">Book this day</button>` : ""}</div>
      ${landMQ.matches ? "" : `<p class="note">Turn your phone, or press Timeline, for the week board.</p>`}</main>`;
  }

  // Day timeline (portrait): hours down the side, one lane per vehicle. Long-press and drag on a lane to plan a booking.
  const PX_H = 80;
  function dayViewHTML() {
    const dk = U.dayView, d = fromKey(dk), win = dayWindow(dk), H = ((win.t - win.f) / 60) * PX_H, y = (m) => ((m - win.f) / 60) * PX_H;
    const lanes = laneVehicles([dk]), LW = 104, X0 = 46, repl = replacedSet(), vs = visits().filter((v) => v.dk === dk);
    let h = "";
    for (let m = win.f; m <= win.t; m += 60) h += `<span class="hourlbl num" style="top:${y(m)}px">${hm(m)}</span><span class="hourline" style="top:${y(m)}px;left:${X0}px"></span>`;
    const c = controls(d) || [];
    h += `<div class="hatch" style="position:absolute;left:${X0}px;right:0;top:0;height:${H}px;border-radius:8px"></div>`;
    for (const x of c) h += `<div class="ctlband" style="left:${X0}px;right:0;top:${y(x.f)}px;height:${y(x.t) - y(x.f)}px"></div>`;
    lanes.forEach((v, i) => {
      let blocks = "";
      for (const g of vs.filter((x) => x.vrn === v.vrn)) {
        const st = status(dk, g.start, g.end), chg = g.ids.some((id) => repl.has(id));
        blocks += `<button type="button" class="blk${st === "past" ? " past" : ""}${st === "live" ? " live" : ""}${chg ? " chg" : ""}" data-a="visit" data-k="${esc(vkey(g))}" style="left:4px;right:4px;top:${y(g.start) + 1}px;height:${Math.max(18, y(g.end) - y(g.start) - 2)}px" aria-label="${esc(vText(v))}, ${range(g.start, g.end)}, ${st === "live" ? "in progress" : st === "past" ? "finished" : "booked"}"><span class="num">${range(g.start, g.end)}</span>${st === "live" ? "<span>In progress</span>" : ""}</button>`;
      }
      for (const e of S.entries.filter((x) => x.dk === dk && x.vrn === v.vrn)) blocks += `<button type="button" class="blk plan" data-a="entry" data-id="${e.id}" style="left:4px;right:4px;top:${y(e.from) + 1}px;height:${Math.max(18, y(e.to) - y(e.from) - 2)}px" aria-label="${esc(vText(v))}, ${range(e.from, e.to)}, planned"><span class="num">${range(e.from, e.to)}</span></button>`;
      h += `<div class="lanecol" data-lane="1" data-vrn="${esc(v.vrn)}" data-dk="${dk}" data-f="${win.f}" style="position:absolute;left:${X0 + i * (LW + 4)}px;width:${LW}px;top:0;height:${H}px">${blocks}</div>`;
    });
    if (dk === TK() && S.now >= win.f && S.now <= win.t) h += `<div class="nowline" style="left:${X0 - 6}px;right:0;top:${y(S.now) - 1}px;height:2px"></div>`;
    const width = X0 + lanes.length * (LW + 4);
    const head = `<div class="dayhead" style="grid-template-columns:${X0 - 4}px repeat(${lanes.length},${LW}px);width:${width}px"><span></span>${lanes.map((v) => `<div class="col" style="align-items:center"><span class="name" style="font-size:13px;max-width:100%">${esc(isFav(v) ? v.nick : "Other")}</span>${plateHTML(v.vrn, "sm")}</div>`).join("")}</div>`;
    const prev = key(addDays(d, -1)), next = key(addDays(d, 1));
    const extra = `<button type="button" class="btn sm" data-a="board" style="background:#fff">${ICON.rotate}Timeline</button>`;
    return `${headerHTML("Calendar", extra, { zone: false })}<main class="body" data-tab="cal${dk}">
      <div class="row between"><button type="button" class="btn sm" data-a="dayview" data-dk="">Back</button><div class="row"><button type="button" class="btn sm flat" data-a="dayview" data-dk="${prev}" aria-label="Previous day">${ICON.left}</button><b>${fmtDay(d)}</b><button type="button" class="btn sm flat" data-a="dayview" data-dk="${next}" aria-label="Next day">${ICON.right}</button></div></div>
      <p class="note">${esc(M.ctlText(S.zone, d))}. ${P.inWindow(S.today, d) ? "Press and hold on a lane, then drag, to plan a booking." : ""}</p>
      <div style="overflow-x:auto;margin:0 -16px;padding:0 16px">${head}<div class="dayview" style="height:${H + 12}px;width:${width}px;margin-top:8px">${h}</div></div></main>`;
  }

  // ---------- Vehicles ----------
  function vehicleStatus(v) {
    const vs = visits().filter((x) => x.vrn === v.vrn);
    const live = vs.find((x) => status(x.dk, x.start, x.end) === "live");
    if (live) return `<span class="sub" style="color:var(--ok)">On now, until ${hm(live.end)}</span>`;
    const up = vs.filter((x) => status(x.dk, x.start, x.end) === "up").sort((a, b) => a.dk.localeCompare(b.dk) || a.start - b.start)[0];
    const n = S.entries.filter((e) => e.vrn === v.vrn).length;
    if (up) return `<span class="sub">Next: ${fmtDay(fromKey(up.dk))}, ${hm(up.start)}${n ? ` · ${n} planned` : ""}</span>`;
    return `<span class="sub">${n ? `${n} in your plan` : "Nothing booked"}</span>`;
  }
  function vehiclesHTML() {
    return `${headerHTML("Vehicles", null, { zone: false })}<main class="body" data-tab="veh">${signedOutHTML()}
      <input type="search" class="inp" data-in="vq" placeholder="Search name or plate" value="${esc(U.vq)}" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Search vehicles">
      <div id="vlist">${vehicleListHTML()}</div>
      <button type="button" class="btn wide" data-a="newfav">${ICON.plus}Save a new favourite</button>
      <p class="note">Favourites are saved to your council account. Tap one for its bookings and to delete it.</p></main>`;
  }
  function vehicleListHTML() {
    const q = U.vq.trim().toLowerCase(), nq = W.normVrn(q);
    const match = (v) => !q || v.nick.toLowerCase().includes(q) || (nq && v.vrn.includes(nq));
    const favs = S.vehicles.filter((v) => v.fav && match(v)).sort(byVehicle), others = S.vehicles.filter((v) => !v.fav && match(v)).sort(byVehicle);
    const row = (v) => `<div class="li"><button type="button" class="grow col" data-a="veh" data-vrn="${esc(v.vrn)}" style="background:none;border:0;text-align:left;padding:0;color:inherit"><div class="row"><span class="name">${vName(v)}</span>${plateHTML(v.vrn, "sm")}</div>${vehicleStatus(v)}</button><button type="button" class="btn sm" data-a="quick" data-vrn="${esc(v.vrn)}">Book</button></div>`;
    return (favs.length ? `<h2 class="h">Favourites</h2><div class="list">${favs.map(row).join("")}</div>` : "") +
      (others.length ? `<h2 class="h">Other vehicles</h2><div class="list">${others.map(row).join("")}</div>` : "") +
      (!favs.length && !others.length ? `<p class="empty">No vehicles match.</p>` : "");
  }

  // ---------- More ----------
  function moreHTML() {
    const usable = S.permits.filter(W.isUsableVisitorPermit), st = S.settings;
    const sw = (k, label, sub) => `<div class="li"><div class="grow col"><b>${label}</b><span class="sub">${sub}</span></div><button type="button" class="sw" role="switch" aria-checked="${!!st[k]}" aria-label="${label}" data-a="set" data-k="${k}"></button></div>`;
    return `${headerHTML("More", null, { zone: false })}<main class="body" data-tab="more">${signedOutHTML()}
      ${usable.length > 1 ? `<label class="field"><span class="label">Permit</span><select class="sel" data-in="permit">${usable.map((p) => `<option value="${esc(p.id)}"${p.id === S.permitId ? " selected" : ""}>${esc(p.ref)} · ${esc(p.zoneName.split(" - ")[0])}</option>`).join("")}</select></label>` : ""}
      ${S.subzones.length ? `<label class="field"><span class="label">Parking in</span><select class="sel" data-in="subzone"><option value="">Choose…</option>${S.subzones.map((z) => `<option value="${esc(z.code)}"${S.zone && S.zone.code === z.code ? " selected" : ""}>${esc(z.code)} · ${esc(z.name)}</option>`).join("")}</select></label>` : ""}
      <h2 class="h">Settings</h2><div class="list">
        ${sw("testMode", "Test mode", "Checks bookings with the council site without booking or using vouchers")}
        ${sw("betaLive", "Beta: end bookings early", "Adds End early to bookings in progress")}
        ${sw("emailAll", "Email confirmations", "The council emails you for each voucher booked")}
        ${sw("reminders", "Reminders", "On this phone, before a voucher ends")}
        ${st.reminders ? `<label class="li"><span class="grow"><b>Remind me</b></span><select class="sel" data-in="lead" style="width:auto">${[5, 10, 15, 30].map((m) => `<option value="${m}"${st.lead === m ? " selected" : ""}>${m} min before</option>`).join("")}</select></label>` : ""}
      </div>
      <div class="list">
        <button type="button" class="li" data-a="council"><b class="grow">Show council site</b><span class="sub">›</span></button>
        <button type="button" class="li" data-a="terms"><b class="grow">Terms</b><span class="sub">›</span></button>
        <a class="li" href="${ISSUES_URL}" style="text-decoration:none"><b class="grow">Report issue</b><span class="sub">›</span></a>
        ${S.lastReport ? `<button type="button" class="li" data-a="report"><div class="grow col"><b>Share last error details</b><span class="sub">Tokens are removed</span></div><span class="sub">›</span></button>` : ""}
        ${U.confirmSignOut ? `<div class="li danger" style="border-radius:0"><div class="grow col"><b>Sign out of the council site?</b><span class="sub">Your plan stays on this phone.</span></div><button type="button" class="btn sm dan pri" data-a="signoutyes">Sign out</button><button type="button" class="btn sm flat" data-a="signout">Keep</button></div>`
          : `<button type="button" class="li" data-a="signout"><b class="grow" style="color:var(--bad)">Sign out of council site</b></button>`}
      </div>
      <p class="note">Voucherboard Beta${S.version ? " v" + esc(S.version) : ""}. © 2026 ${esc(T.OWNER)}. An independent tool, not made or endorsed by Lewisham Council. You use it entirely at your own risk.</p></main>`;
  }

  // ---------- landscape board ----------
  const ZOOMS = ["cal", "week", "day"];
  function boardDays() {
    const z = U.board.zoom, c = U.board.cursor;
    if (z === "day") return [c];
    if (z === "week") { const ws = weekStart(c); return [...Array(7)].map((_, i) => addDays(ws, i)); }
    const ws = weekStart(S.today); return [...Array(28)].map((_, i) => addDays(ws, i));
  }
  function boardWindow(days) {
    if (U.board.zoom === "day") return dayWindow(key(days[0]));
    if (!S.zone) return { f: 7 * 60, t: 19 * 60 };
    let f = 1440, t = 0; for (const r of S.zone.rules) { f = Math.min(f, r.f); t = Math.max(t, r.t); }
    return { f: Math.max(0, f - 60), t: Math.min(1440, t + 60) };
  }
  function renderBoard() {
    const el = $(".board"); if (!el) return;
    const days = boardDays(), keys = days.map(key), win = boardWindow(days), n = days.length, span = win.t - win.f;
    const x = (i, m) => ((i + (Math.min(Math.max(m, win.f), win.t) - win.f) / span) / n) * 100;
    const repl = replacedSet(), vs = visits().filter((v) => keys.includes(v.dk)), sel = U.board.select;
    const label = U.board.zoom === "day" ? fmtDay(days[0]) : `${days[0].getDate()} ${M.MON[days[0].getMonth()]} – ${days[n - 1].getDate()} ${M.MON[days[n - 1].getMonth()]}`;
    const zb = (z, l) => `<button type="button" data-a="zoom" data-z="${z}" aria-pressed="${U.board.zoom === z}">${l}</button>`;
    const p = S.entries.length ? plan() : null;
    let h = `<header class="lshead"><button type="button" class="iconbtn exit" data-a="boardexit" aria-label="Back to portrait">${ICON.phone}</button>
      <div class="seg" role="group" aria-label="Zoom">${zb("cal", "28 days")}${zb("week", "Week")}${zb("day", "Day")}</div>
      ${U.board.zoom === "cal" ? "" : `<button type="button" class="iconbtn" data-a="bnav" data-d="-1" aria-label="Previous">${ICON.left}</button>`}<b class="num">${label}</b>${U.board.zoom === "cal" ? "" : `<button type="button" class="iconbtn" data-a="bnav" data-d="1" aria-label="Next">${ICON.right}</button>`}
      ${p ? `<button type="button" class="lspill" data-a="plan">${esc(p.count ? plural(p.count, "voucher") + " planned" : plural(S.entries.length, "change") + " planned")} · Review</button>` : ""}</header>`;
    // day labels and, in day zoom, hours
    let head = "";
    if (U.board.zoom === "day") { for (let m = Math.ceil(win.f / 60) * 60; m < win.t; m += 60) head += `<span style="position:absolute;left:${x(0, m)}%;font-size:11px;font-weight:700;color:var(--muted)" class="num">${hShort(m)}</span>`; }
    else days.forEach((d, i) => { const c = controls(d); head += `<span class="${key(d) === TK() ? "today" : c && !c.length ? "off" : ""}" style="position:absolute;left:${(i / n) * 100}%;width:${100 / n}%;text-align:center;font-size:${n > 7 ? 10 : 12}px;font-weight:800">${n > 7 ? d.getDate() : DOW[P.isoDow(d) - 1] + " " + d.getDate()}</span>`; });
    const minW = n > 7 ? 28 * 26 : n === 7 ? 7 * 84 : 520;
    let rows = `<div class="grow-h head"><span class="who"></span><div class="track" style="flex:1;min-width:${minW}px;height:20px">${head}</div></div>`;
    const lanes = laneVehicles(keys);
    for (const v of lanes) {
      let t = "";
      days.forEach((d, i) => {
        const c = controls(d) || [];
        for (const r of c) t += `<div class="ctlband" style="top:0;bottom:0;left:${x(i, r.f)}%;width:${x(i, r.t) - x(i, r.f)}%"></div>`;
        if (i) t += `<div class="dsep" style="left:${(i / n) * 100}%"></div>`;
      });
      for (const g of vs.filter((y) => y.vrn === v.vrn)) {
        const i = keys.indexOf(g.dk), st = status(g.dk, g.start, g.end), chg = g.ids.some((id) => repl.has(id)), k = "b:" + vkey(g);
        t += `<button type="button" class="blk${st === "past" ? " past" : ""}${st === "live" ? " live" : ""}${chg ? " chg" : ""}${sel && sel.has(k) ? " sel" : ""}" data-a="visit" data-k="${esc(vkey(g))}" data-sk="${esc(k)}" style="top:6px;height:28px;left:${x(i, g.start)}%;width:max(4px,${x(i, g.end) - x(i, g.start)}%);padding:0" aria-label="${esc(vText(v))}, ${fmtDay(fromKey(g.dk))}, ${range(g.start, g.end)}"></button>`;
      }
      for (const e of S.entries.filter((y) => y.vrn === v.vrn && keys.includes(y.dk))) {
        const i = keys.indexOf(e.dk), k = "e:" + e.id;
        t += `<button type="button" class="blk plan${sel && sel.has(k) ? " sel" : ""}" data-a="entry" data-id="${e.id}" data-sk="${esc(k)}" style="top:6px;height:28px;left:${x(i, e.from)}%;width:max(4px,${x(i, e.to) - x(i, e.from)}%);padding:0" aria-label="${esc(vText(v))}, ${fmtDay(fromKey(e.dk))}, ${range(e.from, e.to)}, planned"></button>`;
      }
      const ti = keys.indexOf(TK());
      if (ti >= 0 && S.now > win.f && S.now < win.t) t += `<div class="nowline" style="top:0;bottom:0;width:2px;left:${x(ti, S.now)}%"></div>`;
      rows += `<div class="grow-h"><button type="button" class="who" data-a="veh" data-vrn="${esc(v.vrn)}"><span class="name" style="font-size:13px">${esc(isFav(v) ? v.nick : "Other")}</span>${plateHTML(v.vrn, "sm")}</button><div class="track hatch" data-track="1" data-vrn="${esc(v.vrn)}" style="flex:1;min-width:${minW}px">${t}</div></div>`;
    }
    const foot = sel
      ? `<div class="selbar"><b>${plural(sel.size, "item")} selected</b><span class="sub">Tap more to add them</span><span style="margin-left:auto" class="row"><button type="button" class="btn sm" data-a="bulk"${sel.size ? "" : " disabled"}>Change or cancel</button><button type="button" class="btn sm flat" data-a="selclear">Done</button></span></div>`
      : `<div class="bfoot"><span class="row" style="gap:6px"><i style="width:14px;height:10px;border-radius:3px;background:var(--accent)"></i>Booked</span><span class="row" style="gap:6px"><i style="width:14px;height:10px;border-radius:3px;border:1.5px dashed var(--accent)"></i>In your plan</span><span class="row" style="gap:6px"><i class="hatch" style="width:14px;height:10px;border-radius:3px"></i>No controls</span><span style="margin-left:auto"><b>Pinch</b> to zoom · <b>press and hold</b> to plan or select</span></div>`;
    el.innerHTML = h + `<div class="grid" id="bgrid">${rows}</div>` + foot;
    el._map = { days, keys, win, n };
  }

  // ---------- sheets ----------
  const top = () => U.sheets[U.sheets.length - 1];
  function openSheet(s) { U.sheets.push(s); renderSheet(); }
  function closeSheet() { U.sheets.pop(); renderSheet(); }
  function closeSheets() { U.sheets = []; renderSheet(); }
  function renderSheet() {
    const L = $("#layer"), s = top();
    if (!s) { L.hidden = true; L.innerHTML = ""; return; }
    const html = { quick: quickHTML, confirm: confirmHTML, plan: planHTML, entry: entryHTML, visit: visitHTML, veh: vehHTML, newfav: newFavHTML, bulk: bulkHTML, terms: termsSheetHTML }[s.type](s);
    L.hidden = false;
    L.innerHTML = `<button type="button" class="scrim" data-a="close" aria-label="Close"></button><section class="sheet${s.tall ? " tall" : ""}" role="dialog" aria-modal="true" aria-label="${esc(s.title || "")}"><div class="grab"></div>${html}</section>`;
  }
  const sheetHead = (title, sub) => `<div class="row between"><div class="col"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}</div><button type="button" class="btn sm flat" data-a="close">Close</button></div>`;

  // Quick-book: vehicle, when, how long. Add to plan, or book now after a check-and-book step.
  function openQuick(o = {}, q0) {
    U.sheets = [{ type: "quick", title: "Book a visitor", qq: "", newv: null, ...(q0 || E.quickInit(o)) }]; renderSheet();
    return top();
  }
  function quickHTML(q) {
    const pv = E.quickPreview(q), dayMode = q.when === "days";
    const chips = q.vrns.map((vrn) => { const v = vehicle(vrn); return `<button type="button" class="chip x" aria-pressed="true" data-a="qrm" data-vrn="${esc(vrn)}" aria-label="Remove ${esc(vText(v))}">${esc(isFav(v) ? v.nick : spaced(v.vrn))}<span>×</span></button>`; }).join("");
    const seg = (w, l) => `<button type="button" data-a="qwhen" data-w="${w}" aria-pressed="${q.when === w}">${l}</button>`;
    const sel = E.quickSel(q);
    const presets = E.quickPresets(q).map((p) => `<button type="button" class="chip" data-a="qpre" data-p="${p.id}" aria-pressed="${p.on}">${esc(p.label)}</button>`).join("");
    return `${sheetHead("Book a visitor")}
      <div class="field"><span class="label">Vehicle</span>${chips ? `<div class="chiprow">${chips}</div>` : ""}
        <div class="row"><input type="text" class="inp plateinp grow" data-in="qq" value="${esc(q.qq)}" placeholder="${q.vrns.length ? "Add another vehicle" : "Name or plate, or a new plate"}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="20" aria-label="Vehicle">${scanBtnHTML(q)}</div>
        ${scanHTML(q)}<div id="qsugg">${quickSuggHTML(q)}</div>${q.newv ? newVehicleHTML(q.newv) : ""}</div>
      <div class="field"><span class="label">When</span><div class="seg" role="group" aria-label="When">${seg("now", "Now")}${seg("today", "Today")}${seg("days", "Pick days")}</div>
        ${dayMode ? quickDaysHTML(q) : ""}</div>
      <div class="field"><span class="label">How long</span><div class="chiprow">${presets}</div>
        <div class="times"><label>From<input type="time" class="inp num" data-in="qfrom" value="${hm(sel.from)}" step="300"${q.when === "now" ? " disabled" : ""}></label><label>Until<input type="time" class="inp num" data-in="qto" value="${hm(sel.to)}" step="300"></label></div>
        ${q.when === "now" ? `<span class="note">Starts now. Hours outside controls are skipped; no voucher is needed then.</span>` : `<span class="note">Hours outside controls are skipped; no voucher is needed then.</span>`}</div>
      <div class="cost${pv.bad ? " bad" : ""}" id="qcost">${esc(pv.text)}</div>${(pv.notes || []).map((t) => `<p class="note warn">${esc(t)}</p>`).join("")}
      <div class="acts"><button type="button" class="btn" data-a="qplan"${pv.cands.length ? "" : " disabled"}>Add to plan</button><button type="button" class="btn pri" data-a="qbook"${pv.ok ? "" : " disabled"}>Book now</button></div>`;
  }
  // ---------- number plate scanning ----------
  // The phone reads the text on device; VB.plates picks out UK plates. A scan only fills in a plate: the user still books.
  const scanBtnHTML = (s) => `<button type="button" class="btn sm" data-a="scan" aria-expanded="${!!s.scanMenu}" aria-label="Scan a number plate" style="min-height:52px">${ICON.camera}Scan</button>`;
  function scanHTML(s) {
    if (s.scanMenu) return `<div class="acts"><button type="button" class="btn sm" data-a="scango" data-src="camera">${ICON.camera}Use camera</button><button type="button" class="btn sm" data-a="scango" data-src="photos">Choose a photo</button></div><span class="note">The picture is read on your phone. It isn't kept or sent anywhere.</span>`;
    if (s.scanBusy) return `<p class="note">Reading the number plate…</p>`;
    if (s.scanErr) return `<p class="note bad">${esc(s.scanErr)}</p>`;
    if (!s.scan) return "";
    return `<div class="col" style="gap:8px"><span class="label">${s.scan.length > 1 ? "Plates found. Tap the right one" : "Plate found. Tap to use it"}</span><div class="chiprow">${s.scan.map((c) => { const v = S.vehicles.find((x) => x.vrn === c.vrn); return `<button type="button" class="chip" data-a="scanpick" data-vrn="${esc(c.vrn)}">${plateHTML(c.vrn, "sm")}${v && isFav(v) ? " " + esc(v.nick) : ""}</button>`; }).join("")}</div><span class="note">Check it matches the car before you book.</span></div>`;
  }
  // Re-rendering a sheet redraws its inputs, so keep what's been typed in the new-favourite form.
  function keepTyped(s) { if (s.type === "newfav" && $("#nfPlate")) { s.vrn = $("#nfPlate").value; s.nick = $("#nfNick").value; } }
  async function scan(source) {
    const s = top(); if (!s) return;
    keepTyped(s);
    Object.assign(s, { scanMenu: false, scanBusy: true, scanErr: "", scan: null }); renderSheet();
    const r = await E.scan(source);
    if (top() !== s) return;
    s.scanBusy = false;
    if (!r.cancelled) { s.scan = r.cands || null; s.scanErr = r.err || ""; }
    renderSheet();
  }

  function quickSuggHTML(q) {
    const g = E.suggest(q.qq, q.vrns);
    if (!q.qq.trim()) return q.vrns.length ? "" : `<div class="chiprow scroll">${g.matches.map((v) => `<button type="button" class="chip" data-a="qpick" data-vrn="${esc(v.vrn)}">${esc(v.nick)}</button>`).join("")}</div>`;
    return `<div class="list">${g.matches.map((v) => `<button type="button" class="li" data-a="qpick" data-vrn="${esc(v.vrn)}"><span class="name grow">${vName(v)}</span>${plateHTML(v.vrn, "sm")}</button>`).join("")}${g.newVrn ? `<button type="button" class="li" data-a="qnew" data-vrn="${esc(g.newVrn)}"><span class="grow"><b>New vehicle</b></span>${plateHTML(g.newVrn, "sm")}</button>` : ""}${!g.matches.length && !g.newVrn ? `<div class="li sub">No vehicle matches.</div>` : ""}</div>`;
  }
  function newVehicleHTML(n) {
    return `<div class="card" role="group" aria-label="New vehicle"><b>New vehicle</b>
      <label class="field"><span class="label">Number plate${n.scanned ? " (check it matches the car)" : ""}</span><input type="text" class="inp plateinp" data-in="qnvplate" value="${esc(spaced(n.vrn))}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="12"></label>
      <div class="li" style="padding:0;border:0;min-height:44px"><div class="grow col"><b>Save as favourite</b><span class="sub">Saved to your council account with the first booking</span></div><button type="button" class="sw" role="switch" aria-checked="${n.save}" aria-label="Save as favourite" data-a="qnvsave"></button></div>
      ${n.save ? `<label class="field"><span class="label">Nickname</span><input type="text" class="inp" data-in="qnick" value="${esc(n.nick)}" autocomplete="off"></label>` : ""}
      ${n.error ? `<span class="err">${esc(n.error)}</span>` : ""}
      <div class="acts"><button type="button" class="btn pri sm" data-a="qnvadd"${n.checking ? " disabled" : ""}>${n.checking ? "Checking…" : "Add vehicle"}</button><button type="button" class="btn sm flat" data-a="qnvno">Cancel</button></div></div>`;
  }
  function quickDaysHTML(q) {
    const v = E.quickDays(q);
    const cal = DOW.map((x) => `<span class="w">${x[0]}</span>`).join("") + v.days.map((d) => `<button type="button" class="${d.off ? "off" : ""}${d.today ? " today" : ""}" data-a="qday" data-dk="${d.dk}" aria-pressed="${d.on}" aria-label="${esc(d.label)}"${d.enabled ? "" : " disabled"} style="height:38px">${d.date}</button>`).join("");
    return `<div class="chiprow scroll">${v.choices.map((c) => `<button type="button" class="chip" data-a="qdays" data-q="${c.id}">${esc(c.label)}</button>`).join("")}</div><div class="cal">${cal}</div><span class="sub">${v.count ? plural(v.count, "day") + " chosen" : "No days chosen"}</span>`;
  }

  function confirmHTML(s) {
    const q = s.q, pv = E.quickPreview(q), one = q.vrns.length === 1 ? vehicle(q.vrns[0]) : null;
    const need = { h1: 0, h5: 0, day: 0 }; for (const it of pv.items) if (it.need) for (const k of KINDS) need[k] += it.need[k];
    const n = need.h1 + need.h5 + need.day, days = [...new Set(pv.cands.map((c) => c.dk))];
    const c0 = pv.cands[0], test = S.settings.testMode;
    return `${sheetHead("Check and book")}
      ${one ? `<div class="col" style="gap:8px;align-items:flex-start">${plateHTML(one.vrn, "big")}<b>${vName(one)}</b></div>` : `<div class="chiprow">${q.vrns.map((v) => plateHTML(v)).join("")}</div>`}
      <div class="list">
        <div class="li"><span class="sub" style="width:84px">${days.length > 1 ? "Days" : "Day"}</span><b class="grow">${days.length > 2 ? plural(days.length, "day") + ", from " + fmtDay(fromKey(days[0])) : days.map((d) => (d === TK() ? "Today, " : "") + fmtDay(fromKey(d))).join(" and ")}</b></div>
        <div class="li"><span class="sub" style="width:84px">Time</span><b class="grow num">${range(c0.from, c0.to)}${q.when === "now" ? ", starting now" : ""}</b></div>
        <div class="li"><span class="sub" style="width:84px">Vouchers</span><b class="grow">${typesText(need)}</b></div>
        <div class="li"><span class="sub" style="width:84px">Email</span><span class="grow">Send me a confirmation</span><button type="button" class="sw" role="switch" aria-checked="${!!s.email}" aria-label="Send confirmation email" data-a="cemail"></button></div>
      </div>
      <p class="note">${test ? "Test mode: this checks the booking with the council site but doesn't book it or use a voucher." : "This books for real on the council site. Once a voucher starts it can't be cancelled."}</p>
      <button type="button" class="btn pri wide" data-a="cgo">${test ? "Run test" : `Book ${plural(n, "voucher")}`}</button>
      <button type="button" class="btn flat wide" data-a="close">Back</button>`;
  }

  function planHTML() {
    const p = plan(), items = p.items, adv = E.advice();
    const byDay = new Map(); for (const it of items) { if (!byDay.has(it.dk)) byDay.set(it.dk, []); byDay.get(it.dk).push(it); }
    const rows = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dk, its]) => its.map((it, i) => {
      const e = it.entry, v = vehicle(e.vrn), bad = it.notes.find((n) => n.c === "bad");
      return `<div class="li">${i ? `<div class="day"></div>` : dayCell(dk)}<button type="button" class="grow col" data-a="entry" data-id="${e.id}" style="background:none;border:0;text-align:left;padding:0;color:inherit"><div class="row">${plateHTML(v.vrn, "sm")}${e.replaces ? '<span class="pill red">Change</span>' : ""}</div><span class="sub num">${range(e.from, e.to)}${it.need ? " · " + typesText(it.need) : it.bill ? "" : " · no voucher needed"}</span>${bad ? `<span class="note bad">${esc(bad.t)}</span>` : ""}</button><button type="button" class="btn sm flat" data-a="rment" data-id="${e.id}" aria-label="Remove ${esc(vText(v))} on ${fmtDay(fromKey(dk))}">${ICON.cross}</button></div>`;
    }).join("")).join("");
    const sub = [p.count && `${plural(p.count, "voucher")} to book`, p.cancels && `${p.cancels} to cancel`].filter(Boolean).join(" · ") || "Nothing to send";
    return `${sheetHead("Your plan", esc(sub + ". Nothing is sent until you review it."))}
      ${items.length ? `<div class="list">${rows}</div>` : `<p class="empty">Your plan is empty.</p>`}
      ${adviceHTML(adv, p)}
      ${p.cost != null && p.count ? `<div class="cost">Uses ${typesText(p.used)} · ${gbp(p.cost)} of vouchers</div>` : ""}
      <button type="button" class="btn pri wide" data-a="review"${p.ready ? "" : " disabled"}>Review ${plural(p.count + p.cancels, "change")}</button>
      ${items.length ? `<button type="button" class="btn flat wide" data-a="clearplan">${top() && top().confirmClear ? "Tap again to clear the whole plan" : "Clear plan"}</button>` : ""}`;
  }
  function adviceHTML(a, p) {
    if (!a) return "";
    const kinds = KINDS.filter((k) => a.buy[k]);
    const what = kinds.map((k) => { const n = a.buy[k], bk = S.prices[k].book; return bk > 1 ? `${n / bk} book${n / bk > 1 ? "s" : ""} of ${bk} × ${VT[k].label} (${gbp(n * S.prices[k].price)})` : `${n} × ${VT[k].label} (${gbp(n * S.prices[k].price)})`; }).join(" and ");
    const btns = kinds.map((k) => `<button type="button" class="btn sm pri" data-a="buy" data-k="${k}" data-n="${a.buy[k]}" style="align-self:flex-start">Buy ${a.buy[k]} × ${VT[k].label} on council site</button>`).join("");
    if (a.saving === null) return `<div class="warn"><b>${p.short ? "You need more vouchers." : "Buy " + esc(what)}</b><span class="note">Buy ${esc(what)}. Then the plan uses ${gbp(a.idealCost)} of vouchers. Your plan is kept while you pay.</span>${btns}</div>`;
    return `<div class="info"><b>Save ${gbp(a.saving)} by buying ${esc(what)}</b><span class="note">This mix suits these times better. Your plan is kept while you pay.</span>${btns}</div>`;
  }

  function entryHTML(s) {
    const e = S.entries.find((x) => x.id === s.id); if (!e) return sheetHead("Planned booking") + `<p class="empty">This is no longer in your plan.</p>`;
    const v = vehicle(e.vrn), it = plan().items.find((x) => x.entry === e);
    return `${sheetHead(e.replaces ? "Planned change" : "Planned booking", "Nothing is sent until you review your plan.")}
      <div class="col" style="gap:8px;align-items:flex-start">${plateHTML(v.vrn, "big")}<b>${vName(v)}</b></div>
      <div class="row between"><b>${fmtDay(fromKey(e.dk))}</b><span class="sub">${esc(M.ctlText(S.zone, fromKey(e.dk)))}</span></div>
      <div class="times"><label>From<input type="time" class="inp num" id="enFrom" value="${hm(e.from)}" step="300"></label><label>Until<input type="time" class="inp num" id="enTo" value="${hm(e.to)}" step="300"></label></div>
      ${s.err ? `<span class="err">${esc(s.err)}</span>` : ""}
      ${it ? `<div class="cost">${it.need ? "Uses " + typesText(it.need) : it.bill ? "Not enough vouchers" : "No voucher needed"}</div>${it.notes.map((n) => `<p class="note ${n.c}">${esc(n.t)}</p>`).join("")}` : ""}
      <div class="acts"><button type="button" class="btn" data-a="erm">${e.replaces ? "Drop this change" : "Remove from plan"}</button><button type="button" class="btn pri" data-a="esave">Save time</button></div>`;
  }

  function visitHTML(s) {
    const v = findVisit(s.k); if (!v) return sheetHead("Booking") + `<p class="empty">This booking is no longer on the council site.</p>`;
    const veh = vehicle(v.vrn), st = status(v.dk, v.start, v.end), d = fromKey(v.dk);
    const canCancel = v.items.every((i) => i.cancellable) && st === "up";
    const shrink = st === "live" ? P.shrinkOptions(v.items, S.now) : [];
    const pill = { past: '<span class="pill past">Finished</span>', live: '<span class="pill live">In progress</span>', up: '<span class="pill">Booked</span>' }[st];
    const strip = `<div class="row" style="gap:3px">${v.items.map((b) => { const run = b.start <= S.now && S.now < b.start + b.mins && v.dk === TK(); return `<span style="flex:1;height:26px;border-radius:5px;background:${run ? "var(--accent)" : st === "past" ? "#98a8b4" : "#8ea3c6"};color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center" class="num">${hShort(b.start)}–${hShort(b.start + b.mins)}</span>`; }).join("")}</div>`;
    let body = "";
    if (s.mode === "change") {
      body = `<h3 style="margin:0;font-size:17px">Change time</h3><div class="times"><label>From<input type="time" class="inp num" id="chFrom" value="${hm(s.f != null ? s.f : v.start)}" step="300"></label><label>Until<input type="time" class="inp num" id="chTo" value="${hm(s.t != null ? s.t : v.end)}" step="300"></label></div>
        ${s.err ? `<span class="err">${esc(s.err)}</span>` : ""}<p class="note">The booking is cancelled and rebooked at the new time when you review your plan.</p>
        <div class="acts"><button type="button" class="btn" data-a="vmode" data-mode="">Back</button><button type="button" class="btn pri" data-a="vchg">Add change to plan</button></div>`;
    } else if (s.mode === "cancel") {
      body = `<div class="danger" role="alert"><b>Cancel this booking?</b><span>${fmtDay(d)}, ${range(v.start, v.end)}</span><b style="color:var(--bad-ink)">${v.items.length > 1 ? `${v.items.length} vouchers go` : "1 voucher goes"} back to your unused vouchers.</b></div>
        <p class="note">This goes to the council site straight away. It isn't added to your plan.</p>
        <button type="button" class="btn dan pri wide" data-a="vcancel"${s.busy ? " disabled" : ""}>${s.busy ? "Cancelling…" : "Cancel booking"}</button><button type="button" class="btn flat wide" data-a="vmode" data-mode="">Keep it</button>`;
    } else if (s.mode === "end") {
      const o = shrink[s.opt || 0];
      body = `<div class="row"><h3 style="margin:0;font-size:17px">End early</h3><span class="tag test">Beta</span></div>
        ${shrink.map((x, i) => `<button type="button" class="card" data-a="vopt" data-i="${i}" aria-pressed="${(s.opt || 0) === i}" style="flex-direction:row;justify-content:space-between;align-items:center;text-align:left;${(s.opt || 0) === i ? "border:2px solid var(--bad)" : ""}"><b class="num">End at ${hm(x.end)}</b><span class="sub">Returns ${plural(x.cancel.length, "voucher")}</span></button>`).join("")}
        <p class="note">The voucher running now can't be cancelled, so a booking can only end when a voucher ends.</p>
        <button type="button" class="btn dan pri wide" data-a="vend"${s.busy ? " disabled" : ""}>${s.busy ? "Cancelling…" : `End at ${hm(o.end)}`}</button><button type="button" class="btn flat wide" data-a="vmode" data-mode="">Keep until ${hm(v.end)}</button>`;
    } else {
      const why = canCancel ? "" : st === "live" ? (shrink.length ? (S.settings.betaLive ? "" : "To end it early, turn on the beta option in More.") : "Started bookings can't be cancelled.") : st === "past" ? "This booking has finished." : "The council site doesn't allow cancelling this booking.";
      body = `${canCancel ? `<p class="note">You can cancel this until it starts at ${hm(v.start)} on ${fmtDay(d)}.</p>` : why ? `<p class="note">${esc(why)}</p>` : ""}
        <div class="acts">${canCancel ? `<button type="button" class="btn" data-a="vmode" data-mode="change">Change time</button>` : ""}<button type="button" class="btn" data-a="vagain">Book again</button></div>
        ${shrink.length && S.settings.betaLive ? `<button type="button" class="btn dan wide" data-a="vmode" data-mode="end">End early</button>` : ""}
        ${canCancel ? `<button type="button" class="btn dan wide" data-a="vmode" data-mode="cancel">Cancel booking</button>` : ""}`;
    }
    return `<div class="row between"><div class="col" style="gap:8px;align-items:flex-start">${plateHTML(v.vrn, "big")}<b>${vName(veh)}</b></div><div class="col" style="align-items:flex-end;gap:8px">${pill}<button type="button" class="btn sm flat" data-a="close">Close</button></div></div>
      <div class="list"><div class="li"><span class="sub" style="width:84px">Day</span><b>${fmtDay(d)}</b></div><div class="li"><span class="sub" style="width:84px">Time</span><b class="num">${range(v.start, v.end)}</b></div>
        <div class="li"><span class="sub" style="width:84px">Vouchers</span><div class="grow col" style="gap:6px"><b>${plural(v.items.length, "voucher")}</b>${strip}<span class="sub">${v.items.map((i) => esc(i.ref)).join(", ")}</span></div></div></div>${body}`;
  }

  function vehHTML(s) {
    const v = vehicle(s.vrn), repl = replacedSet();
    const vs = visits().filter((x) => x.vrn === v.vrn && status(x.dk, x.start, x.end) !== "past");
    const list = [...vs.map((x) => ({ k: x.dk + x.start, h: visitRow(x, repl) })), ...S.entries.filter((e) => e.vrn === v.vrn).map((e) => ({ k: e.dk + e.from, h: entryRow(e) }))].sort((a, b) => a.k.localeCompare(b.k));
    let fav;
    if (v.fav && v.favId) fav = s.confirmDel
      ? `<div class="danger"><b>Delete "${esc(v.nick)}" from your favourites on the council site?</b><span class="note">Bookings already made aren't affected.</span></div><div class="acts"><button type="button" class="btn flat" data-a="vdel">Keep</button><button type="button" class="btn dan pri" data-a="vdelyes"${s.busy ? " disabled" : ""}>${s.busy ? "Deleting…" : "Delete"}</button></div>`
      : `<button type="button" class="btn dan wide" data-a="vdel">Delete favourite</button>`;
    else fav = `<label class="field"><span class="label">Nickname</span><input type="text" class="inp" id="fvNick" value="${esc(v.pendingFav ? v.nick : s.nick || "")}" autocomplete="off"></label>${s.err ? `<span class="err">${esc(s.err)}</span>` : ""}<button type="button" class="btn wide" data-a="vsave"${s.busy ? " disabled" : ""}>${s.busy ? "Saving…" : "Save as favourite"}</button>`;
    return `${sheetHead(isFav(v) ? v.nick : "Vehicle", v.fav ? "Favourite" : v.pendingFav ? "Saves as a favourite with its next booking" : "Not a favourite")}
      <div>${plateHTML(v.vrn, "big")}</div>
      ${list.length ? `<div class="list">${list.map((x) => x.h).join("")}</div>` : `<p class="empty">Nothing booked or planned.</p>`}
      <button type="button" class="btn pri wide" data-a="quick" data-vrn="${esc(v.vrn)}">Book ${esc(vText(v))}</button>${fav}`;
  }
  function newFavHTML(s) {
    return `${sheetHead("Save a new favourite", "Saved to your council account")}
      <label class="field"><span class="label">Number plate</span><span class="row"><input type="text" class="inp plateinp grow" id="nfPlate" value="${esc(s.vrn || "")}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="10">${scanBtnHTML(s)}</span></label>
      ${scanHTML(s)}
      <label class="field"><span class="label">Nickname</span><input type="text" class="inp" id="nfNick" value="${esc(s.nick || "")}" autocomplete="off"></label>
      ${s.err ? `<span class="err">${esc(s.err)}</span>` : ""}
      <button type="button" class="btn pri wide" data-a="nfsave"${s.busy ? " disabled" : ""}>${s.busy ? "Saving…" : "Save favourite"}</button>`;
  }
  function bulkHTML(s) {
    const sel = [...(U.board.select || [])];
    const ents = sel.filter((k) => k.startsWith("e:")).map((k) => S.entries.find((e) => "e:" + e.id === k)).filter(Boolean);
    const vis = sel.filter((k) => k.startsWith("b:")).map((k) => findVisit(k.slice(2))).filter(Boolean);
    const cancellable = vis.filter((v) => v.items.every((i) => i.cancellable) && status(v.dk, v.start, v.end) === "up");
    const nV = cancellable.reduce((n, v) => n + v.items.length, 0);
    const rows = [...vis.map((v) => `<div class="li">${plateHTML(v.vrn, "sm")}<span class="sub grow">${fmtDay(fromKey(v.dk))} · ${range(v.start, v.end)}</span><span class="pill">Booked</span></div>`), ...ents.map((e) => `<div class="li">${plateHTML(e.vrn, "sm")}<span class="sub grow">${fmtDay(fromKey(e.dk))} · ${range(e.from, e.to)}</span><span class="pill plan">Planned</span></div>`)].join("");
    const what = [cancellable.length && `cancel ${plural(cancellable.length, "booking")} (${plural(nV, "voucher")} back)`, ents.length && `remove ${ents.length} planned`].filter(Boolean).join(" and ");
    return `${sheetHead(plural(sel.length, "item") + " selected")}<div class="list">${rows}</div>
      ${vis.length > cancellable.length ? `<p class="note">${vis.length - cancellable.length} of the bookings can't be cancelled: they've started, or the council site doesn't allow it.</p>` : ""}
      ${sel.length === 1 ? `<button type="button" class="btn wide" data-a="bulkone">Change time</button>` : ""}
      ${what ? (s.confirm ? `<div class="danger"><b>${esc(what[0].toUpperCase() + what.slice(1))}?</b>${cancellable.length ? `<span class="note">Cancelling goes to the council site straight away.</span>` : ""}</div><div class="acts"><button type="button" class="btn flat" data-a="bulkno">Keep</button><button type="button" class="btn dan pri" data-a="bulkyes"${s.busy ? " disabled" : ""}>${s.busy ? "Working…" : "Yes"}</button></div>`
        : `<button type="button" class="btn dan wide" data-a="bulkask">${esc(what[0].toUpperCase() + what.slice(1))}</button>`) : ""}`;
  }
  const termsSheetHTML = () => `${sheetHead("Terms and conditions", `© 2026 ${esc(T.OWNER)}. All rights reserved.`)}<div class="terms">${T.html}</div>`;

  // ---------- full-screen pages: terms gate, review and run ----------
  function renderPage() {
    const pg = $("#page");
    if (S.phase === "terms") { pg.hidden = false; pg.innerHTML = termsGateHTML(); return; }
    if (S.run) { pg.hidden = false; pg.innerHTML = runHTML(); return; }
    pg.hidden = true; pg.innerHTML = "";
  }
  const termsGateHTML = () => `<header class="top"><div class="toprow"><div class="brand"><span class="mark" aria-hidden="true">V</span>Voucherboard</div><span class="tag">Beta</span></div><p class="note" style="color:#e4ebf6">Before you start, read and accept the terms. Nothing is read from the council site until you do.</p></header>
    <main class="body"><div class="terms" tabindex="0">${T.html}</div>
      <label class="check"><input type="checkbox" id="tAgree"><span>I have read and accept these terms, and I understand that I use Voucherboard entirely at my own risk.</span></label></main>
    <div class="foot"><button type="button" class="btn pri wide" data-a="taccept" id="tAccept" disabled>Accept and continue</button><button type="button" class="btn flat wide" data-a="tdecline">Don't accept</button></div>`;

  function startRun(only) { const r = E.prepareRun(only); if (r.err) { toast(r.err); return; } U.sheets = []; renderSheet(); renderPage(); }
  function runHTML() {
    const R0 = S.run, { ops, nBook, nCancel } = R0.run, test = R0.test;
    const what = [nBook && `book ${plural(nBook, "voucher")}`, nCancel && `cancel ${nCancel}`].filter(Boolean).join(", ");
    const goText = test ? "Run test" : what[0].toUpperCase() + what.slice(1);
    const opRow = (o, i) => {
      const s = R0.stat[i];
      if (o.kind === "cancel") { const b0 = o.bookings[0], bl = o.bookings[o.bookings.length - 1]; return `<div class="op" id="op${i}"><span class="pill red">Cancel</span>${plateHTML(o.vrn, "sm")}<span class="sub num">${fmtDay(fromKey(o.dk))} · ${range(b0.start, bl.start + bl.mins)}</span><span class="st ${s.cls}">${esc(s.txt)}${s.err ? `<span class="errline">${esc(s.err)}</span>` : ""}</span></div>`; }
      const a = o.a;
      return `<div class="op" id="op${i}"><span class="pill">${esc(VT[a.type].short)}</span>${plateHTML(a.vrn, "sm")}<span class="sub num">${fmtDay(fromKey(a.dk))} · ${a.type === "day" ? "all day" : hm(a.start)}</span><span class="st ${s.cls}">${esc(s.txt)}${s.err ? `<span class="errline">${esc(s.err)}</span>` : ""}</span></div>`;
    };
    const pct = Math.round((Math.min(R0.sent, R0.total) / R0.total) * 100);
    let headTxt, foot;
    if (R0.phase === "review") {
      headTxt = `<h1 class="brand" style="font-size:22px">${test ? "Test your plan" : "Review plan"}</h1><div class="chiprow"><span class="bal">${esc(balanceText())}</span></div>`;
      foot = `<button type="button" class="btn pri wide" data-a="rungo">${esc(goText)}</button><button type="button" class="btn flat wide" data-a="runclose">Back</button>`;
    } else if (R0.phase === "running") {
      headTxt = `<h1 class="brand" style="font-size:22px">${test ? "Testing" : "Running plan"}</h1><div class="prog" style="background:var(--accent-mid)"><i id="runbar" style="width:${pct}%;background:#fff"></i></div><span class="upd" id="runlbl">${esc(R0.label || "Starting")}</span>`;
      foot = `<button type="button" class="btn wide" data-a="runstop"${R0.stop ? " disabled" : ""}>${R0.stop ? "Stopping…" : "Stop after this step"}</button>`;
    } else {
      const ok = !R0.failed && !R0.stop;
      headTxt = `<h1 class="brand" style="font-size:22px">${test ? (R0.failed ? "Test stopped" : "Test passed") : R0.failed ? "Stopped" : R0.paused ? "Paused" : R0.stop ? "Stopped" : "Done"}</h1>`;
      foot = `${R0.report ? `<button type="button" class="btn wide" data-a="report">Share error details</button>` : ""}${R0.stop && S.entries.length ? `<button type="button" class="btn pri wide" data-a="review">Resume</button>` : ""}<button type="button" class="btn ${ok || !S.entries.length ? "pri " : ""}wide" data-a="runclose">${R0.stop && S.entries.length ? "Later" : "Done"}</button>`;
    }
    const done = R0.phase === "done";
    const result = done ? `<div class="big-ok${R0.failed ? " bad" : ""}" aria-hidden="true">${R0.failed ? ICON.cross : ICON.check}</div><p style="margin:0;text-align:center;font-size:16px" role="status">${esc(R0.note)}</p>${R0.reminder ? `<div class="info"><b>${esc(R0.reminder)}</b><span class="note">Change this in More.</span></div>` : ""}` : "";
    const info = R0.phase === "review" ? `<h2 style="margin:0;font-size:18px">${esc(test ? "Check " + what : what[0].toUpperCase() + what.slice(1))}</h2>` : "";
    const notes = R0.phase === "review" ? `<div class="info"><span class="note">Each step goes to the council site one at a time, about half a second apart. Keep Voucherboard open until it finishes. If a step fails, the run stops and the rest stays in your plan.</span></div>
      <p class="note">${test ? "Test mode: every check runs with the council site, but nothing is booked or cancelled and no vouchers are used." : "Live mode: this books for real. Turn on test mode in More to check a plan without booking."}</p>` : "";
    return `<header class="top"><div class="toprow" style="min-height:0">${S.settings.testMode || test ? '<span class="tag test">Test mode</span>' : '<span class="tag">Live</span>'}</div>${headTxt}</header>
      <main class="body">${result}${info}<div class="card ops" id="ops">${ops.map(opRow).join("")}</div>${notes}</main><div class="foot">${foot}</div>`;
  }
  // ---------- actions ----------
  // Run progress: redraw one row, or the progress bar, without rebuilding the page.
  function runProgress(d) {
    const R0 = S.run; if (!R0) return;
    if (d.all || d.done) { renderPage(); if (d.done) render(); return; }
    const b = $("#runbar"), l = $("#runlbl");
    if (b) b.style.width = Math.round((Math.min(R0.sent, R0.total) / R0.total) * 100) + "%";
    if (l) l.textContent = R0.label;
    const st = $('[data-a="runstop"]'); if (st && R0.stop) { st.disabled = true; st.textContent = "Stopping…"; }
    if (d.i != null) { const el = $("#op" + d.i); if (el) { const tmp = doc.createElement("div"); tmp.innerHTML = runHTML(); const fresh = tmp.querySelector("#op" + d.i); if (fresh) el.replaceWith(fresh); const n = $("#op" + d.i); if (n && n.scrollIntoView && R0.stat[d.i].cls === "run") n.scrollIntoView({ block: "nearest" }); } }
  }

  const busy = (s, on) => { s.busy = on; renderSheet(); };
  const actions = {
    tab(t) { U.tab = t.dataset.tab; U.dayView = null; U.confirmSignOut = false; render(); },
    retry() { E.load(); },
    refresh() { E.load({ keepPermits: true }); },
    async signin() { result(await E.signIn()); },
    async council() { result(await E.openCouncil()); },
    terms() { openSheet({ type: "terms", title: "Terms", tall: true }); },
    async report() { result(await E.shareReport()); },
    signout() { U.confirmSignOut = !U.confirmSignOut; render(); },
    async signoutyes() { U.confirmSignOut = false; await E.signOut(); },
    taccept() { E.acceptTerms(); },
    tdecline() { $("#page").innerHTML = `<div class="state"><h2>Voucherboard needs the terms accepted</h2><p class="note">Nothing has been read from the council site. You can accept the terms whenever you're ready.</p><button type="button" class="btn pri" data-a="tagain">Read the terms again</button></div>`; },
    tagain() { renderPage(); },
    async set(t) { result(await E.setSetting(t.dataset.k, !S.settings[t.dataset.k])); },
    // board
    board() { U.board.force = true; U.board.zoom = U.dayView ? "day" : "week"; U.board.cursor = fromKey(U.dayView || U.calDay || TK()); N.call("orientation.set", { mode: "landscape" }).catch(() => {}); render(); },
    boardexit() { U.board.force = false; U.board.select = null; N.call("orientation.set", { mode: "auto" }).catch(() => {}); render(); },
    zoom(t) { U.board.zoom = t.dataset.z; renderBoard(); },
    bnav(t) { U.board.cursor = addDays(U.board.cursor, (+t.dataset.d) * (U.board.zoom === "day" ? 1 : 7)); renderBoard(); },
    selclear() { U.board.select = null; renderBoard(); },
    bulk() { openSheet({ type: "bulk", title: "Selected" }); },
    bulkask() { top().confirm = true; renderSheet(); },
    bulkno() { top().confirm = false; renderSheet(); },
    bulkone() { const k = [...U.board.select][0]; U.sheets = []; if (k.startsWith("e:")) openSheet({ type: "entry", id: +k.slice(2), title: "Planned booking" }); else openSheet({ type: "visit", k: k.slice(2), mode: "change", title: "Booking" }); },
    async bulkyes() {
      busy(top(), true);
      const r = await E.bulk([...U.board.select]);
      U.board.select = null; closeSheets(); render(); result(r);
    },
    // calendar
    calday(t) { U.calDay = t.dataset.dk; render(); },
    dayview(t) { U.dayView = t.dataset.dk || null; render(); },
    // sheets
    close() { closeSheet(); },
    undo() { const t = $("#toast"); t.hidden = true; if (t._undo) t._undo(); },
    plan() { openSheet({ type: "plan", title: "Your plan" }); },
    review() { E.closeRun(); startRun(null); },
    rungo() { E.runGo(); renderPage(); },
    runstop() { E.stopRun(); },
    runclose() { if (S.busy) return; E.closeRun(); renderPage(); render(); },
    rment(t) { result(E.removeEntry(+t.dataset.id)); renderSheet(); },
    clearplan() { const s = top(); if (!s.confirmClear) { s.confirmClear = true; renderSheet(); return; } closeSheets(); result(E.clearPlan()); },
    entry(t) { openSheet({ type: "entry", id: +t.dataset.id, title: "Planned booking" }); },
    esave() {
      const s = top(), r = E.setEntryTime(s.id, parseHM($("#enFrom").value), parseHM($("#enTo").value));
      if (r.err) { s.err = r.err; renderSheet(); return; }
      closeSheet(); result(r);
    },
    erm() { const s = top(); closeSheet(); result(E.removeEntry(s.id)); },
    visit(t) { if (handleSelectTap(t)) return; openSheet({ type: "visit", k: t.dataset.k, mode: t.dataset.mode || "", title: "Booking" }); },
    vmode(t) { const s = top(); s.mode = t.dataset.mode; s.err = ""; renderSheet(); },
    vopt(t) { top().opt = +t.dataset.i; renderSheet(); },
    vagain() { const v = findVisit(top().k); if (!v) return; const q = openQuick({ vrns: [v.vrn], days: [], from: v.start, to: v.end }); q.when = "days"; q.days = []; renderSheet(); toast("Pick the days, then add them to your plan."); },
    vchg() {
      const s = top(), r = E.planChange(s.k, parseHM($("#chFrom").value), parseHM($("#chTo").value));
      if (r.err) { s.err = r.err; renderSheet(); return; }
      closeSheets(); result(r);
    },
    async vcancel() { const s = top(); busy(s, true); const r = await E.cancelVisit(s.k); closeSheets(); render(); result(r); },
    async vend() { const s = top(); busy(s, true); const r = await E.endEarly(s.k, s.opt || 0); closeSheets(); render(); result(r); },
    extend(t) { openQuick({}, E.quickExtend(t.dataset.vrn, t.dataset.dk, +t.dataset.end)); },
    veh(t) { openSheet({ type: "veh", vrn: t.dataset.vrn, title: "Vehicle" }); },
    vdel() { const s = top(); s.confirmDel = !s.confirmDel; renderSheet(); },
    async vdelyes() { const s = top(); busy(s, true); const r = await E.deleteFavourite(s.vrn); closeSheets(); render(); result(r); },
    async vsave() {
      const s = top(); s.nick = ($("#fvNick").value || "").trim(); s.err = ""; busy(s, true);
      const r = await E.saveFavourite(s.vrn, s.nick);
      if (r.err) { s.busy = false; s.err = r.err; renderSheet(); return; }
      closeSheets(); render(); result(r);
    },
    newfav() { openSheet({ type: "newfav", title: "New favourite" }); },
    async nfsave() {
      const s = top(); keepTyped(s); s.err = ""; busy(s, true);
      const r = await E.saveFavourite(s.vrn, s.nick, true);
      if (r.err) { s.busy = false; s.err = r.err; renderSheet(); return; }
      closeSheets(); render(); result(r);
    },
    async buy(t) {
      t.disabled = true; t.textContent = "Checking…";
      const r = await E.buy(t.dataset.k, +t.dataset.n);
      if (r.err) { t.disabled = false; t.textContent = "Try again"; toast(r.err); return; }
      closeSheets();
    },
    scan() { const s = top(); keepTyped(s); s.scanMenu = !s.scanMenu; s.scanErr = ""; renderSheet(); },
    scango(t) { scan(t.dataset.src); },
    scanpick(t) {
      const s = top(), vrn = t.dataset.vrn; s.scan = null;
      if (s.type === "newfav") { keepTyped(s); s.vrn = vrn; renderSheet(); return; }
      const v = S.vehicles.find((x) => x.vrn === vrn);
      if (v) { if (!s.vrns.includes(vrn)) s.vrns.push(vrn); s.newv = null; } else s.newv = { vrn, save: false, nick: "", scanned: true };
      s.qq = ""; renderSheet();
    },
    // quick-book
    quick(t) { const vrn = t.dataset.vrn, dk = t.dataset.dk; openQuick({ vrns: vrn ? [vrn] : [], days: dk ? [dk] : undefined }); },
    qpick(t) { const q = top(); if (!q.vrns.includes(t.dataset.vrn)) q.vrns.push(t.dataset.vrn); q.qq = ""; q.newv = null; renderSheet(); },
    qrm(t) { const q = top(); q.vrns = q.vrns.filter((v) => v !== t.dataset.vrn); renderSheet(); },
    qnew(t) { const q = top(); q.newv = { vrn: t.dataset.vrn, save: false, nick: "" }; q.qq = ""; renderSheet(); },
    qnvsave() { const q = top(); q.newv.save = !q.newv.save; renderSheet(); },
    qnvno() { top().newv = null; renderSheet(); },
    async qnvadd() {
      const q = top(), n = q.newv;
      if (n.save) { n.checking = true; n.error = ""; renderSheet(); }
      const r = await E.addVehicle(n);
      n.checking = false;
      if (r.err) { n.error = r.err; renderSheet(); return; }
      if (!q.vrns.includes(r.vrn)) q.vrns.push(r.vrn);
      q.newv = null; renderSheet();
    },
    qwhen(t) { E.quickWhen(top(), t.dataset.w); renderSheet(); },
    qpre(t) { E.quickApplyPreset(top(), t.dataset.p); renderSheet(); },
    qday(t) { E.quickToggleDay(top(), t.dataset.dk); renderSheet(); },
    qdays(t) { E.quickPickDays(top(), t.dataset.q); renderSheet(); },
    qplan() { const r = E.addToPlan(top()); if (r.err) return; closeSheets(); result(r); },
    qbook() { openSheet({ type: "confirm", q: top(), email: S.settings.emailAll, title: "Check and book" }); },
    cemail() { const s = top(); s.email = !s.email; renderSheet(); },
    cgo() { const s = top(), r = E.bookNow(s.q, s.email); if (r.err) { toast(r.err); return; } U.sheets = []; renderSheet(); renderPage(); }
  };

  // Board: a tap on a block while selecting adds it to the selection instead of opening it.
  function handleSelectTap(t) {
    if (!U.board.select || !t.dataset.sk || !t.closest(".board")) return false;
    const k = t.dataset.sk, sel = U.board.select;
    if (sel.has(k)) sel.delete(k); else sel.add(k);
    renderBoard(); return true;
  }

  // ---------- events ----------
  function wire() {
    doc.addEventListener("click", (e) => {
      const t = e.target.closest("[data-a]"); if (!t || t.disabled) return;
      if (t._suppress) { t._suppress = false; return; }
      const a = actions[t.dataset.a];
      if (t.dataset.a === "entry" && handleSelectTap(t)) return;
      if (a) { e.preventDefault(); a(t); }
    });
    doc.addEventListener("input", (e) => {
      const t = e.target, k = t.dataset && t.dataset.in;
      if (t.id === "tAgree") { $("#tAccept").disabled = !t.checked; return; }
      if (k === "qq") { const q = top(); q.qq = t.value; $("#qsugg").innerHTML = quickSuggHTML(q); return; }
      if (k === "qnick") { top().newv.nick = t.value; return; }
      if (k === "qnvplate") { const n = top().newv; n.vrn = W.normVrn(t.value); n.error = ""; return; }
      if (k === "vq") { U.vq = t.value; $("#vlist").innerHTML = vehicleListHTML(); }
    });
    doc.addEventListener("change", (e) => {
      const t = e.target, k = t.dataset && t.dataset.in;
      if (k === "qfrom" || k === "qto") {
        E.quickTime(top(), k === "qfrom" ? "from" : "to", parseHM(t.value)); renderSheet(); return;
      }
      if (k === "permit") { E.setPermit(t.value); return; }
      if (k === "subzone") { E.setSubzone(t.value); return; }
      if (k === "lead") E.setSetting("lead", +t.value);
    });
    wireGestures();
    landMQ.addEventListener && landMQ.addEventListener("change", () => { if (!landMQ.matches) U.board.select = null; render(); });
    E.on((type, d) => {
      if (type === "change") { if (!S.run || S.run.phase !== "running") renderSoon(); }
      else if (type === "run") runProgress(d);
      else if (type === "tick") { const typing = doc.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(doc.activeElement.tagName); if (!U.sheets.length && !S.run && !typing) render(); }
      else if (type === "toast") toast(d.text);
      else if (type === "home") { U.tab = "today"; U.dayView = null; closeSheets(); render(); }
      else if (type === "quick") { U.tab = "today"; U.dayView = null; render(); openQuick({}, d.q); }
      else if (type === "scan") { if (S.run && !S.busy) E.closeRun(); renderPage(); const q = openQuick({}); q.scan = d.cands || null; q.scanErr = d.err || ""; renderSheet(); }
    });
    N.on("back", () => {
      if (S.run) { if (!S.busy) actions.runclose(); return true; }
      if (U.sheets.length) { closeSheet(); return true; }
      if (U.board.select) { actions.selclear(); return true; }
      if (U.board.force) { actions.boardexit(); return true; }
      if (U.dayView) { U.dayView = null; render(); return true; }
      if (U.tab !== "today") { U.tab = "today"; render(); return true; }
      return false;
    });
    N.on("orientation", () => render());
  }

  // Press and hold on a lane (portrait day view) or a track (board), then drag, to plan a booking.
  // Press and hold on a block in the board to start selecting. Pinch the board to zoom.
  function wireGestures() {
    let g = null, pinch = null;
    const HOLD = 420;
    const pt = (e) => (e.touches ? e.touches[0] : e);
    const start = (e) => {
      if (e.touches && e.touches.length === 2 && e.target.closest("#bgrid")) {
        const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }; if (g) cancel(); return;
      }
      if (e.button > 0 || (e.touches && e.touches.length > 1)) return;
      const blk = e.target.closest(".board .blk[data-sk]");
      const lane = !blk && e.target.closest(".lanecol, .board .track[data-track]");
      if (!blk && !lane) return;
      const p = pt(e);
      g = { x: p.clientX, y: p.clientY, blk, lane, armed: false };
      g.timer = setTimeout(() => {
        if (!g) return;
        g.armed = true; haptic("light");
        if (g.blk) { U.board.select = U.board.select || new Set(); U.board.select.add(g.blk.dataset.sk); g.blk._suppress = true; renderBoard(); g = null; return; }
        beginDraft(g);
      }, HOLD);
    };
    const move = (e) => {
      if (pinch && e.touches && e.touches.length === 2) { e.preventDefault(); const [a, b] = e.touches; pinch.r = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d; return; }
      if (!g) return;
      const p = pt(e);
      if (!g.armed) { if (Math.hypot(p.clientX - g.x, p.clientY - g.y) > 8) cancel(); return; }
      if (e.cancelable) e.preventDefault();
      g.end = g.at(p); g.update();
    };
    const end = () => {
      if (pinch) { const r = pinch.r || 1; pinch = null; const i = ZOOMS.indexOf(U.board.zoom); if (r > 1.25 && i < 2) { U.board.zoom = ZOOMS[i + 1]; renderBoard(); } else if (r < 0.8 && i > 0) { U.board.zoom = ZOOMS[i - 1]; renderBoard(); } return; }
      if (!g) return;
      clearTimeout(g.timer);
      if (g.armed && g.ghost) { const d = g; g = null; d.ghost.remove(); d.done(); return; }
      g = null;
    };
    const cancel = () => { if (!g) return; clearTimeout(g.timer); if (g.ghost) g.ghost.remove(); g = null; };
    function beginDraft(d) {
      const lane = d.lane, r = lane.getBoundingClientRect(), vrn = lane.dataset.vrn;
      const ghost = doc.createElement("div"); ghost.className = "blk ghost"; lane.appendChild(ghost); d.ghost = ghost;
      if (lane.classList.contains("lanecol")) { // vertical: portrait day view
        const dk = lane.dataset.dk, f0 = +lane.dataset.f, isToday = dk === TK();
        if (!P.inWindow(S.today, fromKey(dk))) { cancel(); toast("That day can't be booked yet."); return; }
        d.at = (p) => { const m = Math.round((f0 + ((p.clientY - r.top) / PX_H) * 60) / 15) * 15; return isToday ? Math.max(m, S.now) : m; };
        d.begin = d.at({ clientY: d.y }); d.end = d.begin + 60;
        d.update = () => { const a = Math.min(d.begin, d.end), b = Math.max(d.begin, d.end); ghost.style.cssText = `left:4px;right:4px;top:${((a - f0) / 60) * PX_H}px;height:${Math.max(4, ((b - a) / 60) * PX_H)}px`; ghost.textContent = range(a, b); };
        d.done = () => { result(E.addDraft(vrn, dk, Math.min(d.begin, d.end), Math.max(d.begin, d.end))); render(); };
      } else { // horizontal: board track
        const map = $(".board")._map, { days, win, n } = map, span = win.t - win.f;
        const pos = (p) => { const fr = Math.min(Math.max((p.clientX - r.left) / r.width, 0), 0.9999) * n, i = Math.floor(fr); return { i, m: Math.round((win.f + (fr - i) * span) / 15) * 15 }; };
        const s0 = pos({ clientX: d.x }), dk = key(days[s0.i]);
        if (!P.inWindow(S.today, days[s0.i])) { cancel(); toast("That day can't be booked."); return; }
        const clamp = (m) => (dk === TK() ? Math.max(m, S.now) : m);
        d.begin = clamp(s0.m); d.end = d.begin + 60;
        d.at = (p) => { const q = pos(p); return clamp(q.i === s0.i ? q.m : q.i > s0.i ? win.t : win.f); };
        d.update = () => { const a = Math.min(d.begin, d.end), b = Math.max(d.begin, d.end), X = (m) => ((s0.i + (m - win.f) / span) / n) * 100; ghost.style.cssText = `top:4px;height:32px;left:${X(a)}%;width:${Math.max(0.5, X(b) - X(a))}%`; ghost.textContent = n === 1 ? range(a, b) : ""; };
        d.done = () => { result(E.addDraft(vrn, dk, Math.min(d.begin, d.end), Math.max(d.begin, d.end))); render(); };
      }
      d.update();
    }
    doc.addEventListener("touchstart", start, { passive: true });
    doc.addEventListener("touchmove", move, { passive: false });
    doc.addEventListener("touchend", end);
    doc.addEventListener("touchcancel", cancel);
    doc.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") start(e); });
    doc.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") move(e); });
    doc.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") end(e); });
    doc.addEventListener("contextmenu", (e) => { if (e.target.closest(".lanecol, .board .track, .board .blk")) e.preventDefault(); });
  }

  // ---------- start ----------
  // Engine changes arrive in bursts; draw once per turn.
  let pending = false;
  function renderSoon() { if (pending) return; pending = true; Promise.resolve().then(() => { pending = false; render(); }); }
  async function start() {
    wire();
    render();
    await E.start();
    if (!U.calDay) U.calDay = (nextControlled() || { dk: TK() }).dk;
    render();
  }
  root.VB.mobile = { start, S, U, actions, render };
  if (root.VB_MANUAL_START) return; // tests start it themselves
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof globalThis !== "undefined" ? globalThis : this);
