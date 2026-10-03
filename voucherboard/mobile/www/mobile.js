// Voucherboard mobile UI. Runs in the app's own WebView; every council request goes through the council view
// (VBNative, mobile/BRIDGE.md). Same planner, portal and model code as the extension. State lives in S; render()
// redraws the current screen; one delegated click, input and change handler each, keyed by data-a and data-in.
(function (root) {
  "use strict";
  const P = root.VB.planner, W = root.VB.portal, T = root.VB.terms, M = root.VB.model, R = root.VB.reminders, N = root.VBNative;
  const { VT, KINDS, key, fromKey, addDays, hm } = P;
  const { DOW, fmtDay, hShort, todayDate, nowMin, vText, plural } = M;
  const ISSUES_URL = "https://github.com/maubergine/voucherboard/issues";
  const LOGGED_OUT = /logged out/i;
  const doc = root.document;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (s) => doc.querySelector(s);
  const spaced = (v) => (v.length > 4 ? v.slice(0, 4) + " " + v.slice(4) : v);
  const plateHTML = (v, cls) => `<span class="plate${cls ? " " + cls : ""}">${esc(spaced(v))}</span>`;
  const gbp = (n) => (n == null ? "" : "£" + n.toFixed(2));
  const typesText = (u) => KINDS.filter((k) => u[k]).map((k) => `${u[k]} × ${VT[k].label}`).join(" + ");
  const range = (f, t) => `${hm(f)} – ${hm(t)}`;
  const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const weekStart = (d) => addDays(d, -(P.isoDow(d) - 1));
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
    cross: svg('<path d="M6 6l12 12M18 6L6 18"/>', 3)
  };

  // ---------- state ----------
  const S = {
    phase: "boot", error: "", signedOut: false, loadedAt: 0, loading: false,
    permits: [], permitId: null, details: null, zone: null, subzones: [], prices: null,
    vehicles: [], bookings: [], balance: { h1: 0, h5: 0, day: 0 }, entries: [],
    settings: { testMode: false, betaLive: false, emailAll: false, reminders: true, lead: 15 },
    today: todayDate(), now: nowMin(),
    tab: "today", calDay: null, dayView: null, vq: "", confirmSignOut: false,
    board: { zoom: "week", cursor: todayDate(), force: false, select: null },
    sheets: [], run: null, version: "", platform: "", lastReport: null
  };
  let seq = 1;
  const store = N.store;
  const ctx = () => ({ zone: S.zone, today: S.today, now: S.now, bookings: S.bookings, prices: S.prices });
  const TK = () => key(S.today);
  const vehicle = (vrn) => S.vehicles.find((v) => v.vrn === vrn) || { vrn, nick: vrn, fav: false };
  const isFav = (v) => v.fav || v.pendingFav;
  const vName = (v) => esc(vText(v));
  const controls = (d) => P.controls(S.zone, d);
  const shortZone = () => !!S.zone && S.zone.rules.every((r) => r.t - r.f <= 180);
  const planKey = () => "vb:plan:" + S.permitId;
  const savePlan = () => store.set(planKey(), S.entries.map(({ id, vrn, dk, from, to, replaces, email }) => ({ id, vrn, dk, from, to, ...(replaces ? { replaces } : {}), ...(email ? { email } : {}) })));
  const saveSettings = () => store.set("vb:settings", S.settings);
  const haptic = (kind) => N.call("haptic", { kind }).catch(() => {});
  const status = (dk, f, t) => { const k = TK(); if (dk < k) return "past"; if (dk > k) return "up"; if (t <= S.now) return "past"; if (f <= S.now) return "live"; return "up"; };
  const byVehicle = (a, b) => (isFav(b) - isFav(a)) || (isFav(a) ? a.nick.localeCompare(b.nick, "en-GB", { sensitivity: "base" }) : 0) || a.vrn.localeCompare(b.vrn);

  // Bookings back to back for one vehicle on one day are one visit, with its vouchers in time order.
  function visits() {
    const byId = new Map(S.bookings.map((b) => [b.id, b]));
    return R.visits(S.bookings).map((v) => ({ ...v, items: v.ids.map((id) => byId.get(id)).sort((a, b) => a.start - b.start) }));
  }
  // Planned changes only count while the booking they replace is still upcoming.
  function cleanEntries() {
    for (const e of S.entries) if (e.replaces) {
      e.replaces = e.replaces.filter((id) => { const b = S.bookings.find((x) => x.id === id); return b && status(b.date, b.start, b.start + b.mins) === "up"; });
      if (!e.replaces.length) delete e.replaces;
    }
  }
  function plan() { cleanEntries(); return P.allocate(ctx(), S.entries, S.balance, "cheapest"); }
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

  // ---------- toast ----------
  let toastT;
  function toast(msg, undo) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" data-a="undo">Undo</button>` : ""}`;
    t.hidden = false; t._undo = undo || null;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, undo ? 5000 : 3200);
  }

  // ---------- loading ----------
  const termsOk = async () => { const a = await store.get("vb:terms", null); return !!a && a.version === T.VERSION; };
  async function load(opts = {}) {
    if (!(await termsOk())) { S.phase = "terms"; render(); return; }
    if (!S.loadedAt) S.phase = "loading";
    S.loading = true; render();
    try {
      if (!opts.keepPermits || !S.permits.length) S.permits = await W.loadPermits();
      const usable = S.permits.filter(W.isUsableVisitorPermit);
      if (!usable.length) { S.phase = "nopermit"; S.loading = false; render(); return; }
      const saved = await store.get("vb:permit", null);
      if (!S.permitId || !usable.some((p) => p.id === S.permitId)) S.permitId = usable.some((p) => p.id === saved) ? saved : usable[0].id;
      await loadPermitData();
      const stored = await store.get(planKey(), []);
      S.entries = P.advanceEntries(ctx(), stored.map((e) => ({ ...e, id: seq++ })));
      Object.assign(S, { phase: "ready", signedOut: false, loadedAt: Date.now(), error: "", loading: false });
      if (!S.calDay) S.calDay = (nextControlled() || { dk: TK() }).dk;
      render(); scheduleReminders();
    } catch (e) {
      S.loading = false;
      if (LOGGED_OUT.test(e.message || "")) { S.signedOut = true; if (!S.loadedAt) S.phase = "signin"; }
      else if (S.loadedAt) toast(e.message);
      else { S.phase = "error"; S.error = e.message || String(e); }
      render();
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

  // ---------- shell ----------
  const landMQ = root.matchMedia ? root.matchMedia("(orientation: landscape) and (max-height: 600px)") : { matches: false, addEventListener() {} };
  const isBoard = () => S.phase === "ready" && (landMQ.matches || S.board.force);
  function render() {
    const app = $("#app");
    app.classList.toggle("land", isBoard());
    const body = $(".portrait .body"), keep = body && body.dataset.tab === S.tab + (S.dayView || "") ? body.scrollTop : 0;
    $(".portrait").innerHTML = portraitHTML();
    const nb = $(".portrait .body"); if (nb && keep) nb.scrollTop = keep;
    if (isBoard() || (root.matchMedia && root.matchMedia("(orientation: landscape) and (min-width: 1000px)").matches && S.phase === "ready")) renderBoard();
    renderSheet();
    renderPage();
  }
  function portraitHTML() {
    if (S.phase === "boot" || S.phase === "loading") return stateHTML("Loading your permits", "Reading your vouchers, bookings and vehicles from the council site.", true);
    if (S.phase === "error") return stateHTML("Couldn't load your permits", S.error, false, `<button type="button" class="btn pri" data-a="retry">Try again</button>`);
    if (S.phase === "signin") return stateHTML("Sign in to the council site", "Voucherboard uses your own council account. You sign in on Lewisham's own page; Voucherboard never sees your password.", false, `<button type="button" class="btn pri" data-a="signin">Sign in</button>`);
    if (S.phase === "nopermit") return stateHTML("No active visitor permit", "Voucherboard works with active visitor permits. Buy visitor vouchers on the council site first.", false, `<button type="button" class="btn" data-a="council">Open the council site</button>`);
    if (S.phase !== "ready") return "";
    const body = { today: todayHTML, cal: calHTML, veh: vehiclesHTML, more: moreHTML }[S.tab]();
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
    const t = (id, label, ic) => `<button type="button" class="tab" data-a="tab" data-tab="${id}"${S.tab === id ? ' aria-current="page"' : ""}>${ic}${label}</button>`;
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
  const vkey = (v) => `${v.vrn}|${v.dk}|${v.start}`;
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
    if (S.dayView) return dayViewHTML();
    const start = weekStart(S.today), end = addDays(S.today, P.WINDOW_DAYS), n = Math.ceil(((end - start) / 864e5 + 1) / 7) * 7;
    const booked = new Set(S.bookings.map((b) => b.date)), planned = new Set(S.entries.map((e) => e.dk));
    let grid = DOW.map((x) => `<span class="w">${x[0]}</span>`).join("");
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i), dk = key(d), c = controls(d), off = c && !c.length;
      grid += `<button type="button" class="${off ? "off" : ""}${dk === TK() ? " today" : ""}" data-a="calday" data-dk="${dk}" aria-pressed="${S.calDay === dk}" aria-label="${fmtDay(d)}${booked.has(dk) ? ", booked" : ""}${planned.has(dk) ? ", planned" : ""}"${P.inWindow(S.today, d) || booked.has(dk) ? "" : " disabled"}>${d.getDate()}<span class="mk">${booked.has(dk) ? "<i></i>" : ""}${planned.has(dk) ? '<i class="p"></i>' : ""}</span></button>`;
    }
    const dk = S.calDay || TK(), d = fromKey(dk), repl = replacedSet();
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
  function dayWindow(dk) {
    const c = controls(fromKey(dk)) || [];
    let f = c.length ? Math.min(...c.map((x) => x.f)) - 60 : 7 * 60, t = c.length ? Math.max(...c.map((x) => x.t)) + 60 : 19 * 60;
    for (const b of S.bookings) if (b.date === dk) { f = Math.min(f, b.start); t = Math.max(t, b.start + b.mins); }
    for (const e of S.entries) if (e.dk === dk) { f = Math.min(f, e.from); t = Math.max(t, e.to); }
    return { f: Math.max(0, Math.floor(f / 60) * 60), t: Math.min(24 * 60, Math.ceil(t / 60) * 60) };
  }
  function laneVehicles(dks) {
    const used = new Set([...S.bookings.filter((b) => dks.includes(b.date)).map((b) => b.vrn), ...S.entries.filter((e) => dks.includes(e.dk)).map((e) => e.vrn)]);
    const list = S.vehicles.filter((v) => used.has(v.vrn) || v.fav);
    return list.sort((a, b) => (used.has(b.vrn) - used.has(a.vrn)) || byVehicle(a, b));
  }
  function dayViewHTML() {
    const dk = S.dayView, d = fromKey(dk), win = dayWindow(dk), H = ((win.t - win.f) / 60) * PX_H, y = (m) => ((m - win.f) / 60) * PX_H;
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
      <input type="search" class="inp" data-in="vq" placeholder="Search name or plate" value="${esc(S.vq)}" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Search vehicles">
      <div id="vlist">${vehicleListHTML()}</div>
      <button type="button" class="btn wide" data-a="newfav">${ICON.plus}Save a new favourite</button>
      <p class="note">Favourites are saved to your council account. Tap one for its bookings and to delete it.</p></main>`;
  }
  function vehicleListHTML() {
    const q = S.vq.trim().toLowerCase(), nq = W.normVrn(q);
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
        ${S.confirmSignOut ? `<div class="li danger" style="border-radius:0"><div class="grow col"><b>Sign out of the council site?</b><span class="sub">Your plan stays on this phone.</span></div><button type="button" class="btn sm dan pri" data-a="signoutyes">Sign out</button><button type="button" class="btn sm flat" data-a="signout">Keep</button></div>`
          : `<button type="button" class="li" data-a="signout"><b class="grow" style="color:var(--bad)">Sign out of council site</b></button>`}
      </div>
      <p class="note">Voucherboard Beta${S.version ? " v" + esc(S.version) : ""}. © 2026 ${esc(T.OWNER)}. An independent tool, not made or endorsed by Lewisham Council. You use it entirely at your own risk.</p></main>`;
  }

  // ---------- landscape board ----------
  const ZOOMS = ["cal", "week", "day"];
  function boardDays() {
    const z = S.board.zoom, c = S.board.cursor;
    if (z === "day") return [c];
    if (z === "week") { const ws = weekStart(c); return [...Array(7)].map((_, i) => addDays(ws, i)); }
    const ws = weekStart(S.today); return [...Array(28)].map((_, i) => addDays(ws, i));
  }
  function boardWindow(days) {
    if (S.board.zoom === "day") return dayWindow(key(days[0]));
    if (!S.zone) return { f: 7 * 60, t: 19 * 60 };
    let f = 1440, t = 0; for (const r of S.zone.rules) { f = Math.min(f, r.f); t = Math.max(t, r.t); }
    return { f: Math.max(0, f - 60), t: Math.min(1440, t + 60) };
  }
  function renderBoard() {
    const el = $(".board"); if (!el) return;
    const days = boardDays(), keys = days.map(key), win = boardWindow(days), n = days.length, span = win.t - win.f;
    const x = (i, m) => ((i + (Math.min(Math.max(m, win.f), win.t) - win.f) / span) / n) * 100;
    const repl = replacedSet(), vs = visits().filter((v) => keys.includes(v.dk)), sel = S.board.select;
    const label = S.board.zoom === "day" ? fmtDay(days[0]) : `${days[0].getDate()} ${M.MON[days[0].getMonth()]} – ${days[n - 1].getDate()} ${M.MON[days[n - 1].getMonth()]}`;
    const zb = (z, l) => `<button type="button" data-a="zoom" data-z="${z}" aria-pressed="${S.board.zoom === z}">${l}</button>`;
    const p = S.entries.length ? plan() : null;
    let h = `<header class="lshead"><button type="button" class="iconbtn exit" data-a="boardexit" aria-label="Back to portrait">${ICON.phone}</button>
      <div class="seg" role="group" aria-label="Zoom">${zb("cal", "28 days")}${zb("week", "Week")}${zb("day", "Day")}</div>
      ${S.board.zoom === "cal" ? "" : `<button type="button" class="iconbtn" data-a="bnav" data-d="-1" aria-label="Previous">${ICON.left}</button>`}<b class="num">${label}</b>${S.board.zoom === "cal" ? "" : `<button type="button" class="iconbtn" data-a="bnav" data-d="1" aria-label="Next">${ICON.right}</button>`}
      ${p ? `<button type="button" class="lspill" data-a="plan">${esc(p.count ? plural(p.count, "voucher") + " planned" : plural(S.entries.length, "change") + " planned")} · Review</button>` : ""}</header>`;
    // day labels and, in day zoom, hours
    let head = "";
    if (S.board.zoom === "day") { for (let m = Math.ceil(win.f / 60) * 60; m < win.t; m += 60) head += `<span style="position:absolute;left:${x(0, m)}%;font-size:11px;font-weight:700;color:var(--muted)" class="num">${hShort(m)}</span>`; }
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
  const top = () => S.sheets[S.sheets.length - 1];
  function openSheet(s) { S.sheets.push(s); renderSheet(); }
  function closeSheet() { S.sheets.pop(); renderSheet(); }
  function closeSheets() { S.sheets = []; renderSheet(); }
  function renderSheet() {
    const L = $("#layer"), s = top();
    if (!s) { L.hidden = true; L.innerHTML = ""; return; }
    const html = { quick: quickHTML, confirm: confirmHTML, plan: planHTML, entry: entryHTML, visit: visitHTML, veh: vehHTML, newfav: newFavHTML, bulk: bulkHTML, terms: termsSheetHTML }[s.type](s);
    L.hidden = false;
    L.innerHTML = `<button type="button" class="scrim" data-a="close" aria-label="Close"></button><section class="sheet${s.tall ? " tall" : ""}" role="dialog" aria-modal="true" aria-label="${esc(s.title || "")}"><div class="grab"></div>${html}</section>`;
  }
  const sheetHead = (title, sub) => `<div class="row between"><div class="col"><h2>${esc(title)}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}</div><button type="button" class="btn sm flat" data-a="close">Close</button></div>`;

  // Quick-book: vehicle, when, how long. Add to plan, or book now after a check-and-book step.
  function openQuick(o = {}) {
    const n = nextControlled(), now = ctlAt(TK(), S.now);
    const q = { type: "quick", title: "Book a visitor", tall: false, vrns: o.vrns || [], qq: "", newv: null, when: "now", days: [TK()], from: S.now, to: S.now + 60, preset: "1h" };
    if (o.days) { q.when = o.days.length === 1 && o.days[0] === TK() ? "today" : "days"; q.days = o.days; const c = ctlAt(o.days[0], o.days[0] === TK() ? S.now : 0); q.from = o.from != null ? o.from : c ? Math.max(c.f, o.days[0] === TK() ? S.now : 0) : S.now; q.to = o.to != null ? o.to : q.from + 60; q.preset = o.from != null ? "" : "1h"; }
    else if (!(now && now.f <= S.now) && n) { q.when = n.dk === TK() ? "today" : "days"; q.days = [n.dk]; q.from = n.f; q.to = n.f + 60; }
    if (o.preset === "keep") q.preset = "";
    S.sheets = [q]; renderSheet();
  }
  function quickSel(q) {
    const from = q.when === "now" ? S.now : q.from, to = q.when === "now" ? Math.max(q.to, S.now + 15) : q.to;
    return { vrns: q.vrns, days: q.when === "days" ? q.days : [TK()], from, to };
  }
  function quickPreview(q) {
    const cands = P.candidates(ctx(), quickSel(q), S.entries);
    if (!cands.length) return { cands, items: [], text: q.vrns.length ? "Choose a day and a time." : "Choose a vehicle.", ok: false };
    cleanEntries();
    const p = P.allocate(ctx(), S.entries.concat(cands), S.balance, "cheapest"), items = p.items.filter((i) => i.pending);
    const need = { h1: 0, h5: 0, day: 0 }; let bad = false;
    for (const it of items) { if (it.need) for (const k of KINDS) need[k] += it.need[k]; if (it.notes.some((n) => n.c === "bad")) bad = true; }
    const n = need.h1 + need.h5 + need.day, val = P.valueOf(need, S.prices);
    const left = KINDS.filter((k) => need[k] || S.balance[k]).map((k) => `${S.balance[k] - need[k]} × ${VT[k].label}`).join(" · ");
    const notes = [...new Set(items.flatMap((i) => i.notes.filter((x) => x.c !== "bad").map((x) => x.t)))].slice(0, 2);
    const text = bad ? "Not enough vouchers for all of these. Add them to your plan to see what to buy." : n ? `Uses ${typesText(need)}${val != null ? ` (${gbp(val)})` : ""}. ${left} left after.` : items.some((i) => i.notes.some((x) => /already (booked|covered)/.test(x.t))) ? "Already covered at these times. No voucher needed." : "No voucher needed at these times.";
    return { cands, items, text, notes, ok: !bad && n > 0, bad };
  }
  function quickHTML(q) {
    const pv = quickPreview(q), dayMode = q.when === "days";
    const chips = q.vrns.map((vrn) => { const v = vehicle(vrn); return `<button type="button" class="chip x" aria-pressed="true" data-a="qrm" data-vrn="${esc(vrn)}" aria-label="Remove ${esc(vText(v))}">${esc(isFav(v) ? v.nick : spaced(v.vrn))}<span>×</span></button>`; }).join("");
    const seg = (w, l) => `<button type="button" data-a="qwhen" data-w="${w}" aria-pressed="${q.when === w}">${l}</button>`;
    const pre = (id, l) => `<button type="button" class="chip" data-a="qpre" data-p="${id}" aria-pressed="${q.preset === id}">${l}</button>`;
    const sel = quickSel(q), dk0 = sel.days[0], carry = dk0 ? ctlAt(dk0, sel.from) : null;
    const presets = [pre("1h", "1 hour"), pre("2h", "2 hours"), shortZone() ? "" : pre("5h", "5 hours"), !dayMode && carry ? pre("end", "Until controls end") : "", dayMode && S.zone ? pre("whole", "Whole controlled period") : ""].join("");
    return `${sheetHead("Book a visitor")}
      <div class="field"><span class="label">Vehicle</span>${chips ? `<div class="chiprow">${chips}</div>` : ""}
        <input type="text" class="inp plateinp" data-in="qq" value="${esc(q.qq)}" placeholder="${q.vrns.length ? "Add another vehicle" : "Name or plate, or a new plate"}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="20" aria-label="Vehicle">
        <div id="qsugg">${quickSuggHTML(q)}</div>${q.newv ? newVehicleHTML(q.newv) : ""}</div>
      <div class="field"><span class="label">When</span><div class="seg" role="group" aria-label="When">${seg("now", "Now")}${seg("today", "Today")}${seg("days", "Pick days")}</div>
        ${dayMode ? quickDaysHTML(q) : ""}</div>
      <div class="field"><span class="label">How long</span><div class="chiprow">${presets}</div>
        <div class="times"><label>From<input type="time" class="inp num" data-in="qfrom" value="${hm(sel.from)}" step="300"${q.when === "now" ? " disabled" : ""}></label><label>Until<input type="time" class="inp num" data-in="qto" value="${hm(sel.to)}" step="300"></label></div>
        ${q.when === "now" ? `<span class="note">Starts now. Hours outside controls are skipped; no voucher is needed then.</span>` : `<span class="note">Hours outside controls are skipped; no voucher is needed then.</span>`}</div>
      <div class="cost${pv.bad ? " bad" : ""}" id="qcost">${esc(pv.text)}</div>${(pv.notes || []).map((t) => `<p class="note warn">${esc(t)}</p>`).join("")}
      <div class="acts"><button type="button" class="btn" data-a="qplan"${pv.cands.length ? "" : " disabled"}>Add to plan</button><button type="button" class="btn pri" data-a="qbook"${pv.ok ? "" : " disabled"}>Book now</button></div>`;
  }
  function quickSuggHTML(q) {
    const t = q.qq.trim(), nq = W.normVrn(t);
    if (!t) return q.vrns.length ? "" : `<div class="chiprow scroll">${S.vehicles.filter((v) => v.fav).sort(byVehicle).slice(0, 12).map((v) => `<button type="button" class="chip" data-a="qpick" data-vrn="${esc(v.vrn)}">${esc(v.nick)}</button>`).join("")}</div>`;
    const ms = S.vehicles.filter((v) => !q.vrns.includes(v.vrn) && (v.nick.toLowerCase().includes(t.toLowerCase()) || (nq && v.vrn.includes(nq)))).sort(byVehicle).slice(0, 5);
    const isNew = nq.length >= 2 && nq.length <= 8 && !S.vehicles.some((v) => v.vrn === nq);
    return `<div class="list">${ms.map((v) => `<button type="button" class="li" data-a="qpick" data-vrn="${esc(v.vrn)}"><span class="name grow">${vName(v)}</span>${plateHTML(v.vrn, "sm")}</button>`).join("")}${isNew ? `<button type="button" class="li" data-a="qnew" data-vrn="${esc(nq)}"><span class="grow"><b>New vehicle</b></span>${plateHTML(nq, "sm")}</button>` : ""}${!ms.length && !isNew ? `<div class="li sub">No vehicle matches.</div>` : ""}</div>`;
  }
  function newVehicleHTML(n) {
    return `<div class="card" role="group" aria-label="New vehicle"><div class="row between"><b>New vehicle</b>${plateHTML(n.vrn)}</div>
      <div class="li" style="padding:0;border:0;min-height:44px"><div class="grow col"><b>Save as favourite</b><span class="sub">Saved to your council account with the first booking</span></div><button type="button" class="sw" role="switch" aria-checked="${n.save}" aria-label="Save as favourite" data-a="qnvsave"></button></div>
      ${n.save ? `<label class="field"><span class="label">Nickname</span><input type="text" class="inp" data-in="qnick" value="${esc(n.nick)}" autocomplete="off"></label>` : ""}
      ${n.error ? `<span class="err">${esc(n.error)}</span>` : ""}
      <div class="acts"><button type="button" class="btn pri sm" data-a="qnvadd"${n.checking ? " disabled" : ""}>${n.checking ? "Checking…" : "Add vehicle"}</button><button type="button" class="btn sm flat" data-a="qnvno">Cancel</button></div></div>`;
  }
  function quickDaysHTML(q) {
    const ws = weekStart(S.today), inW = (d) => P.inWindow(S.today, d);
    const ctlDays = (a, b) => { const out = []; for (let d = new Date(a); key(d) <= key(b); d = addDays(d, 1)) { const c = controls(d); if (inW(d) && (!c || c.length)) out.push(key(d)); } return out; };
    const first = q.days.length ? fromKey([...q.days].sort()[0]) : null;
    const qd = [["tom", "Tomorrow"], ["rest", "Rest of this week"], ["next", "Next week"]];
    if (first) qd.push(["every", `Every ${DOW[P.isoDow(first) - 1]} for 4 weeks`]);
    q._qd = { tom: () => [key(addDays(S.today, 1))], rest: () => ctlDays(S.today, addDays(ws, 6)), next: () => ctlDays(addDays(ws, 7), addDays(ws, 13)), every: () => [0, 7, 14, 21].map((o) => addDays(first, o)).filter(inW).map(key) };
    const end = addDays(S.today, P.WINDOW_DAYS), n = Math.ceil(((end - ws) / 864e5 + 1) / 7) * 7;
    let cal = DOW.map((x) => `<span class="w">${x[0]}</span>`).join("");
    for (let i = 0; i < n; i++) {
      const d = addDays(ws, i), dk = key(d), c = controls(d);
      cal += `<button type="button" class="${c && !c.length ? "off" : ""}${dk === TK() ? " today" : ""}" data-a="qday" data-dk="${dk}" aria-pressed="${q.days.includes(dk)}" aria-label="${fmtDay(d)}"${inW(d) ? "" : " disabled"} style="height:38px">${d.getDate()}</button>`;
    }
    return `<div class="chiprow scroll">${qd.map(([id, l]) => `<button type="button" class="chip" data-a="qdays" data-q="${id}">${esc(l)}</button>`).join("")}</div><div class="cal">${cal}</div><span class="sub">${q.days.length ? plural(q.days.length, "day") + " chosen" : "No days chosen"}</span>`;
  }
  function quickApplyPreset(q, p) {
    const sel = quickSel(q), f = sel.from;
    q.preset = p;
    if (p === "1h" || p === "2h" || p === "5h") { q.to = f + { "1h": 60, "2h": 120, "5h": 300 }[p]; if (q.when !== "now") q.from = f; }
    else if (p === "end") { const c = ctlAt(sel.days[0], f); if (c) { q.from = Math.max(f, c.f); q.to = c.t; } }
    else if (p === "whole" && S.zone) { let a = 1440, b = 0; for (const r of S.zone.rules) { a = Math.min(a, r.f); b = Math.max(b, r.t); } q.from = a; q.to = b; }
    q.to = Math.min(P.LAST_MIN, q.to);
  }
  function quickToEntries(q) {
    const pv = quickPreview(q), ids = [];
    for (const c of pv.cands) { const e = { id: seq++, vrn: c.vrn, dk: c.dk, from: c.from, to: c.to, ...(S.settings.emailAll ? { email: true } : {}) }; S.entries.push(e); ids.push(e.id); }
    return ids;
  }

  function confirmHTML(s) {
    const q = s.q, pv = quickPreview(q), one = q.vrns.length === 1 ? vehicle(q.vrns[0]) : null;
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
    const p = plan(), items = p.items, adv = P.purchaseAdvice(ctx(), S.entries, P.allocate(ctx(), S.entries, S.balance, "cheapest"), S.balance);
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

  function findVisit(k) { return visits().find((v) => vkey(v) === k); }
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
      <label class="field"><span class="label">Number plate</span><input type="text" class="inp plateinp" id="nfPlate" value="${esc(s.vrn || "")}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="10"></label>
      <label class="field"><span class="label">Nickname</span><input type="text" class="inp" id="nfNick" value="${esc(s.nick || "")}" autocomplete="off"></label>
      ${s.err ? `<span class="err">${esc(s.err)}</span>` : ""}
      <button type="button" class="btn pri wide" data-a="nfsave"${s.busy ? " disabled" : ""}>${s.busy ? "Saving…" : "Save favourite"}</button>`;
  }
  function bulkHTML(s) {
    const sel = [...(S.board.select || [])];
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

  function startRun(only, autostart) {
    cleanEntries();
    let p = P.allocate(ctx(), S.entries, S.balance, "cheapest");
    if (only) p = { ...p, items: p.items.filter((it) => only.has(it.entry.id)) };
    const run = M.buildOps(p, S.bookings);
    if (!run.ops.length) { toast("Nothing to send."); return; }
    const test = S.settings.testMode;
    S.run = { run, test, only, phase: "review", sent: 0, total: M.requestCount(run, test), label: "", stop: false, paused: false,
      stat: run.ops.map((o) => ({ cls: "wait", txt: o.kind === "book" && o.a.moved ? "Moved to now" : "Waiting" })) };
    closeSheets(); renderPage();
    if (autostart) runGo();
  }
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
  async function runGo() {
    const R0 = S.run, { ops, repl } = R0.run, test = R0.test;
    R0.phase = "running"; renderPage();
    N.call("run.begin").catch(() => {});
    S.busy = true;
    const emailFor = (a) => { const en = S.entries.find((x) => x.id === a.eid); return !!(en && en.email); };
    const upd = () => { const b = $("#runbar"), l = $("#runlbl"); if (b) b.style.width = Math.round((Math.min(R0.sent, R0.total) / R0.total) * 100) + "%"; if (l) l.textContent = R0.label; };
    const setRow = (i) => { const el = $("#op" + i); if (el) { const tmp = doc.createElement("div"); tmp.innerHTML = runHTML(); const fresh = tmp.querySelector("#op" + i); if (fresh) el.replaceWith(fresh); const n = $("#op" + i); if (n && n.scrollIntoView && R0.stat[i].cls === "run") n.scrollIntoView({ block: "nearest" }); } };
    const r = await M.runOps({ ops, repl, permitId: S.permitId, test, vehicle, emailFor, on: {
      stat: (i, cls, txt) => { R0.stat[i] = { cls, txt }; setRow(i); },
      bump: (label) => { R0.sent++; R0.label = label; upd(); },
      moved: () => { ops.forEach((o, j) => { if (o.kind === "book" && o.a.moved && R0.stat[j].cls === "wait") R0.stat[j].txt = "Moved to now"; }); renderPage(); },
      stopping: () => R0.stop
    } });
    let failed = r.failed;
    if (failed && failed.index != null) R0.stat[failed.index] = { cls: "fail", txt: "Failed", err: failed.message };
    for (const s of R0.stat) if (/^(wait|run)$/.test(s.cls)) { s.cls = "wait"; s.txt = "Not sent"; }
    R0.sent++; R0.label = "Finishing"; upd();
    let missing = 0;
    if (!test && (r.done || r.cancelled)) {
      try {
        await loadPermitData();
        missing = M.missingAfterRun(r.booked, S.bookings);
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
    Object.assign(R0, { phase: "done", failed, note });
    if (failed) S.lastReport = R0.report = M.errorReport({ failed, test, ops, picked: r.picked, done: r.done, stop: R0.stop, startedAt: r.startedAt, available: r.fresh },
      { version: S.version, page: `Voucherboard app (${N.platform})`, browser: root.navigator.userAgent, permitId: S.permitId });
    if (!test && r.done && S.settings.reminders) {
      const vrns = new Set(r.booked.map((a) => a.vrn));
      const n = R.schedule({ today: S.today, now: S.now, zone: S.zone, bookings: S.bookings, vehicles: S.vehicles, lead: S.settings.lead }).find((x) => vrns.has(x.data.vrn));
      if (n) { const d = new Date(n.at); R0.reminder = `Reminder set for ${hm(d.getHours() * 60 + d.getMinutes())}${key(d) === TK() ? "" : " on " + fmtDay(d)}.`; }
    }
    S.busy = false;
    N.call("run.end").catch(() => {});
    haptic(failed ? "error" : "success");
    renderPage(); render(); scheduleReminders();
  }

  // ---------- actions ----------
  async function buy(kind, n, btn) {
    const pr = S.prices && S.prices[kind]; if (!pr) return;
    const count = Math.max(1, Math.round(n / (pr.book || 1))), bk = pr.book || 1;
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      await W.buyUrl(S.permitId, pr.periodPriceId, count); // checks the council allows that many
      await savePlan();
      const label = bk > 1 ? `${count} book${count > 1 ? "s" : ""} of ${bk} × ${VT[kind].label}` : `${count} × ${VT[kind].label}`;
      closeSheets();
      await N.call("council.show", { reason: "buy", path: "/Home/ApplicantPermits", buy: { permitId: S.permitId, periodPriceId: pr.periodPriceId, count, label } });
    } catch (e) { btn.disabled = false; btn.textContent = "Try again"; toast(e.message); }
  }
  function addDraft(vrn, dk, a, b) {
    if (b - a < 15) b = a + 60;
    const r = M.checkTimes(ctx(), dk, a, Math.min(P.LAST_MIN, b));
    if (r.err) { toast(r.err); return; }
    const id = seq++;
    S.entries.push({ id, vrn, dk, from: r.f, to: r.t, ...(S.settings.emailAll ? { email: true } : {}) });
    savePlan(); haptic("light"); render();
    toast(`Added ${range(r.f, r.t)} to your plan.`, () => { S.entries = S.entries.filter((x) => x.id !== id); savePlan(); render(); });
  }
  const signIn = () => N.call("council.show", { reason: "signin", path: "/Account/Login" }).catch((e) => toast(e.message));

  const actions = {
    tab(t) { S.tab = t.dataset.tab; S.dayView = null; S.confirmSignOut = false; render(); },
    retry() { load(); },
    refresh() { load({ keepPermits: true }); },
    signin: signIn,
    council() { N.call("council.show", { reason: "browse", path: "/Home/ApplicantPermits" }).catch((e) => toast(e.message)); },
    terms() { openSheet({ type: "terms", title: "Terms", tall: true }); },
    report() { if (S.lastReport) N.call("share", { title: "Voucherboard error report", text: S.lastReport }).catch(() => toast("Couldn't open sharing.")); },
    signout() { S.confirmSignOut = !S.confirmSignOut; render(); },
    async signoutyes() { S.confirmSignOut = false; try { await N.call("council.signOut"); } catch (e) { /* cleared or not, sign in again */ } S.signedOut = true; S.loadedAt = 0; S.phase = "signin"; N.call("notify.schedule", { items: [] }).catch(() => {}); render(); },
    async taccept() { await store.set("vb:terms", { version: T.VERSION, at: new Date().toISOString() }); S.phase = "loading"; renderPage(); load(); },
    tdecline() { $("#page").innerHTML = `<div class="state"><h2>Voucherboard needs the terms accepted</h2><p class="note">Nothing has been read from the council site. You can accept the terms whenever you're ready.</p><button type="button" class="btn pri" data-a="tagain">Read the terms again</button></div>`; },
    tagain() { renderPage(); },
    async set(t) {
      const k = t.dataset.k, v = !S.settings[k];
      if (k === "reminders" && v) { try { const r = await N.call("notify.permission"); if (!r || !r.granted) { toast("Notifications are off for Voucherboard. Turn them on in your phone's settings."); return; } } catch (e) { /* no shell: keep the setting */ } }
      S.settings[k] = v; saveSettings();
      if (k === "emailAll") { for (const e of S.entries) e.email = v; savePlan(); }
      if (k === "reminders") scheduleReminders();
      render();
    },
    // board
    board() { S.board.force = true; S.board.zoom = S.dayView ? "day" : "week"; S.board.cursor = fromKey(S.dayView || S.calDay || TK()); N.call("orientation.set", { mode: "landscape" }).catch(() => {}); render(); },
    boardexit() { S.board.force = false; S.board.select = null; N.call("orientation.set", { mode: "auto" }).catch(() => {}); render(); },
    zoom(t) { S.board.zoom = t.dataset.z; renderBoard(); },
    bnav(t) { S.board.cursor = addDays(S.board.cursor, (+t.dataset.d) * (S.board.zoom === "day" ? 1 : 7)); renderBoard(); },
    selclear() { S.board.select = null; renderBoard(); },
    bulk() { openSheet({ type: "bulk", title: "Selected" }); },
    bulkask() { top().confirm = true; renderSheet(); },
    bulkno() { top().confirm = false; renderSheet(); },
    bulkone() { const k = [...S.board.select][0]; S.sheets = []; if (k.startsWith("e:")) openSheet({ type: "entry", id: +k.slice(2), title: "Planned booking" }); else openSheet({ type: "visit", k: k.slice(2), mode: "change", title: "Booking" }); },
    async bulkyes() {
      const s = top(), sel = [...S.board.select];
      s.busy = true; renderSheet();
      const ents = new Set(sel.filter((k) => k.startsWith("e:")).map((k) => +k.slice(2)));
      S.entries = S.entries.filter((e) => !ents.has(e.id));
      const ids = sel.filter((k) => k.startsWith("b:")).map((k) => findVisit(k.slice(2))).filter((v) => v && v.items.every((i) => i.cancellable) && status(v.dk, v.start, v.end) === "up").flatMap((v) => v.ids);
      const { done, err } = ids.length ? await M.cancelIds(ids) : { done: 0, err: null };
      if (done) { const gone = new Set(ids.slice(0, done)); S.entries = S.entries.filter((e) => !(e.replaces || []).some((id) => gone.has(id))); }
      await savePlan();
      if (done) { try { await loadPermitData(); } catch (e) { /* shown on the next refresh */ } }
      S.board.select = null; closeSheets(); render(); scheduleReminders();
      toast(err ? `Cancelled ${done} of ${ids.length}. ${err.message}` : [done && `${done} cancelled`, ents.size && `${ents.size} removed from your plan`].filter(Boolean).join(", ") + ".");
      if (done) haptic(err ? "error" : "success");
    },
    // calendar
    calday(t) { S.calDay = t.dataset.dk; render(); },
    dayview(t) { S.dayView = t.dataset.dk || null; render(); },
    // sheets
    close() { closeSheet(); },
    undo() { const t = $("#toast"); t.hidden = true; if (t._undo) t._undo(); },
    plan() { openSheet({ type: "plan", title: "Your plan" }); },
    review() { S.run = null; startRun(null, false); },
    rungo() { runGo(); },
    runstop() { S.run.stop = true; renderPage(); },
    runclose() { if (S.busy) return; S.run = null; renderPage(); render(); },
    rment(t) {
      const id = +t.dataset.id, e = S.entries.find((x) => x.id === id); if (!e) return;
      S.entries = S.entries.filter((x) => x !== e); savePlan(); renderSheet(); render();
      toast(e.replaces ? "Change dropped. The booking stays as it is." : "Removed from your plan.", () => { S.entries.push(e); savePlan(); render(); });
    },
    clearplan() { const s = top(); if (!s.confirmClear) { s.confirmClear = true; renderSheet(); return; } const old = S.entries; S.entries = []; savePlan(); closeSheets(); render(); toast("Plan cleared.", () => { S.entries = old; savePlan(); render(); }); },
    entry(t) { openSheet({ type: "entry", id: +t.dataset.id, title: "Planned booking" }); },
    esave() {
      const s = top(), e = S.entries.find((x) => x.id === s.id); if (!e) return;
      const r = M.checkTimes(ctx(), e.dk, parseHM($("#enFrom").value), parseHM($("#enTo").value));
      if (r.err) { s.err = r.err; renderSheet(); return; }
      e.from = r.f; e.to = r.t; delete e.movedFrom; savePlan(); closeSheet(); render(); toast(r.msg || `Changed to ${range(r.f, r.t)}.`);
    },
    erm() { const s = top(); closeSheet(); actions.rment({ dataset: { id: s.id } }); },
    visit(t) { if (handleSelectTap(t)) return; openSheet({ type: "visit", k: t.dataset.k, mode: t.dataset.mode || "", title: "Booking" }); },
    vmode(t) { const s = top(); s.mode = t.dataset.mode; s.err = ""; renderSheet(); },
    vopt(t) { top().opt = +t.dataset.i; renderSheet(); },
    vagain() { const v = findVisit(top().k); if (!v) return; openQuick({ vrns: [v.vrn], days: [], from: v.start, to: v.end }); const q = top(); q.when = "days"; q.days = []; renderSheet(); toast("Pick the days, then add them to your plan."); },
    vchg() {
      const s = top(), v = findVisit(s.k); if (!v) return;
      const r = M.checkTimes(ctx(), v.dk, parseHM($("#chFrom").value), parseHM($("#chTo").value));
      if (r.err) { s.err = r.err; renderSheet(); return; }
      if (r.f === v.start && r.t === v.end) { s.err = "That's the booking's current time."; renderSheet(); return; }
      const old = S.entries.find((e) => (e.replaces || []).some((id) => v.ids.includes(id)));
      if (old) { old.from = r.f; old.to = r.t; old.replaces = v.ids; delete old.movedFrom; }
      else S.entries.push({ id: seq++, vrn: v.vrn, dk: v.dk, from: r.f, to: r.t, replaces: v.ids, ...(S.settings.emailAll ? { email: true } : {}) });
      savePlan(); closeSheets(); render(); toast(`Change to ${range(r.f, r.t)} added to your plan. Review it to apply.`);
    },
    async vcancel() {
      const s = top(), v = findVisit(s.k); if (!v) return;
      s.busy = true; renderSheet();
      const { done, err } = await M.cancelIds(v.ids);
      const gone = new Set(v.ids.slice(0, done)), before = S.entries.length;
      S.entries = S.entries.filter((e) => !(e.replaces || []).some((id) => gone.has(id)));
      if (S.entries.length !== before) await savePlan();
      try { await loadPermitData(); } catch (e) { /* shown on the next refresh */ }
      closeSheets(); render(); scheduleReminders(); haptic(err ? "error" : "success");
      toast(err ? `Cancelled ${done} of ${v.ids.length}. ${err.message}` : `Cancelled. ${plural(done, "voucher")} returned.${S.entries.length !== before ? " Its planned change was removed from your plan." : ""}`);
    },
    async vend() {
      const s = top(), v = findVisit(s.k); if (!v) return;
      const o = P.shrinkOptions(v.items, S.now)[s.opt || 0]; if (!o) return;
      s.busy = true; renderSheet();
      const { done, err } = await M.cancelIds([...o.cancel].reverse()); // latest first, so what's left stays unbroken
      try { await loadPermitData(); } catch (e) { /* shown on the next refresh */ }
      closeSheets(); render(); scheduleReminders(); haptic(err ? "error" : "success");
      toast(err ? `Cancelled ${done} of ${o.cancel.length}. ${err.message}` : `Now ends at ${hm(o.end)}. ${plural(done, "voucher")} returned.`);
    },
    extend(t) { const dk = t.dataset.dk, end = +t.dataset.end, c = ctlAt(dk, end); openQuick({ vrns: [t.dataset.vrn], days: [dk], from: end, to: Math.min(end + 60, c ? c.t : end + 60), preset: "keep" }); },
    veh(t) { openSheet({ type: "veh", vrn: t.dataset.vrn, title: "Vehicle" }); },
    vdel() { const s = top(); s.confirmDel = !s.confirmDel; renderSheet(); },
    async vdelyes() {
      const s = top(), v = vehicle(s.vrn); s.busy = true; renderSheet();
      let err = null;
      try {
        await W.deleteFavourite(v.favId);
        const favs = await W.loadVehicles();
        if (favs.some((f) => f.favId === v.favId)) throw new W.PortalError("The council site didn't delete it. Try on its Vehicles page.");
        S.vehicles = M.mergeVehicles(S.vehicles, favs, S.bookings, S.entries.map((e) => e.vrn));
      } catch (e) { err = e; }
      closeSheets(); render();
      toast(err ? `Couldn't delete "${v.nick}". ${err.message}` : `Deleted "${v.nick}" from your favourites.`);
    },
    async vsave() {
      const s = top(), v = vehicle(s.vrn), nick = ($("#fvNick").value || "").trim(); s.nick = nick;
      const fail = (m) => { s.busy = false; s.err = m; renderSheet(); };
      if (!nick) return fail("Enter a nickname.");
      if (S.vehicles.some((x) => x !== v && isFav(x) && x.nick.toLowerCase() === nick.toLowerCase())) return fail(`You already have a favourite called "${nick}".`);
      s.busy = true; s.err = ""; renderSheet();
      try {
        const r = await W.checkNickname(nick); if (!r.ok) return fail(r.message || "The council site won't accept that nickname.");
        await W.createFavourite(nick, v.vrn);
        const favs = await W.loadVehicles(); if (!favs.some((f) => f.vrn === v.vrn)) return fail("The council site didn't save it. Try on its Vehicles page.");
        S.vehicles = M.mergeVehicles(S.vehicles, favs, S.bookings, S.entries.map((e) => e.vrn));
      } catch (e) { return fail(e.message); }
      closeSheets(); render(); toast(`Saved "${nick}" as a favourite.`);
    },
    newfav() { openSheet({ type: "newfav", title: "New favourite" }); },
    async nfsave() {
      const s = top(); s.vrn = $("#nfPlate").value; s.nick = $("#nfNick").value;
      const vrn = W.normVrn(s.vrn), nick = s.nick.trim();
      const fail = (m) => { s.busy = false; s.err = m; renderSheet(); };
      if (vrn.length < 2) return fail("Enter a number plate.");
      if (!nick) return fail("Enter a nickname.");
      if (S.vehicles.some((x) => x.fav && x.vrn === vrn)) return fail("That vehicle is already a favourite.");
      if (S.vehicles.some((x) => isFav(x) && x.nick.toLowerCase() === nick.toLowerCase())) return fail(`You already have a favourite called "${nick}".`);
      s.busy = true; s.err = ""; renderSheet();
      try {
        const r = await W.checkNickname(nick); if (!r.ok) return fail(r.message || "The council site won't accept that nickname.");
        await W.createFavourite(nick, vrn);
        const favs = await W.loadVehicles(); if (!favs.some((f) => f.vrn === vrn)) return fail("The council site didn't save it. Try on its Vehicles page.");
        S.vehicles = M.mergeVehicles(S.vehicles, favs, S.bookings, S.entries.map((e) => e.vrn));
      } catch (e) { return fail(e.message); }
      closeSheets(); render(); toast(`Saved "${nick}" as a favourite.`);
    },
    buy(t) { buy(t.dataset.k, +t.dataset.n, t); },
    // quick-book
    quick(t) { const vrn = t.dataset.vrn, dk = t.dataset.dk; openQuick({ vrns: vrn ? [vrn] : [], days: dk ? [dk] : undefined }); },
    qpick(t) { const q = top(); if (!q.vrns.includes(t.dataset.vrn)) q.vrns.push(t.dataset.vrn); q.qq = ""; q.newv = null; renderSheet(); },
    qrm(t) { const q = top(); q.vrns = q.vrns.filter((v) => v !== t.dataset.vrn); renderSheet(); },
    qnew(t) { const q = top(); q.newv = { vrn: t.dataset.vrn, save: false, nick: "" }; q.qq = ""; renderSheet(); },
    qnvsave() { const q = top(); q.newv.save = !q.newv.save; renderSheet(); },
    qnvno() { top().newv = null; renderSheet(); },
    async qnvadd() {
      const q = top(), n = q.newv, nick = n.nick.trim();
      if (n.save) {
        if (!nick) { n.error = "Enter a nickname to save this vehicle as a favourite."; renderSheet(); return; }
        if (S.vehicles.some((v) => isFav(v) && v.nick.toLowerCase() === nick.toLowerCase())) { n.error = `You already have a favourite called "${nick}".`; renderSheet(); return; }
        n.checking = true; n.error = ""; renderSheet();
        try { const r = await W.checkNickname(nick); n.checking = false; if (!r.ok) { n.error = r.message || "The council site won't accept that nickname."; renderSheet(); return; } }
        catch (e) { n.checking = false; n.error = e.message; renderSheet(); return; }
      }
      const ex = S.vehicles.find((v) => v.vrn === n.vrn);
      if (ex && !ex.fav) { ex.pendingFav = n.save; if (n.save) ex.nick = nick; }
      else if (!ex) S.vehicles.push({ vrn: n.vrn, fav: false, pendingFav: n.save, nick: n.save ? nick : n.vrn });
      if (!q.vrns.includes(n.vrn)) q.vrns.push(n.vrn);
      q.newv = null; renderSheet();
    },
    qwhen(t) {
      const q = top(), w = t.dataset.w; q.when = w;
      if (w === "now") { q.from = S.now; q.to = S.now + (q.preset === "2h" ? 120 : q.preset === "5h" ? 300 : 60); if (q.preset === "whole") q.preset = "1h"; }
      if (w === "today") { q.days = [TK()]; const c = ctlAt(TK(), S.now); if (q.from < S.now || (c && q.from < c.f)) { q.from = c ? Math.max(c.f, S.now) : S.now; q.to = q.from + 60; q.preset = "1h"; } }
      if (w === "days") { if (q.days.length === 1 && q.days[0] === TK()) { const n = nextControlled(); q.days = n && n.dk !== TK() ? [n.dk] : [key(addDays(S.today, 1))]; } const c = ctlAt(q.days[0], 0); if (c && q.from < c.f) { q.from = c.f; q.to = c.f + 60; } }
      if (q.preset && q.preset !== "end") quickApplyPreset(q, q.preset);
      renderSheet();
    },
    qpre(t) { quickApplyPreset(top(), t.dataset.p); renderSheet(); },
    qday(t) { const q = top(), dk = t.dataset.dk; q.days = q.days.includes(dk) ? q.days.filter((x) => x !== dk) : [...q.days, dk].sort(); renderSheet(); },
    qdays(t) { const q = top(); q.days = q._qd[t.dataset.q](); renderSheet(); },
    qplan() {
      const q = top(), ids = quickToEntries(q); if (!ids.length) return;
      savePlan(); closeSheets(); render(); haptic("light");
      toast(`Added ${plural(ids.length, "booking")} to your plan.`, () => { S.entries = S.entries.filter((e) => !ids.includes(e.id)); savePlan(); render(); });
    },
    qbook() { openSheet({ type: "confirm", q: top(), email: S.settings.emailAll, title: "Check and book" }); },
    cemail() { const s = top(); s.email = !s.email; renderSheet(); },
    cgo() {
      const s = top(), ids = quickToEntries(s.q);
      if (!ids.length) return;
      for (const e of S.entries) if (ids.includes(e.id)) { if (s.email) e.email = true; else delete e.email; }
      savePlan();
      startRun(new Set(ids), true);
      if (S.run) S.run.added = ids;
    }
  };

  // Board: a tap on a block while selecting adds it to the selection instead of opening it.
  function handleSelectTap(t) {
    if (!S.board.select || !t.dataset.sk || !t.closest(".board")) return false;
    const k = t.dataset.sk, sel = S.board.select;
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
      if (k === "vq") { S.vq = t.value; $("#vlist").innerHTML = vehicleListHTML(); }
    });
    doc.addEventListener("change", (e) => {
      const t = e.target, k = t.dataset && t.dataset.in;
      if (k === "qfrom" || k === "qto") {
        const q = top(), m = parseHM(t.value); if (m == null) return;
        if (k === "qfrom") { const d = q.to - q.from; q.from = m; q.to = Math.min(P.LAST_MIN, m + Math.max(15, d)); } else q.to = m;
        q.preset = ""; renderSheet(); return;
      }
      if (k === "permit" && t.value !== S.permitId) { S.permitId = t.value; store.set("vb:permit", S.permitId); load({ keepPermits: true }); return; }
      if (k === "subzone") { S.zone = S.subzones.find((z) => z.code === t.value) || null; store.set("vb:subzone:" + S.permitId, S.zone && S.zone.code); render(); scheduleReminders(); return; }
      if (k === "lead") { S.settings.lead = +t.value; saveSettings(); scheduleReminders(); }
    });
    wireGestures();
    landMQ.addEventListener && landMQ.addEventListener("change", () => { if (!landMQ.matches) S.board.select = null; render(); });
    N.on("app.state", (d) => {
      if (d.state === "background" && S.run && S.run.phase === "running") { S.run.stop = true; S.run.paused = true; }
      if (d.state === "active" && S.phase === "ready" && !S.busy && Date.now() - S.loadedAt > 5 * 60 * 1000) load({ keepPermits: true });
    });
    N.on("council.closed", (d) => { if (d.reason === "signin" && !d.signedIn) return; load({ keepPermits: d.reason !== "signin" }); });
    N.on("notification", (d) => {
      if (S.phase !== "ready") return;
      S.tab = "today"; S.dayView = null; closeSheets(); render();
      const x = d.data || {};
      if (d.action === "extend" && x.vrn && x.dk && x.end != null) actions.extend({ dataset: { vrn: x.vrn, dk: x.dk, end: x.end } });
    });
    N.on("back", () => {
      if (S.run) { if (!S.busy) actions.runclose(); return true; }
      if (S.sheets.length) { closeSheet(); return true; }
      if (S.board.select) { actions.selclear(); return true; }
      if (S.board.force) { actions.boardexit(); return true; }
      if (S.dayView) { S.dayView = null; render(); return true; }
      if (S.tab !== "today") { S.tab = "today"; render(); return true; }
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
        if (g.blk) { S.board.select = S.board.select || new Set(); S.board.select.add(g.blk.dataset.sk); g.blk._suppress = true; renderBoard(); g = null; return; }
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
      if (pinch) { const r = pinch.r || 1; pinch = null; const i = ZOOMS.indexOf(S.board.zoom); if (r > 1.25 && i < 2) { S.board.zoom = ZOOMS[i + 1]; renderBoard(); } else if (r < 0.8 && i > 0) { S.board.zoom = ZOOMS[i - 1]; renderBoard(); } return; }
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
        d.done = () => addDraft(vrn, dk, Math.min(d.begin, d.end), Math.max(d.begin, d.end));
      } else { // horizontal: board track
        const map = $(".board")._map, { days, win, n } = map, span = win.t - win.f;
        const pos = (p) => { const fr = Math.min(Math.max((p.clientX - r.left) / r.width, 0), 0.9999) * n, i = Math.floor(fr); return { i, m: Math.round((win.f + (fr - i) * span) / 15) * 15 }; };
        const s0 = pos({ clientX: d.x }), dk = key(days[s0.i]);
        if (!P.inWindow(S.today, days[s0.i])) { cancel(); toast("That day can't be booked."); return; }
        const clamp = (m) => (dk === TK() ? Math.max(m, S.now) : m);
        d.begin = clamp(s0.m); d.end = d.begin + 60;
        d.at = (p) => { const q = pos(p); return clamp(q.i === s0.i ? q.m : q.i > s0.i ? win.t : win.f); };
        d.update = () => { const a = Math.min(d.begin, d.end), b = Math.max(d.begin, d.end), X = (m) => ((s0.i + (m - win.f) / span) / n) * 100; ghost.style.cssText = `top:4px;height:32px;left:${X(a)}%;width:${Math.max(0.5, X(b) - X(a))}%`; ghost.textContent = n === 1 ? range(a, b) : ""; };
        d.done = () => addDraft(vrn, dk, Math.min(d.begin, d.end), Math.max(d.begin, d.end));
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

  // ---------- clock ----------
  function tick() {
    const t = todayDate();
    if (key(t) !== key(S.today)) { S.today = t; S.now = nowMin(); if (!S.busy && S.phase === "ready") load({ keepPermits: true }); return; }
    const n = nowMin(); if (n === S.now) return;
    S.now = n;
    if (S.phase !== "ready") return;
    const before = S.entries.map((e) => e.from).join();
    S.entries = P.advanceEntries(ctx(), S.entries);
    if (S.entries.map((e) => e.from).join() !== before) savePlan();
    const typing = doc.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(doc.activeElement.tagName);
    if (!S.sheets.length && !S.run && !typing) render();
  }

  // ---------- start ----------
  async function start() {
    W.transport = N.transport;
    wire();
    try { const h = await N.call("hello"); S.version = (h && h.version) || ""; S.platform = (h && h.platform) || ""; } catch (e) { /* no shell */ }
    S.settings = { ...S.settings, ...(await store.get("vb:settings", {})) };
    render();
    setInterval(tick, 15000);
    await load();
  }
  root.VB.mobile = { start, S, actions, render };
  if (root.VB_MANUAL_START) return; // tests start it themselves
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start); else start();
})(typeof globalThis !== "undefined" ? globalThis : this);
