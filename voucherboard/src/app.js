// Voucherboard UI. Renders into a shadow root over the council permit site and uses VB.portal for data.
(function (root) {
  "use strict";
  const Z = root.VB.zones, P = root.VB.planner, W = root.VB.portal, T = root.VB.terms;
  const { VT, KINDS, key, fromKey, addDays, hm, pad, fmtMins, valueOf } = P;
  const H = (h, m) => h * 60 + (m || 0);
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SECS_PER_REQ = (W.GAP_MS + 300) / 1000; // measured portal responses are 75–580 ms, plus the pause
  const ISSUES_URL = "https://github.com/maubergine/voucherboard/issues";

  // ---------- storage (per browser, never leaves the device) ----------
  const store = {
    async get(k, dflt) {
      try { const r = await chrome.storage.local.get(k); return r[k] !== undefined ? r[k] : dflt; } catch (e) { return dflt; }
    },
    async set(k, v) { try { await chrome.storage.local.set({ [k]: v }); } catch (e) { /* storage unavailable */ } }
  };

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const dow = P.isoDow;
  const hShort = (m) => { const h = Math.floor(m / 60), mm = m % 60; return mm ? h + ":" + pad(mm) : String(h); };
  const fmtDay = (d) => DOW[dow(d) - 1] + " " + d.getDate() + " " + MON[d.getMonth()];
  const gbp = (n) => (n == null ? "—" : "£" + n.toFixed(2));
  const fmtDur = (s) => (s < 60 ? Math.max(1, Math.round(s)) + " sec" : Math.round(s / 60) + " min");
  const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? H(+m[1], +m[2]) : null; };
  const plateHTML = (v, sm) => { const s = v.length > 4 ? v.slice(0, 4) + " " + v.slice(4) : v; return `<span class="plate${sm ? " sm" : ""}"><i></i><span>${esc(s)}</span></span>`; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const todayDate = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  function create(host) {
    const shadow = host.attachShadow({ mode: "open" });
    // Styles go in as text: the portal's CSP allows inline styles, but not every browser lets it load extension URLs.
    const style = document.createElement("style");
    const wrap = el("div", "vb");
    shadow.append(style, wrap);
    const cssReady = fetch(chrome.runtime.getURL("src/app.css")).then((r) => r.text()).then((t) => { style.textContent = t; })
      .catch(() => { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = chrome.runtime.getURL("src/app.css"); shadow.prepend(link); });
    const $ = (s) => shadow.querySelector(s);
    const $$ = (s) => [...shadow.querySelectorAll(s)];

    const S = {
      loading: true, error: null, permits: [], permitId: null, details: null, zone: null, prices: null,
      vehicles: [], bookings: [], balance: { h1: 0, h5: 0, day: 0 }, weekVouchers: 0,
      entries: [], sel: { vrns: [], days: [], from: null, to: null }, strat: "cheapest",
      view: "week", cursor: todayDate(), today: todayDate(), now: nowMin(),
      plan: null, adv: null, adj: "", newv: null, pop: null, busy: false, editing: null, listFilter: [], bulk: false, listSel: new Set(), bulkPanel: null, bulkTime: { mode: "set", f: null, t: null, shift: 15 }, listRows: new Map(),
      settings: { testMode: false, favsOpen: true, pastOpen: false, costOpen: false, betaLive: false, listSort: "date", listPast: false, emailAll: false }
    };
    let entrySeq = 1, modal = null, drag = null, comboIdx = 0, timeEdit = null;
    const TK = () => key(S.today);
    const ctx = () => ({ zone: S.zone, today: S.today, now: S.now, bookings: S.bookings, prices: S.prices });
    const vehicle = (vrn) => S.vehicles.find((v) => v.vrn === vrn) || { vrn, nick: vrn, fav: false };
    const vName = (v) => (v.fav || v.pendingFav ? esc(v.nick) : `${esc(v.vrn)}<span class="oneoff">one-off</span>`);
    const vText = (v) => (v.fav || v.pendingFav ? v.nick : v.vrn);
    // favourites first, by nickname then plate; the rest by plate
    const isFavV = (v) => v.fav || v.pendingFav;
    const byVehicle = (a, b) => (isFavV(b) - isFavV(a)) || (isFavV(a) ? a.nick.localeCompare(b.nick, "en-GB", { sensitivity: "base" }) : 0) || a.vrn.localeCompare(b.vrn);
    const typesText = (u) => KINDS.filter((k) => u[k]).map((k) => `${u[k]} × ${VT[k].label}`).join(" + ");
    const controls = (d) => P.controls(S.zone, d);
    const ctlList = (d) => controls(d) || [];
    const inWindow = (d) => P.inWindow(S.today, d);
    const shortZone = () => !!S.zone && S.zone.rules.every((r) => r.t - r.f <= 180);
    const ctlText = (d) => { const c = controls(d); if (!c) return "Hours unknown"; return c.length ? c.map((x) => hShort(x.f) + "–" + hShort(x.t)).join(", ") : "No controls"; };
    const zoneSummary = () => S.zone ? S.zone.rules.map((r) => { const ds = r.d; const l = ds.length === 1 ? DOW[ds[0] - 1] : DOW[ds[0] - 1] + "–" + DOW[ds[ds.length - 1] - 1]; return l + " " + hm(r.f) + "–" + hm(r.t); }).join(" · ") : "Hours not known for this zone";
    const isNarrow = () => window.matchMedia("(max-width:700px)").matches;
    const planKey = () => "vb:plan:" + S.permitId;
    const savePlan = () => store.set(planKey(), S.entries.map(({ id, vrn, dk, from, to, replaces, email }) => ({ id, vrn, dk, from, to, ...(replaces ? { replaces } : {}), ...(email ? { email } : {}) })));
    const saveSettings = () => store.set("vb:settings", S.settings);

    // ---------- layout ----------
    wrap.innerHTML = `
<div class="toppanel"><div class="in">
  <div class="brand"><div class="mark" aria-hidden="true">V</div><div><b>Voucherboard <span class="betatag">Beta</span><span class="betatag testtag" id="testTag" hidden>Test mode</span></b><small>Visitor permit planner · beta version</small></div></div>
  <div class="tp-actions">
    <div class="tp-ctl"><label for="permitSel">Permit</label><select id="permitSel"></select></div>
    <button type="button" class="tpbtn" id="settingsBtn">Settings</button>
    <button type="button" class="tpbtn" id="termsBtn">Terms</button>
    <a class="tpbtn" id="guideLink" href="${esc(chrome.runtime.getURL("guide/index.html"))}" target="_blank" rel="noopener">Guide</a>
    <a class="tpbtn" id="reportIssue" href="${esc(ISSUES_URL)}" target="_blank" rel="noopener noreferrer">Report issue</a>
    <button type="button" class="tpbtn" id="reload">Refresh</button>
    <button type="button" class="tpbtn" id="close">Show council page</button>
  </div>
</div></div>
<div id="main"></div>
<footer class="vbfoot">Voucherboard Beta. © 2026 ${esc(T.OWNER)}. All rights reserved, including all commercial rights. Licensed for personal, non-commercial use only; copying or reuse isn't allowed. An independent tool, not made or endorsed by Lewisham Council. You use it entirely at your own risk. <button type="button" class="linkbtn" id="termsLink">Terms and conditions</button></footer>`;

    const mainHTML = `
<div class="subbar"><h2>Visitor permits</h2><div class="zonecard" id="zoneCard"></div><div class="balance" id="balance" aria-label="Unused vouchers"></div></div>
<main class="app">
  <section class="panel" aria-label="Bookings">
    <div class="board-head">
      <div class="tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected="false" data-view="day">Day</button>
        <button role="tab" aria-selected="true" data-view="week">Week</button>
        <button role="tab" aria-selected="false" data-view="cal">28 days</button>
        <button role="tab" aria-selected="false" data-view="list">List</button>
      </div>
      <div class="nav">
        <button class="iconbtn" id="prev" aria-label="Previous">‹</button>
        <div class="navlabel" id="navLabel"></div>
        <button class="iconbtn" id="next" aria-label="Next">›</button>
        <button class="iconbtn" id="todayBtn">Today</button>
      </div>
    </div>
    <div class="legend">
      <span><i class="lg-band"></i>Controlled hours</span><span><i class="lg-hatch"></i>No controls (no voucher needed)</span>
      <span><i class="lg-book"></i>Booked</span><span><i class="lg-draft"></i>In your plan</span><span><i class="lg-pending"></i>Being added</span>
      <span><i class="lg-past"></i>Finished</span><span id="hint"></span>
    </div>
    <div class="board" id="board"></div>
  </section>
  <aside class="panel composer" aria-label="Plan bookings">
    <div class="c-head"><h3>Add to plan</h3><p>Pick vehicles, days and a time, then add them. Each addition joins the plan; nothing is replaced.</p></div>
    <div class="c-sec">
      <h4>Vehicles <button id="clearV" type="button">Clear</button></h4>
      <div class="combo">
        <input type="text" id="vq" placeholder="Search name or plate, or type a new plate" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="vlist" aria-autocomplete="list" maxlength="10">
        <div class="combo-list" id="vlist" role="listbox" hidden></div>
      </div>
      <div id="newv"></div><div class="vsel" id="vsel"></div>
    </div>
    <div class="c-sec"><h4>Days <button id="clearD" type="button">Clear</button></h4><div class="quick" id="dquick"></div><div class="mini" id="mini"></div></div>
    <div class="c-sec">
      <h4>Time</h4><div class="quick" id="tquick"></div>
      <div class="row2">
        <div class="ctl"><label for="tFrom">From</label><div class="withnow"><input type="time" id="tFrom" step="60"><button type="button" class="nowbtn" id="nowBtn" title="Start now, today">Now</button></div></div>
        <div class="ctl"><label for="tTo">Until</label><input type="time" id="tTo" step="60"></div>
      </div>
      <div class="adj" id="adj" hidden></div>
      <span class="note">Hours outside controls are always skipped. The council site refuses bookings then, and no voucher is needed.</span>
    </div>
    <div class="c-sec addbar"><div class="plan" id="pending"></div><button class="primary" id="addPlan" disabled>Add to plan</button></div>
    <div class="c-head"><h3>Your plan</h3><p id="planSub"></p></div>
    <div class="c-sec">
      <div class="plan-head"><h4 style="margin:0">Planned bookings</h4><h4 style="margin:0"><button id="clearPlan" type="button">Clear all</button></h4></div>
      <label class="toggle" id="emailAllWrap"><input type="checkbox" id="emailAll"><span>Email me a confirmation for every booking<small>The council site emails your account's address for each voucher booked. New bookings in the plan follow this too.</small></span></label>
      <div class="plan" id="plan"></div>
      <div class="ctl" id="stratWrap" hidden><label for="strat">When several voucher types fit</label>
        <select id="strat"><option value="cheapest">Lowest cost</option><option value="save">Keep 5-hour and day vouchers for longer visits</option></select></div>
    </div>
    <div class="summary" id="summary"></div>
  </aside>
</main>
<div class="mbar" id="mbar" hidden><button type="button" class="mb-t" id="mbGo"><b id="mbTitle"></b><span id="mbSub"></span></button><button type="button" class="primary" id="mbReview">Review</button></div>`;

    function renderState(title, body, spin, actions) {
      $("#main").innerHTML = `<div class="state">${spin ? '<div class="spin" aria-hidden="true"></div>' : ""}<h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}${actions || ""}</div>`;
    }

    // ---------- terms ----------
    // Nothing is read from the council site until the current terms are accepted.
    const termsOk = async () => { const a = await store.get("vb:terms", null); return !!a && a.version === T.VERSION; };
    function renderTermsGate() {
      $("#main").innerHTML = `<div class="terms-gate" role="region" aria-labelledby="tgT"><h3 id="tgT">Terms and conditions</h3>
        <div class="terms" tabindex="0">${T.html}</div>
        <label class="toggle"><input type="checkbox" id="tAgree"><span>I have read and accept these terms, and I understand that I use Voucherboard entirely at my own risk.</span></label>
        <div class="acts"><button type="button" class="primary" id="tAccept" disabled>Accept and continue</button><button type="button" class="ghost" id="tDecline">Don't accept</button></div></div>`;
    }
    function showTerms() {
      if (modal) return;
      modal = el("div", "scrim");
      modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="tmT"><header><h3 id="tmT">Terms and conditions</h3><p>© 2026 ${esc(T.OWNER)}. All rights reserved.</p></header>
        <div class="body terms">${T.html}</div><footer><button type="button" class="primary" id="tmClose">Close</button></footer></div>`;
      wrap.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal || e.target.id === "tmClose") closeModal(); });
    }

    function showSettings() {
      if (modal) return;
      modal = el("div", "scrim");
      modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="stT"><header><h3 id="stT">Settings</h3><p>Saved in this browser.</p></header>
        <div class="body settings">
          <label class="toggle"><input type="checkbox" id="sTest"${S.settings.testMode ? " checked" : ""}><span>Test mode<small>Bookings are checked with the council site but not made. No vouchers are used.</small></span></label>
          <label class="toggle"><input type="checkbox" id="sBeta"${S.settings.betaLive ? " checked" : ""}><span>Beta: end bookings in progress early<small>Lets you end a booking that has started, by cancelling its vouchers that haven't started yet.</small></span></label>
        </div><footer><button type="button" class="primary" id="stClose">Close</button></footer></div>`;
      wrap.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal || e.target.id === "stClose") closeModal(); });
    }

    // ---------- loading ----------
    async function load(opts = {}) {
      S.loading = true; closePop();
      if (!(await termsOk())) { renderTermsGate(); return; }
      renderState("Loading your permits", "Reading your vouchers, bookings and vehicles from the council site.", true);
      try {
        if (!opts.keepPermits || !S.permits.length) S.permits = await W.loadPermits();
        const usable = S.permits.filter(W.isUsableVisitorPermit);
        renderPermitSel(usable);
        if (!usable.length) { renderState("No active visitor permit", "Voucherboard works with active visitor permits. Buy visitor vouchers on the council site first.", false); return; }
        const saved = await store.get("vb:permit", null);
        if (!S.permitId || !usable.some((p) => p.id === S.permitId)) S.permitId = usable.some((p) => p.id === saved) ? saved : usable[0].id;
        $("#permitSel").value = S.permitId;
        await loadPermitData();
        const stored = await store.get(planKey(), []);
        S.entries = P.advanceEntries(ctx(), stored.map((e) => ({ ...e, id: entrySeq++ })));
        if (!$("#board")) $("#main").innerHTML = mainHTML;
        S.loading = false;
        defaultSel();
        commit();
      } catch (e) {
        S.loading = false;
        renderState("Couldn't load your permits", e.message || String(e), false, `<button class="primary" id="retry">Try again</button>`);
      }
    }
    // Favourites from the council site, then plates added this session, booked, or listed in keep.
    function applyFavourites(favs, keep = []) {
      const added = S.vehicles.filter((v) => !v.fav && !favs.some((f) => f.vrn === v.vrn));
      S.vehicles = favs.map((f) => ({ ...f, fav: true }));
      for (const v of added) S.vehicles.push(v);
      const other = (vrn) => { if (!S.vehicles.some((v) => v.vrn === vrn)) S.vehicles.push({ vrn, nick: vrn, fav: false }); };
      for (const b of S.bookings) other(b.vrn);
      for (const vrn of keep) other(vrn);
    }
    async function loadPermitData() {
      const d = await W.loadDetails(S.permitId);
      S.details = d;
      const permit = S.permits.find((p) => p.id === S.permitId);
      S.zone = Z.findZone(d.zoneName || (permit && permit.zoneName));
      S.bookings = d.bookings.map((b) => ({ ...b, type: b.mins >= 23 * 60 ? "day" : b.mins >= 300 ? "h5" : "h1" }));
      S.balance = { h1: 0, h5: 0, day: 0 }; S.weekVouchers = 0;
      for (const u of d.unused) { if (u.type in S.balance) S.balance[u.type]++; else if (u.type === "week") S.weekVouchers++; }
      applyFavourites(await W.loadVehicles());
      try { S.prices = await W.loadPrices(S.permitId); if (!Object.keys(S.prices).length) S.prices = null; } catch (e) { S.prices = null; }
    }
    function renderPermitSel(usable) {
      $("#permitSel").innerHTML = usable.length ? usable.map((p) => `<option value="${esc(p.id)}">${esc(p.ref)} · ${esc(p.zoneName.split(" - ")[0])}</option>`).join("") : `<option>No visitor permit</option>`;
    }

    // ---------- time rules ----------
    // The next controlled time that hasn't ended: later today, or the next day with controls. null if hours are unknown.
    function nextControlled() {
      for (let i = 0; i <= P.WINDOW_DAYS; i++) {
        const d = addDays(S.today, i), c = controls(d);
        if (!c) return null;
        const p = c.filter((x) => i || x.t > S.now).sort((a, b) => a.f - b.f)[0];
        if (p) return { dk: key(d), f: i ? p.f : Math.max(p.f, S.now) };
      }
      return null;
    }
    function defaultSel() { const n = nextControlled(); if (!S.sel.days.length) S.sel.days = [n ? n.dk : TK()]; if (S.sel.from == null) defaultTime(n); }
    function defaultTime(n = nextControlled()) { const f = n && S.sel.days.includes(n.dk) ? n.f : S.now; S.sel.from = f; S.sel.to = Math.min(P.LAST_MIN, f + 60); }
    function enforceNotPast() {
      S.adj = "";
      if (S.sel.from == null) return;
      const onlyToday = S.sel.days.length === 1 && S.sel.days[0] === TK();
      if (onlyToday && S.sel.from < S.now) {
        const dur = Math.max(15, S.sel.to - S.sel.from), was = S.sel.from;
        S.sel.from = S.now; S.sel.to = Math.min(P.LAST_MIN, S.now + dur);
        S.adj = `Moved to start at ${hm(S.now)} (was ${hm(was)}). Bookings can't start in the past.`;
      }
    }

    // A changed time for one day, to the minute. Same rules as the composer: not in the past, and some of it
    // must be in controlled hours (the rest is skipped when vouchers are chosen). Returns { f, t, msg } or { err }.
    function checkTimes(dk, f, t) {
      if (f == null || t == null) return { err: "Enter a start and an end time." };
      if (t <= f) return { err: "The end must be after the start." };
      t = Math.min(t, P.LAST_MIN);
      let msg = "";
      if (dk === TK() && f < S.now) {
        if (t <= S.now) return { err: "That time has already passed." };
        msg = `Starts at ${hm(S.now)} because ${hm(f)} has passed.`; f = S.now;
      }
      const d = fromKey(dk), c = controls(d);
      if (c && !P.intersect([{ f, t }], c).length) return { err: c.length ? `${hm(f)}–${hm(t)} is outside controlled hours (${ctlText(d)}). No voucher is needed then.` : "There are no controls that day. No voucher is needed." };
      return { f, t, msg };
    }
    const timeEdHTML = (f, t) => `<div class="ted"><div class="ctl"><label for="edFrom">From</label><input type="time" id="edFrom" step="60" value="${hm(f)}"></div><div class="ctl"><label for="edTo">Until</label><input type="time" id="edTo" step="60" value="${hm(t)}"></div></div><span class="err" id="edErr" hidden></span>`;
    function readTimeEd(root, dk) {
      const r = checkTimes(dk, parseHM(root.querySelector("#edFrom").value), parseHM(root.querySelector("#edTo").value)), err = root.querySelector("#edErr");
      err.hidden = !r.err; err.textContent = r.err || "";
      return r.err ? null : r;
    }
    // A booking's new time goes into the plan as an entry that replaces it. One entry per booking.
    function planChange(vrn, dk, ids, r) {
      const old = S.entries.find((e) => (e.replaces || []).some((id) => ids.includes(id)));
      if (old) { old.from = r.f; old.to = r.t; old.replaces = ids; delete old.movedFrom; }
      else S.entries.push({ id: entrySeq++, vrn, dk, from: r.f, to: r.t, replaces: ids, ...(S.settings.emailAll ? { email: true } : {}) });
    }
    function setEntryTime(e, r) {
      e.from = r.f; e.to = r.t; delete e.movedFrom;
      changedPlan(); toast(r.msg || `Changed to ${hm(r.f)}–${hm(r.t)}.`);
    }

    // ---------- planning ----------
    function buildPlan() {
      for (const e of S.entries) if (e.replaces) {
        e.replaces = e.replaces.filter((id) => { const b = S.bookings.find((x) => x.id === id); return b && bookingStatus(b.date, b.start, b.start + b.mins) === "up"; });
        if (!e.replaces.length) delete e.replaces;
      }
      const c = ctx();
      const cands = P.candidates(c, S.sel, S.entries);
      S.plan = P.allocate(c, S.entries.concat(cands), S.balance, S.strat);
      const planned = P.allocate(c, S.entries, S.balance, S.strat);
      S.adv = P.purchaseAdvice(c, S.entries, planned, S.balance);
    }

    // ---------- header ----------
    function renderHeader() {
      const z = S.zone, name = S.details ? S.details.zoneName : "";
      $("#zoneCard").innerHTML = `<div class="z">${esc(z ? z.code : (name.split(" - ")[0] || "?"))}</div><div class="zt"><b>${esc(z ? z.name : name.split(" - ")[1] || name)}</b><span>${z ? "Controls " : ""}${esc(zoneSummary())}</span></div>`;
      const b = S.balance;
      $("#balance").innerHTML = KINDS.filter((k) => b[k] > 0 || k === "h1").map((k) => `<span class="vchip num"><b>${b[k]}</b> × ${VT[k].label}</span>`).join("")
        + (S.weekVouchers ? `<span class="vchip num" title="Week vouchers aren't planned by Voucherboard yet"><b>${S.weekVouchers}</b> × 1 week</span>` : "");
      $("#stratWrap").hidden = !(b.h5 || b.day);
      $("#testTag").hidden = !S.settings.testMode;
    }

    // ---------- board ----------
    function viewWindow() {
      if (!S.zone) return { f: H(7), t: H(20) };
      let f = 1440, t = 0; for (const r of S.zone.rules) { f = Math.min(f, r.f); t = Math.max(t, r.t); }
      const p = shortZone() ? H(2) : H(1);
      return { f: Math.max(H(6), Math.floor((f - p) / 60) * 60), t: Math.min(H(22), Math.ceil((t + p) / 60) * 60) };
    }
    function splitVehicles(dates) {
      const withB = new Set(S.bookings.filter((b) => dates.includes(b.date)).map((b) => b.vrn));
      (S.plan ? S.plan.items : []).forEach((i) => { if (i.acts.length && dates.includes(i.dk)) withB.add(i.vrn); });
      S.sel.vrns.forEach((v) => withB.add(v));
      const all = [...S.vehicles].sort(byVehicle);
      return { active: all.filter((v) => withB.has(v.vrn)), others: all.filter((v) => !withB.has(v.vrn)) };
    }
    function groupBlocks(list) {
      const out = [];
      for (const x of [...list].sort((a, b) => a.start - b.start)) {
        const last = out[out.length - 1], end = x.start + (x.mins || 0);
        if (last && last.type !== "day" && x.type !== "day" && last.end === x.start && !!last.pending === !!x.pending && last.eid === x.eid) { last.end = end; last.items.push(x); }
        else out.push({ start: x.start, end, type: x.type, pending: x.pending, eid: x.eid, items: [x] });
      }
      return out;
    }
    function bookingStatus(dk, f, t) { const k = TK(); if (dk < k) return "past"; if (dk > k) return "up"; if (t <= S.now) return "past"; if (f <= S.now) return "live"; return "up"; }
    function planActsFor(vrn, dk, d) {
      const out = [];
      for (const it of (S.plan ? S.plan.items : [])) if (it.vrn === vrn && it.dk === dk) for (const a of it.acts) {
        if (a.type === "day") { const c = ctlList(d)[0]; if (c) out.push({ type: "day", start: c.f, mins: c.t - c.f, pending: it.pending, eid: it.pending ? undefined : it.entry.id }); }
        else out.push({ type: a.type, start: a.start, mins: VT[a.type].mins, pending: it.pending, eid: it.pending ? undefined : it.entry.id });
      }
      return out;
    }
    function laneHTML(d, vrn, win, o) {
      const dk = key(d), span = win.t - win.f, pct = (m) => ((Math.min(Math.max(m, win.f), win.t) - win.f) / span) * 100;
      let h = "";
      const c = controls(d);
      for (const x of c || []) { const f = Math.max(x.f, win.f), t = Math.min(x.t, win.t); if (t > f) h += `<div class="band" style="left:${pct(f)}%;width:${pct(t) - pct(f)}%"></div>`; }
      if (o.ticks) for (let m = win.f; m <= win.t; m += 60) h += `<div class="tick" style="left:${pct(m)}%"></div>`;
      const mine = S.bookings.filter((b) => b.vrn === vrn && b.date === dk), repl = P.replacedIds(ctx(), S.entries);
      for (const g of groupBlocks(mine)) {
        const st = bookingStatus(dk, g.start, g.end), chg = g.items.some((i) => repl.has(i.id));
        const segs = g.items.slice(1).map((x) => `<span class="seg" style="left:${((x.start - g.start) / (g.end - g.start)) * 100}%"></span>`).join("");
        const lbl = o.labels ? `${hm(g.start)}–${hm(g.end)}${g.items.length > 1 ? " · " + g.items.length + " vouchers" : ""}` : "";
        h += `<button class="blk ${st === "past" ? "past" : ""} ${st === "live" ? "live" : ""}${chg ? " replacing" : ""}" title="${chg ? "Being changed in your plan" : ""}" data-ids="${g.items.map((i) => esc(i.id || i.ref)).join(",")}" style="left:${pct(g.start)}%;width:${pct(g.end) - pct(g.start)}%" aria-label="${esc(vText(vehicle(vrn)))} ${hm(g.start)} to ${hm(g.end)}">${segs}<span style="position:relative">${lbl}</span></button>`;
      }
      for (const g of groupBlocks(planActsFor(vrn, dk, d))) {
        const segs = g.items.slice(1).map((x) => `<span class="seg" style="left:${((x.start - g.start) / (g.end - g.start)) * 100}%"></span>`).join("");
        const inner = `${segs}<span style="position:relative">${o.labels ? (g.pending ? "Adding " : "Planned ") + hm(g.start) + "–" + hm(g.end) : ""}</span>`, pos = `style="left:${pct(g.start)}%;width:${pct(g.end) - pct(g.start)}%"`;
        h += g.pending ? `<div class="blk draft pending" ${pos}>${inner}</div>`
          : `<button type="button" class="blk draft" data-eid="${g.eid}" ${pos} aria-label="Planned ${hm(g.start)} to ${hm(g.end)}. Change or remove">${inner}</button>`;
      }
      if (o.now && dk === TK() && S.now > win.f && S.now < win.t) h += `<div class="nowline" style="left:${pct(S.now)}%"></div>`;
      return h;
    }
    function rowsHTML(split, rowFn) {
      let h = split.active.map(rowFn).join("");
      const isFav = (v) => v.fav || v.pendingFav;
      const group = (id, open, label, list) => {
        if (!list.length) return;
        h += `<button type="button" class="grp" id="${id}" aria-expanded="${open}"><span class="tri" aria-hidden="true"></span>${label} <small>${list.length} with nothing booked here</small></button>`;
        if (open) h += list.map(rowFn).join("");
      };
      group("grpFavs", S.settings.favsOpen, "Favourites", split.others.filter(isFav));
      group("grpPast", S.settings.pastOpen, "Previously booked", split.others.filter((v) => !isFav(v)));
      if (!S.vehicles.length) h += `<div class="wkm-empty">No vehicles yet. Type a number plate in "Add to plan".</div>`;
      return h;
    }
    const whoHTML = (v) => `<div class="who"><button type="button" class="nick vbtn" data-vpop="${esc(v.vrn)}" aria-haspopup="dialog" aria-label="${esc(vText(v))}: ${v.fav && v.favId ? "delete favourite" : "save as favourite"}">${vName(v)}</button>${plateHTML(v.vrn, true)}</div>`;
    function renderDay() {
      const d = S.cursor, dk = key(d), win = viewWindow(), span = win.t - win.f, c = controls(d);
      $("#navLabel").textContent = fmtDay(d);
      $("#hint").textContent = inWindow(d) ? "Tap a row to add an hour, or drag sideways to choose a range." : "";
      let h = `<div class="tl"><div class="tl-row tl-head"><div class="who"><span class="note">${esc(c && c.length ? "Controls " + ctlText(d) : ctlText(d))}${Z.BANK_HOLIDAYS[dk] ? " · " + esc(Z.BANK_HOLIDAYS[dk]) : ""}</span></div><div class="lane" style="background:none">`;
      for (let m = win.f; m <= win.t; m += 60) h += `<span class="ticklabel" style="left:${((m - win.f) / span) * 100}%">${pad(m / 60)}</span>`;
      if (dk === TK() && S.now > win.f && S.now < win.t) h += `<span class="nowtag" style="left:${((S.now - win.f) / span) * 100}%">${hm(S.now)}</span>`;
      h += `</div></div>`;
      h += rowsHTML(splitVehicles([dk]), (v) => `<div class="tl-row">${whoHTML(v)}<div class="lane${inWindow(d) ? " draggable" : ""}" data-vrn="${esc(v.vrn)}" data-dk="${dk}">${laneHTML(d, v.vrn, win, { ticks: true, labels: true, now: true })}</div></div>`);
      $("#board").innerHTML = h + `</div>`;
    }
    const weekStart = (d) => addDays(d, -(dow(d) - 1));
    function renderWeek() {
      const ws = weekStart(S.cursor), days = [...Array(7)].map((_, i) => addDays(ws, i)), keys = days.map(key), win = viewWindow();
      $("#navLabel").textContent = `${days[0].getDate()} ${MON[days[0].getMonth()]} – ${days[6].getDate()} ${MON[days[6].getMonth()]}`;
      $("#hint").textContent = "Select a day to open it.";
      if (isNarrow()) {
        let h = `<div class="wkm">`;
        for (const d of days) {
          const dk = key(d), sp = splitVehicles([dk]);
          h += `<div class="wkm-day${dk === TK() ? " today" : ""}"><button type="button" class="wkm-h" data-goto="${dk}"><span>${fmtDay(d)}</span><small>${esc(ctlText(d))} ›</small></button>`;
          h += sp.active.length ? sp.active.map((v) => `<div class="wkm-row">${whoHTML(v)}<div class="lane">${laneHTML(d, v.vrn, win, { ticks: false, labels: false, now: true })}</div></div>`).join("")
            : `<div class="wkm-empty">${ctlList(d).length || !controls(d) ? "Nothing booked or planned." : "No controls. No voucher needed."}</div>`;
          h += `</div>`;
        }
        $("#board").innerHTML = h + `</div>`;
        return;
      }
      let h = `<div class="tl week"><div class="tl-row tl-head"><div class="who"><span class="note">${hm(win.f)}–${hm(win.t)} each day</span></div><div class="wk-grid">`;
      for (const d of days) h += `<div class="wk-day${key(d) === TK() ? " today" : ""}">${DOW[dow(d) - 1]} ${d.getDate()}<small>${esc(ctlText(d))}</small></div>`;
      h += `</div></div>`;
      h += rowsHTML(splitVehicles(keys), (v) => `<div class="tl-row">${whoHTML(v)}<div class="wk-grid">${days.map((d) => `<div class="wk-cell${ctlList(d).length || !controls(d) ? "" : " nocontrol"}" role="button" tabindex="0" data-goto="${key(d)}" aria-label="Open ${fmtDay(d)}"><div class="lane">${laneHTML(d, v.vrn, win, { ticks: false, labels: false, now: true })}</div></div>`).join("")}</div></div>`);
      $("#board").innerHTML = h + `</div>`;
    }
    function groupByVehicle(list) {
      const m = {}; for (const b of list) (m[b.vrn] = m[b.vrn] || []).push(b);
      const out = []; for (const vrn in m) for (const g of groupBlocks(m[vrn])) out.push({ vrn, f: g.start, t: g.end });
      return out.sort((a, b) => a.f - b.f);
    }
    function renderCal() {
      const start = weekStart(S.today), end = addDays(S.today, P.WINDOW_DAYS), weeks = Math.ceil(((end - start) / 864e5 + 1) / 7);
      $("#navLabel").textContent = `${S.today.getDate()} ${MON[S.today.getMonth()]} – ${end.getDate()} ${MON[end.getMonth()]}`;
      $("#hint").textContent = "Select days to choose them for the next addition.";
      let h = `<div class="cal"><div class="cal-dow">${DOW.map((x) => `<div>${x}</div>`).join("")}</div><div class="cal-grid">`;
      for (let i = 0; i < weeks * 7; i++) {
        const d = addDays(start, i), dk = key(d), inW = inWindow(d), sel = S.sel.days.includes(dk), off = controls(d) && !ctlList(d).length;
        const booked = groupByVehicle(S.bookings.filter((b) => b.date === dk));
        const planned = (S.plan ? S.plan.items : []).filter((it) => it.dk === dk && it.acts.length);
        const chips = booked.map((g) => `<span class="chipbk ${bookingStatus(dk, g.f, g.t) === "past" ? "past" : ""}">${hShort(g.f)}–${hShort(g.t)} ${esc(vText(vehicle(g.vrn)))}</span>`)
          .concat(planned.map((it) => `<span class="chipbk draft${it.pending ? " pending" : ""}">+ ${esc(vText(vehicle(it.vrn)))} · ${it.acts.length} voucher${it.acts.length > 1 ? "s" : ""}</span>`));
        const shown = chips.slice(0, 3).join("") + (chips.length > 3 ? `<span class="more">+${chips.length - 3} more</span>` : "");
        const cnt = (booked.length ? `<span class="cnt" aria-label="${booked.length} booked">${booked.length}</span>` : "") + (planned.length ? `<span class="cnt draft" aria-label="${planned.length} planned">+${planned.length}</span>` : "");
        h += `<button class="cal-day${off ? " off" : ""}${inW ? "" : " out"}${dk === TK() ? " today" : ""}${sel ? " sel" : ""}" ${inW ? `data-pick="${dk}"` : "disabled"} aria-pressed="${sel}"><span class="d"><b>${d.getDate()}</b><span>${d.getDate() === 1 || i === 0 ? MON[d.getMonth()] : ""}</span></span><span class="note">${esc(ctlText(d))}</span>${Z.BANK_HOLIDAYS[dk] ? `<span class="hol">${esc(Z.BANK_HOLIDAYS[dk])}</span>` : ""}${shown}${cnt}${sel ? `<span class="ck">✓</span>` : ""}</button>`;
      }
      $("#board").innerHTML = h + `</div></div>`;
    }
    function renderBoard() {
      $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === S.view)));
      const navOn = S.view === "day" || S.view === "week";
      $(".legend").hidden = S.view === "list"; ["#prev", "#next", "#todayBtn"].forEach((s) => ($(s).hidden = !navOn));
      if (S.view === "day") renderDay(); else if (S.view === "week") renderWeek(); else if (S.view === "list") renderList(); else renderCal();
    }
    // Every booking and planned change as a row. Filter by picking vehicles; each pick adds a chip.
    function renderList() {
      $("#navLabel").textContent = "All bookings"; $("#hint").textContent = "";
      const repl = P.replacedIds(ctx(), S.entries), rows = [], by = {};
      for (const b of S.bookings) (by[b.vrn + "|" + b.date] = by[b.vrn + "|" + b.date] || []).push(b);
      for (const k in by) for (const g of groupBlocks(by[k])) {
        const b0 = g.items[0];
        rows.push({ kind: "b", vrn: b0.vrn, dk: b0.date, f: g.start, t: g.end, g, st: bookingStatus(b0.date, g.start, g.end), chg: g.items.some((i) => repl.has(i.id)) });
      }
      for (const it of S.plan ? S.plan.items : []) if (!it.pending) rows.push({ kind: "p", vrn: it.vrn, dk: it.dk, f: it.entry.from, t: it.entry.to, it, st: "plan" });
      const flt = S.listFilter, byDate = (a, b) => a.dk.localeCompare(b.dk) || a.f - b.f || (a.kind === "b" ? -1 : 1);
      const shown = rows.filter((r) => (!flt.length || flt.includes(r.vrn)) && (S.settings.listPast || r.st !== "past"))
        .sort(S.settings.listSort === "name" ? (a, b) => byVehicle(vehicle(a.vrn), vehicle(b.vrn)) || byDate(a, b) : byDate);
      const stTxt = { past: ["st-past", "Finished"], live: ["st-live", "In progress"], up: ["st-up", "Upcoming"], plan: ["st-plan", "Planned"] };
      // bulk: planned items and upcoming bookings the site lets you cancel can be selected
      for (const r of rows) { r.key = r.kind === "b" ? "b:" + r.g.items[0].id : "p:" + r.it.entry.id; r.pick = r.kind === "p" || (r.st === "up" && r.g.items.every((i) => i.cancellable)); }
      S.listRows = new Map(shown.map((r) => [r.key, r]));
      for (const k of [...S.listSel]) if (!S.listRows.has(k) || !S.listRows.get(k).pick) S.listSel.delete(k);
      const picks = shown.filter((r) => r.pick), nSel = S.listSel.size, bulk = S.bulk;
      const why = { live: "In progress: use Manage to end it early", past: "Finished", up: "The council site doesn't allow cancelling this booking" };
      const row = (r) => {
        const v = vehicle(r.vrn), [cls, txt] = stTxt[r.st];
        const box = bulk ? `<td class="lc"><input type="checkbox" data-bsel="${esc(r.key)}"${S.listSel.has(r.key) ? " checked" : ""}${r.pick ? "" : ` disabled title="${esc(why[r.st] || "")}"`} aria-label="Select ${esc(vText(v))} on ${fmtDay(fromKey(r.dk))} at ${hm(r.f)}"></td>` : "";
        let vouchers, act;
        if (r.kind === "b") {
          const u = { h1: 0, h5: 0, day: 0 }; r.g.items.forEach((i) => { const k = P.bookingType(i); if (k in u) u[k]++; });
          vouchers = typesText(u);
          act = `<button type="button" class="ghost sm" data-ids="${r.g.items.map((i) => esc(i.id || i.ref)).join(",")}" aria-label="Manage ${esc(vText(v))} on ${fmtDay(fromKey(r.dk))} at ${hm(r.f)}">Manage</button>`;
        } else {
          vouchers = r.it.need ? typesText(r.it.need) : r.it.replaces.length ? "None" : "—";
          act = `<button type="button" class="ghost sm" data-eid="${r.it.entry.id}">Change</button><button type="button" class="ghost sm" data-rment="${r.it.entry.id}">Remove</button>`;
        }
        const status = r.chg ? "Changing (in plan)" : r.kind === "p" && r.it.replaces.length ? "Planned change" : txt;
        return `<tr${bulk && S.listSel.has(r.key) ? ' class="sel"' : ""}>${box}<td>${fmtDay(fromKey(r.dk))}</td><td class="num">${r.st === "plan" && r.it.entry.replaces ? "→ " : ""}${hm(r.f)}–${hm(r.t)}</td><td><span class="lv">${vName(v)} ${plateHTML(v.vrn, true)}</span></td><td class="num">${vouchers}</td><td><span class="status ${cls}">${status}</span></td><td class="la">${act}</td></tr>`;
      };
      const chips = flt.map((vrn) => { const v = vehicle(vrn); return `<span class="vtag">${vName(v)} ${plateHTML(v.vrn, true)}<button type="button" data-lrm="${esc(vrn)}" aria-label="Stop filtering by ${esc(vText(v))}">×</button></span>`; }).join("");
      $("#board").innerHTML = `<div class="lst">
        <div class="lst-bar">
          <div class="lst-filter"><label for="lq">Show only</label><div class="vsel">${chips}</div>
            <div class="combo"><input type="text" id="lq" placeholder="${flt.length ? "Add another name or plate" : "Search a name or plate to add it"}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="llist" aria-autocomplete="list" maxlength="30"><div class="combo-list" id="llist" role="listbox" hidden></div></div></div>
          <div class="ctl"><label for="lsort">Sort by</label><select id="lsort"><option value="date"${S.settings.listSort === "date" ? " selected" : ""}>Date</option><option value="name"${S.settings.listSort === "name" ? " selected" : ""}>Name</option></select></div>
          <label class="toggle"><input type="checkbox" id="lpast"${S.settings.listPast ? " checked" : ""}><span>Show finished</span></label>
          <button type="button" class="ghost sm" id="bulkBtn" aria-pressed="${bulk}">${bulk ? "Done" : "Bulk manage"}</button>
        </div>
        ${bulk ? `<div class="bulkbar" role="region" aria-label="Bulk manage"><b id="bkCount">${nSel} selected</b>
          <button type="button" class="ghost sm" id="bkTime"${nSel ? "" : " disabled"}>Change time</button><button type="button" class="ghost sm" id="bkCancel"${nSel ? "" : " disabled"}>Cancel</button>
          ${nSel ? `<button type="button" class="linkbtn" id="bkNone">Clear selection</button>` : `<span class="note">Tick planned items and upcoming bookings to change or cancel them together.</span>`}</div>${bulkPanelHTML()}` : ""}
        <div style="overflow-x:auto"><table class="lt"><thead><tr>${bulk ? `<th class="lc"><input type="checkbox" id="bkAll" aria-label="Select all that can be selected"${picks.length && picks.every((r) => S.listSel.has(r.key)) ? " checked" : ""}${picks.length ? "" : " disabled"}></th>` : ""}<th>Day</th><th>Time</th><th>Vehicle</th><th>Vouchers</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead>
        <tbody>${shown.map(row).join("") || `<tr><td colspan="${bulk ? 7 : 6}" class="empty">${rows.length ? "Nothing matches the filter." : "No bookings yet."}</td></tr>`}</tbody></table></div>
        <span class="note">${shown.length} of ${rows.length} shown.</span></div>`;
    }
    // ---------- bulk manage (list view) ----------
    const selRows = () => [...S.listSel].map((k) => S.listRows.get(k)).filter(Boolean);
    function bulkPanelHTML() {
      const rows = selRows();
      if (!rows.length || !S.bulkPanel) return "";
      if (S.bulkPanel === "cancel") {
        const b = rows.filter((r) => r.kind === "b"), p = rows.filter((r) => r.kind === "p"), nv = b.reduce((n, r) => n + r.g.items.length, 0);
        const parts = [b.length && `cancel ${b.length} booking${b.length > 1 ? "s" : ""} (${nv} voucher${nv > 1 ? "s" : ""}) on the council site now`, p.length && `remove ${p.length} planned item${p.length > 1 ? "s" : ""} from your plan`].filter(Boolean).join(", and ");
        return `<div class="bulkpanel" id="bkPanel"><span>${parts[0].toUpperCase() + parts.slice(1)}?${b.length ? " Cancelled vouchers go back to your unused vouchers. This can't be undone." : ""}</span>
          <div class="acts"><button type="button" class="danger" id="bkYes">Yes, ${b.length ? "cancel" : "remove"}</button><button type="button" class="ghost" id="bkClose">Keep</button></div></div>`;
      }
      const bt = S.bulkTime;
      if (bt.f == null) { bt.f = rows[0].f; bt.t = rows[0].t; }
      return `<div class="bulkpanel" id="bkPanel">
        <div class="seg" role="radiogroup" aria-label="How to change"><label><input type="radio" name="bkMode" value="set"${bt.mode === "set" ? " checked" : ""}> Set all to one time</label><label><input type="radio" name="bkMode" value="shift"${bt.mode === "shift" ? " checked" : ""}> Move each by</label></div>
        <div class="ted" id="bkSet"${bt.mode === "set" ? "" : " hidden"}><div class="ctl"><label for="bkFrom">From</label><input type="time" id="bkFrom" step="60" value="${hm(bt.f)}"></div><div class="ctl"><label for="bkTo">Until</label><input type="time" id="bkTo" step="60" value="${hm(bt.t)}"></div></div>
        <div class="ctl" id="bkShiftWrap"${bt.mode === "shift" ? "" : " hidden"}><label for="bkShift">Minutes (use a minus for earlier)</label><input type="number" id="bkShift" step="1" value="${bt.shift}"></div>
        <div class="note" id="bkPrev"></div>
        <div class="acts"><button type="button" class="primary" id="bkApply" style="height:34px">Apply</button><button type="button" class="ghost" id="bkClose">Close</button></div></div>`;
    }
    // New times for the selected rows, checked with the same rules as a single change.
    function bulkTimes() {
      const bt = S.bulkTime, ok = [], bad = [];
      for (const r of selRows()) {
        const nf = bt.mode === "set" ? bt.f : r.f + bt.shift, nt = bt.mode === "set" ? bt.t : r.t + bt.shift;
        const res = nf < 0 || nt > 24 * 60 ? { err: "That moves it into another day." } : checkTimes(r.dk, nf, nt);
        if (res.err) bad.push({ r, err: res.err });
        else if (res.f === r.f && res.t === r.t) bad.push({ r, err: "No change." });
        else ok.push({ r, res });
      }
      return { ok, bad };
    }
    function bulkPreview() {
      const prev = $("#bkPrev"), btn = $("#bkApply"); if (!prev) return;
      const bt = S.bulkTime;
      if (bt.mode === "set" && (bt.f == null || bt.t == null)) { prev.textContent = "Enter a start and an end time."; btn.disabled = true; return; }
      if (bt.mode === "shift" && !bt.shift) { prev.textContent = "Enter how many minutes to move by."; btn.disabled = true; return; }
      const { ok, bad } = bulkTimes(), nb = ok.filter((x) => x.r.kind === "b").length;
      const line = (x) => `${fmtDay(fromKey(x.r.dk))} ${hm(x.r.f)} · ${vText(vehicle(x.r.vrn))}: ${x.err}`;
      prev.innerHTML = `${ok.length ? `${ok.length} will change${nb ? ` (${nb} booking${nb > 1 ? "s go" : " goes"} into your plan to be cancelled and rebooked)` : ""}.` : "None of the selected can change to that."}`
        + (bad.length ? `<ul class="bklist">${bad.map((x) => `<li>${esc(line(x))}</li>`).join("")}</ul>` : "");
      btn.disabled = !ok.length; btn.textContent = ok.length ? `Apply to ${ok.length}` : "Apply";
    }
    function bulkApplyTimes() {
      const { ok } = bulkTimes(); if (!ok.length) return;
      let nb = 0;
      for (const { r, res } of ok) {
        if (r.kind === "p") { r.it.entry.from = res.f; r.it.entry.to = res.t; delete r.it.entry.movedFrom; }
        else { planChange(r.vrn, r.dk, r.g.items.map((i) => i.id), res); nb++; }
      }
      S.bulkPanel = null; S.listSel.clear(); S.bulkTime = { ...S.bulkTime, f: null, t: null };
      changedPlan();
      toast(`${ok.length} changed.${nb ? ` ${nb} booking change${nb > 1 ? "s are" : " is"} in your plan: review the plan to apply ${nb > 1 ? "them" : "it"}.` : ""}`);
    }
    async function bulkCancel(btn) {
      const rows = selRows(), b = rows.filter((r) => r.kind === "b"), p = rows.filter((r) => r.kind === "p");
      const pIds = new Set(p.map((r) => r.it.entry.id));
      S.entries = S.entries.filter((e) => !pIds.has(e.id));
      let res = { done: 0, err: null };
      if (b.length) {
        const ids = b.flatMap((r) => [...r.g.items].sort((x, y) => y.start - x.start).map((i) => i.id)); // each booking latest first
        btn.disabled = true; S.busy = true;
        res = await cancelVouchers(ids, (d, n) => { btn.textContent = `Cancelling ${d + 1} of ${n}…`; });
        S.busy = false;
      }
      await savePlan();
      S.bulkPanel = null; S.listSel.clear(); refresh();
      const nv = b.reduce((n, r) => n + r.g.items.length, 0);
      const parts = [b.length && `Cancelled ${res.done} of ${nv} voucher${nv > 1 ? "s" : ""}`, p.length && `removed ${p.length} planned item${p.length > 1 ? "s" : ""}`].filter(Boolean).join(", ");
      toast(res.err ? `${parts}. Then: ${res.err.message}` : `${parts[0].toUpperCase() + parts.slice(1)}.`);
    }

    function listSugg(open) {
      const box = $("#llist"); if (!box) return;
      const inp = $("#lq");
      if (!open) { box.hidden = true; inp.setAttribute("aria-expanded", "false"); return; }
      const q = inp.value, lq = q.trim().toLowerCase(), nq = normal(q);
      const res = S.vehicles.filter((v) => !S.listFilter.includes(v.vrn) && (!lq || vText(v).toLowerCase().includes(lq) || (!!nq && v.vrn.includes(nq)))).sort(byVehicle).slice(0, 40);
      box.innerHTML = res.length ? res.map((v, i) => `<div class="opt" role="option" data-ladd="${esc(v.vrn)}" aria-selected="${i === 0}"><span class="nick">${esc(vText(v))}</span>${plateHTML(v.vrn, true)}</div>`).join("")
        : `<div class="empty" style="padding:8px">No matching vehicle.</div>`;
      box.hidden = false; inp.setAttribute("aria-expanded", "true");
    }

    // ---------- composer ----------
    const normal = W.normVrn;
    function matches(q) {
      const nq = normal(q), lq = q.trim().toLowerCase();
      return S.vehicles.filter((v) => v.fav).map((v) => { let sc = -1; if (!lq) sc = 0; else if (v.nick.toLowerCase().includes(lq)) sc = 2; else if (nq && v.vrn.includes(nq)) sc = 1; return { v, sc }; })
        .filter((x) => x.sc >= 0).sort((a, b) => b.sc - a.sc || a.v.nick.localeCompare(b.v.nick));
    }
    function hl(t, q) { if (!q) return esc(t); const i = t.toLowerCase().indexOf(q.toLowerCase()); if (i < 0) return esc(t); return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length)); }
    function plateHL(vrn, nq) {
      const i = vrn.indexOf(nq); if (!nq || i < 0) return plateHTML(vrn, true);
      const disp = vrn.slice(0, 4) + " " + vrn.slice(4), map = (k) => (k < 4 ? k : k + 1), a = map(i), b = map(i + nq.length - 1) + 1;
      return `<span class="plate sm"><i></i><span>${esc(disp.slice(0, a))}<mark>${esc(disp.slice(a, b))}</mark>${esc(disp.slice(b))}</span></span>`;
    }
    function renderCombo(open) {
      const list = $("#vlist"), q = $("#vq").value;
      if (!open) { list.hidden = true; $("#vq").setAttribute("aria-expanded", "false"); return; }
      const res = matches(q), nq = normal(q);
      let h = res.map((x) => { const picked = S.sel.vrns.includes(x.v.vrn); return `<div class="opt${picked ? " picked" : ""}" role="option" data-vrn="${esc(x.v.vrn)}"><span class="nick">${hl(x.v.nick, q.trim())}</span>${plateHL(x.v.vrn, x.sc === 1 ? nq : "")}${picked ? "<small>added</small>" : ""}</div>`; }).join("");
      if (nq.length >= 2 && nq.length <= 10 && !S.vehicles.some((v) => v.fav && v.vrn === nq)) h += `<div class="opt" role="option" data-new="${esc(nq)}"><span class="nick">New vehicle</span>${plateHTML(nq, true)}</div>`;
      list.innerHTML = h || `<div class="empty" style="padding:8px">No match. Type a plate to add a new vehicle.</div>`;
      const opts = list.querySelectorAll(".opt"); comboIdx = Math.min(comboIdx, Math.max(0, opts.length - 1));
      opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === comboIdx)));
      list.hidden = false; $("#vq").setAttribute("aria-expanded", "true");
    }
    function renderNewV() {
      const box = $("#newv"), n = S.newv;
      if (!n) { box.innerHTML = ""; return; }
      const clash = n.save && n.nick.trim() && S.vehicles.some((v) => (v.fav || v.pendingFav) && v.nick.toLowerCase() === n.nick.trim().toLowerCase());
      const ok = normal(n.vrn).length >= 2 && (!n.save || (n.nick.trim() && !clash)) && !n.checking;
      const err = clash ? `You already have a favourite called "${esc(n.nick.trim())}". Choose another nickname.` : n.error ? esc(n.error) : n.save && n.touched && !n.nick.trim() ? "Enter a nickname to save this vehicle as a favourite." : "";
      box.innerHTML = `<div class="newv" role="group" aria-label="New vehicle">
        <div class="nv-top"><b>New vehicle</b>${plateHTML(normal(n.vrn) || "—", true)}</div>
        <div class="ctl"><label for="nvPlate">Number plate</label><input type="text" id="nvPlate" maxlength="10" value="${esc(n.vrn)}" autocomplete="off"></div>
        <label class="toggle"><input type="checkbox" id="nvSave"${n.save ? " checked" : ""}><span>Save vehicle as favourite<small>Saved to your council account with the first booking.</small></span></label>
        ${n.save ? `<div class="ctl"><label for="nvNick">Nickname (required)</label><input type="text" id="nvNick" value="${esc(n.nick)}" autocomplete="off"></div>` : ""}
        ${err ? `<span class="err">${err}</span>` : ""}
        <div class="acts"><button type="button" class="primary" id="nvAdd" style="height:34px"${ok ? "" : " disabled"}>${n.checking ? "Checking…" : "Add vehicle"}</button><button type="button" class="ghost" id="nvCancel">Cancel</button></div></div>`;
    }
    function renderVsel() { $("#vsel").innerHTML = S.sel.vrns.length ? S.sel.vrns.map((vrn) => { const v = vehicle(vrn); return `<span class="vtag">${vName(v)} ${plateHTML(v.vrn, true)}<button type="button" data-rmv="${esc(vrn)}" aria-label="Remove ${esc(vText(v))}">×</button></span>`; }).join("") : `<span class="empty">No vehicle chosen.</span>`; }
    const rangeCtl = (a, b) => { const out = []; for (let d = new Date(a); key(d) <= key(b); d = addDays(d, 1)) if (inWindow(d) && (ctlList(d).length || !controls(d))) out.push(key(d)); return out; };
    function renderMini() {
      const start = weekStart(S.today), end = addDays(S.today, P.WINDOW_DAYS), n = Math.ceil(((end - start) / 864e5 + 1) / 7) * 7;
      let h = DOW.map((x) => `<span class="h">${x[0]}</span>`).join("");
      for (let i = 0; i < n; i++) {
        const d = addDays(start, i), dk = key(d), inW = inWindow(d), sel = S.sel.days.includes(dk), off = controls(d) && !ctlList(d).length;
        h += `<button type="button" class="${off ? "off" : ""}${sel ? " sel" : ""}${dk === TK() ? " today" : ""}" ${inW ? `data-pick="${dk}"` : "disabled"} aria-pressed="${sel}" title="${fmtDay(d)} · ${esc(ctlText(d))}">${d.getDate()}</button>`;
      }
      $("#mini").innerHTML = h;
      const ws = weekStart(S.today);
      const qd = [["Today", () => [TK()]], ["Tomorrow", () => [key(addDays(S.today, 1))]], ["Rest of this week", () => rangeCtl(S.today, addDays(ws, 6))], ["Next week", () => rangeCtl(addDays(ws, 7), addDays(ws, 13))]];
      const first = S.sel.days.length ? fromKey([...S.sel.days].sort()[0]) : null;
      if (first) qd.push([`Every ${DOW[dow(first) - 1]} for 4 weeks`, () => [0, 7, 14, 21].map((o) => addDays(first, o)).filter(inWindow).map(key)]);
      $("#dquick").innerHTML = qd.map((q, i) => `<button type="button" class="qbtn" data-qd="${i}">${esc(q[0])}</button>`).join("");
      $("#dquick")._qd = qd;
    }
    function wholePeriod() {
      if (!S.zone) { S.sel.from = S.sel.from == null ? S.now : S.sel.from; S.sel.to = Math.min(P.LAST_MIN, S.sel.from + 120); return; }
      let f = 1440, t = 0; for (const r of S.zone.rules) { f = Math.min(f, r.f); t = Math.max(t, r.t); }
      S.sel.from = f; S.sel.to = t;
    }
    function dur(m) { if (S.sel.from == null) S.sel.from = S.now; S.sel.to = Math.min(P.LAST_MIN, S.sel.from + m); }
    function renderTime() {
      const tq = [["1 hour", () => dur(60)], ["2 hours", () => dur(120)]];
      if (!shortZone()) tq.push(["5 hours", () => dur(300)]);
      if (S.zone) tq.push(["Whole controlled period", wholePeriod]);
      $("#tquick").innerHTML = tq.map((q, i) => `<button type="button" class="qbtn" data-tq="${i}">${esc(q[0])}</button>`).join("");
      $("#tquick")._tq = tq;
      const f = $("#tFrom"), t = $("#tTo");
      if (shadow.activeElement !== f) f.value = S.sel.from == null ? "" : hm(S.sel.from);
      if (shadow.activeElement !== t) t.value = S.sel.to == null ? "" : hm(S.sel.to);
      $("#adj").hidden = !S.adj; $("#adj").textContent = S.adj;
      $("#strat").value = S.strat;
    }
    function itemHTML(it) {
      const v = vehicle(it.vrn), e = it.entry;
      const vs = it.acts.map((a) => `<span class="v ${a.type}">${VT[a.type].short}${a.type === "day" ? "" : " " + hm(a.start)}</span>`).join("");
      const fav = v.pendingFav ? `<span class="favnote">Saves "${esc(v.nick)}" as a favourite</span>` : "";
      return `<div class="pl${it.pending ? " pending" : ""}">${it.pending ? "" : `<button type="button" class="x" data-rment="${e.id}" aria-label="Remove ${esc(vText(v))} on ${fmtDay(fromKey(it.dk))} from the plan">×</button>`}
        <div class="pl-top"><b>${fmtDay(fromKey(it.dk))}</b><span style="display:flex;gap:6px;align-items:center">${vName(v)} ${plateHTML(v.vrn, true)}</span></div>
        ${!it.pending && S.editing === e.id
          ? `${timeEdHTML(e.from, e.to)}<div class="acts"><button type="button" class="primary" id="edSave" style="height:32px">Save time</button><button type="button" class="ghost" id="edCancel" style="height:32px">Cancel</button></div>`
          : `<span class="req num">${e.replaces ? "Change to" : "Asked for"} ${hm(e.from)}–${hm(e.to)}${it.pending ? "" : ` <button type="button" class="linkbtn" data-edit="${e.id}">Change time</button>`}</span>`}
        ${vs ? `<div class="vs">${vs}</div>` : ""}${!it.pending && it.acts.length ? `<label class="toggle sm"><input type="checkbox" data-email="${e.id}"${e.email ? " checked" : ""}><span>Email confirmation</span></label>` : ""}${fav}${it.notes.map((n) => `<span class="note ${n.c}">${esc(n.t)}</span>`).join("")}</div>`;
    }
    function renderPending() {
      const items = (S.plan ? S.plan.items : []).filter((i) => i.pending), n = items.reduce((a, i) => a + i.acts.length, 0);
      const box = $("#pending"), btn = $("#addPlan");
      if (!S.sel.vrns.length || !S.sel.days.length) box.innerHTML = `<div class="empty">Choose a vehicle and at least one day. You can also tap or drag on the Day view.</div>`;
      else if (!items.length) box.innerHTML = `<div class="empty">${S.sel.from != null && S.sel.to > S.sel.from ? "These bookings are already in your plan." : "Choose a time."}</div>`;
      else box.innerHTML = items.map(itemHTML).join("");
      btn.disabled = !items.length;
      btn.textContent = items.length ? `Add ${items.length} booking${items.length > 1 ? "s" : ""} to plan${n ? ` (${n} voucher${n > 1 ? "s" : ""})` : ""}` : "Add to plan";
    }
    function renderPlan() {
      const p = S.plan, items = p.items.filter((i) => !i.pending);
      $("#plan").innerHTML = items.length ? items.map(itemHTML).join("") : `<div class="empty">Your plan is empty. Add bookings above.</div>`;
      $("#clearPlan").hidden = !items.length;
      const withActs = items.filter((i) => i.acts.length), mail = withActs.filter((i) => i.entry.email).length, ea = $("#emailAll");
      $("#emailAllWrap").hidden = !withActs.length;
      ea.checked = !!withActs.length && mail === withActs.length; ea.indeterminate = mail > 0 && mail < withActs.length;
      $("#planSub").textContent = items.length ? `${items.length} booking${items.length > 1 ? "s" : ""} planned. Nothing is sent until you review and book.` : "Nothing planned yet. You review everything before it's sent.";
      const u = p.used, b = S.balance, tot = b.h1 + b.h5 + b.day;
      const parts = KINDS.filter((k) => u[k]).map((k) => `${u[k]} × ${VT[k].label}`);
      const leftTxt = KINDS.filter((k) => b[k] || k === "h1").map((k) => `${b[k] - u[k]} × ${VT[k].short}`).join(" · ");
      const col = { h1: "var(--accent)", h5: "var(--accent-dark)", day: "var(--ok)" };
      const reqs = p.count ? p.count * W.STEPS.length + 2 : 0;
      $("#summary").innerHTML = `<div class="sumline"><span><b class="num">${p.count}</b> voucher${p.count === 1 ? "" : "s"} to activate</span><span class="note num">${parts.join(" + ") || "—"}</span></div>
        <div class="meter" aria-hidden="true">${KINDS.map((k) => (u[k] ? `<i style="width:${(u[k] / Math.max(tot, 1)) * 100}%;background:${col[k]}"></i>` : "")).join("")}</div>
        <div class="note num">${p.short ? `<span class="note bad">Not enough vouchers for every booking in the plan.</span>` : `Leaves ${leftTxt}`}</div>
        ${costHTML()}${adviceHTML()}
        <button class="primary" id="review" ${p.ready ? "" : "disabled"}>Review ${p.count || ""} activation${p.count === 1 ? "" : "s"}</button>
        ${reqs ? `<span class="note num">About ${reqs} requests to the council site, roughly ${fmtDur(reqs * SECS_PER_REQ)}.</span>` : ""}`;
    }
    function costHTML() {
      const p = S.plan, planned = p.items.filter((it) => it.need && !it.pending);
      if (!p.count && !p.short) return "";
      if (!S.prices) return `<div class="note">Prices couldn't be read from the council site, so costs aren't shown.</div>`;
      const lines = KINDS.filter((k) => p.used[k]).map((k) => `<tr><td>${p.used[k]} × ${VT[k].label}</td><td>${gbp(S.prices[k] && S.prices[k].price)}</td><td>${gbp(valueOf({ [k]: p.used[k] }, S.prices))}</td></tr>`).join("");
      const days = planned.map((it) => `<tr><td>${fmtDay(fromKey(it.dk))} · ${esc(vText(vehicle(it.vrn)))}</td><td>${fmtMins(it.bill)}</td><td>${gbp(valueOf(it.need, S.prices))}</td></tr>`).join("");
      return `<details class="cost" id="costBox"${S.settings.costOpen ? " open" : ""}><summary><span>Voucher value used</span><b class="num">${gbp(p.cost)}</b></summary>
        <div class="cost-body"><table class="ct num"><thead><tr><th>By voucher</th><th>Each</th><th>Total</th></tr></thead><tbody>${lines || `<tr><td colspan="3">None</td></tr>`}</tbody></table>
        <table class="ct num"><thead><tr><th>By booking</th><th>Needed</th><th>Value</th></tr></thead><tbody>${days}</tbody></table>
        <span class="note">Prices are from the council site's buy page. Vouchers you hold are already paid for and can't be refunded.</span></div></details>`;
    }
    function adviceHTML() {
      const a = S.adv; if (!a) return "";
      const kinds = KINDS.filter((k) => a.buy[k]);
      const what = kinds.map((k) => { const n = a.buy[k], bk = S.prices[k].book; return bk > 1 ? `${n / bk} book${n / bk > 1 ? "s" : ""} of ${bk} × ${VT[k].label} (${gbp(n * S.prices[k].price)})` : `${n} × ${VT[k].label} (${gbp(n * S.prices[k].price)})`; }).join(" and ");
      const planned = P.allocate(ctx(), S.entries, S.balance, S.strat);
      const kept = KINDS.filter((k) => planned.used[k] > a.ideal.used[k]).map((k) => `${planned.used[k] - a.ideal.used[k]} × ${VT[k].label}`).join(" and ");
      const btns = kinds.map((k) => `<button type="button" class="ghost sm" data-buy="${k}" data-n="${a.buy[k]}">Buy ${a.buy[k]} × ${VT[k].label} on council site</button>`).join("");
      if (a.saving === null) return `<div class="advice bad"><b>Buy ${what}</b><span>Then the plan uses ${gbp(a.idealCost)} of vouchers, the cheapest mix for these times. Your plan is kept while you pay.</span>${btns}</div>`;
      return `<div class="advice"><b>Save ${gbp(a.saving)} by buying ${what}</b><span>This mix suits these times better. With it the plan uses ${gbp(a.idealCost)} of vouchers instead of ${gbp(planned.cost)}${kept ? `, and your ${kept} stay free for other visits` : ""}. Your plan is kept while you pay.</span>${btns}</div>`;
    }
    function renderMbar() {
      const p = S.plan, bar = $("#mbar");
      bar.hidden = !p.count && !p.short;
      $("#mbTitle").textContent = `${p.count} voucher${p.count === 1 ? "" : "s"} planned${p.cost != null ? " · " + gbp(p.cost) : ""}`;
      $("#mbSub").textContent = p.short ? "Not enough vouchers. See plan." : "Tap to see your plan";
      $("#mbReview").disabled = !p.ready;
    }
    function refresh() {
      if (S.loading || !$("#board")) return;
      buildPlan(); renderHeader(); renderBoard(); renderVsel(); renderNewV(); renderMini(); renderTime(); renderPending(); renderPlan(); renderMbar();
    }
    function commit() { enforceNotPast(); refresh(); }
    function changedPlan() { savePlan(); refresh(); }
    function addToPlan() {
      const c = P.candidates(ctx(), S.sel, S.entries); if (!c.length) return;
      for (const x of c) { delete x.pending; delete x.shifted; x.id = entrySeq++; if (S.settings.emailAll) x.email = true; S.entries.push(x); }
      S.sel.days = []; S.adj = ""; changedPlan();
      toast(`Added ${c.length} booking${c.length > 1 ? "s" : ""} to the plan.`);
    }

    // ---------- toast ----------
    let toastT;
    function toast(msg, undo) {
      $$(".toast").forEach((x) => x.remove());
      const t = el("div", "toast"); t.setAttribute("role", "status"); t.appendChild(el("span", null, esc(msg)));
      if (undo) { const b = el("button", null, "Undo"); b.type = "button"; b.onclick = () => { t.remove(); undo(); }; t.appendChild(b); }
      wrap.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), undo ? 5000 : 3000);
    }

    // ---------- interactions ----------
    shadow.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-view],[data-pick],[data-goto],[data-rmv],[data-rment],[data-qd],[data-tq],[data-buy],[data-vpop],[data-eid],[data-ids],[data-edit],[data-ladd],[data-lrm],.opt,.blk:not(.draft),button[id]");
      if (!t) { if (!e.target.closest(".pop")) closePop(); if (!e.target.closest(".combo")) $("#vlist") && renderCombo(false); if (!e.target.closest(".lst-filter")) listSugg(false); return; }
      if (t.dataset.view) { S.view = t.dataset.view; closePop(); renderBoard(); return; }
      if (t.dataset.pick) { const k = t.dataset.pick, i = S.sel.days.indexOf(k); i < 0 ? S.sel.days.push(k) : S.sel.days.splice(i, 1); if (S.sel.from == null) defaultTime(); commit(); return; }
      if (t.dataset.goto) { S.cursor = fromKey(t.dataset.goto); S.view = "day"; renderBoard(); return; }
      if (t.dataset.rmv) { S.sel.vrns = S.sel.vrns.filter((v) => v !== t.dataset.rmv); commit(); return; }
      if (t.dataset.rment) {
        const gone = S.entries.find((x) => String(x.id) === t.dataset.rment);
        S.entries = S.entries.filter((x) => x !== gone); changedPlan();
        toast("Removed from the plan.", () => { S.entries.push(gone); changedPlan(); });
        return;
      }
      if (t.dataset.qd != null) { for (const k of $("#dquick")._qd[+t.dataset.qd][1]()) if (!S.sel.days.includes(k)) S.sel.days.push(k); if (S.sel.from == null) defaultTime(); commit(); return; }
      if (t.dataset.tq != null) { $("#tquick")._tq[+t.dataset.tq][1](); commit(); return; }
      if (t.dataset.buy) { buy(t.dataset.buy, +t.dataset.n, t); return; }
      if (t.dataset.vpop) { openVehiclePop(t); return; }
      if (t.dataset.ladd) { if (!S.listFilter.includes(t.dataset.ladd)) S.listFilter.push(t.dataset.ladd); renderBoard(); $("#lq").focus(); return; }
      if (t.dataset.lrm) { S.listFilter = S.listFilter.filter((v) => v !== t.dataset.lrm); renderBoard(); return; }
      if (t.dataset.eid) { openEntryPop(t); return; }
      if (t.dataset.ids) { openPop(t); return; }
      if (t.dataset.edit) { closePop(); S.editing = +t.dataset.edit; renderPlan(); const f = $("#edFrom"); if (f) f.focus(); return; }
      if (t.classList.contains("opt")) { pickOpt(t); return; }
      switch (t.id) {
        case "close": api.close(); return;
        case "termsBtn": case "termsLink": showTerms(); return;
        case "settingsBtn": showSettings(); return;
        case "tAccept": await store.set("vb:terms", { version: T.VERSION, at: new Date().toISOString() }); await load({ keepPermits: false }); return;
        case "tDecline": api.close(); toast("Voucherboard can't be used without accepting its terms."); return;
        case "reload": case "retry": await load({ keepPermits: false }); return;
        case "review": case "mbReview": openReview(); return;
        case "mbGo": $("#plan").scrollIntoView({ behavior: "smooth", block: "start" }); return;
        case "prev": case "next": S.cursor = addDays(S.cursor, (t.id === "prev" ? -1 : 1) * (S.view === "week" ? 7 : 1)); renderBoard(); return;
        case "todayBtn": S.cursor = new Date(S.today); renderBoard(); return;
        case "clearV": S.sel.vrns = []; commit(); return;
        case "clearD": S.sel.days = []; commit(); return;
        case "clearPlan": { const old = S.entries; S.entries = []; changedPlan(); toast("Plan cleared.", () => { S.entries = old; changedPlan(); }); return; }
        case "addPlan": addToPlan(); return;
        case "grpFavs": S.settings.favsOpen = !S.settings.favsOpen; saveSettings(); renderBoard(); return;
        case "grpPast": S.settings.pastOpen = !S.settings.pastOpen; saveSettings(); renderBoard(); return;
        case "nowBtn": { const d = S.sel.from != null && S.sel.to > S.sel.from ? S.sel.to - S.sel.from : 60; S.sel.days = [TK()]; S.sel.from = S.now; S.sel.to = Math.min(P.LAST_MIN, S.now + d); commit(); toast(`Starts now, ${hm(S.now)}.`); return; }
        case "nvCancel": S.newv = null; renderNewV(); $("#vq").focus(); return;
        case "nvAdd": await addNewVehicle(); return;
        case "edCancel": S.editing = null; renderPlan(); return;
        case "bulkBtn": S.bulk = !S.bulk; S.listSel.clear(); S.bulkPanel = null; renderBoard(); return;
        case "bkNone": S.listSel.clear(); S.bulkPanel = null; renderBoard(); return;
        case "bkTime": S.bulkPanel = "time"; S.bulkTime = { ...S.bulkTime, f: null, t: null }; renderBoard(); bulkPreview(); return;
        case "bkCancel": S.bulkPanel = "cancel"; renderBoard(); return;
        case "bkClose": S.bulkPanel = null; renderBoard(); return;
        case "bkApply": bulkApplyTimes(); return;
        case "bkYes": await bulkCancel(t); return;
        case "edSave": {
          const en = S.entries.find((x) => x.id === S.editing), r = en && readTimeEd($("#plan"), en.dk);
          if (r) { S.editing = null; setEntryTime(en, r); }
          return;
        }
      }
    });
    shadow.addEventListener("input", (e) => {
      if (!S.newv) return;
      const id = e.target.id;
      if (id === "nvPlate" || id === "nvNick") {
        if (id === "nvPlate") S.newv.vrn = e.target.value.toUpperCase(); else { S.newv.nick = e.target.value; S.newv.touched = true; }
        S.newv.error = "";
        const pos = e.target.selectionStart; renderNewV(); const i = $("#" + id); i.focus(); i.setSelectionRange(pos, pos);
      }
    });
    shadow.addEventListener("change", (e) => {
      const id = e.target.id;
      if (id === "tAgree") { $("#tAccept").disabled = !e.target.checked; return; }
      if (e.target.dataset && e.target.dataset.bsel) { const k = e.target.dataset.bsel; e.target.checked ? S.listSel.add(k) : S.listSel.delete(k); if (!S.listSel.size) S.bulkPanel = null; renderBoard(); if (S.bulkPanel === "time") bulkPreview(); return; }
      if (id === "bkAll") { for (const r of S.listRows.values()) if (r.pick) e.target.checked ? S.listSel.add(r.key) : S.listSel.delete(r.key); if (!S.listSel.size) S.bulkPanel = null; renderBoard(); if (S.bulkPanel === "time") bulkPreview(); return; }
      if (bulkField(e.target)) return;
      if (id === "nvSave" && S.newv) { S.newv.save = e.target.checked; renderNewV(); if (S.newv.save) $("#nvNick").focus(); }
      else if (id === "permitSel" && e.target.value !== S.permitId) { S.permitId = e.target.value; store.set("vb:permit", S.permitId); S.sel.vrns = []; load({ keepPermits: true }); }
      // Time fields fire "change" as each part (hours, minutes) is completed, so only take the value here.
      // Fixing the other field and the not-in-the-past rule waits until the field is left (focusout below).
      else if (id === "tFrom" || id === "tTo") { const m = parseHM(e.target.value); if (m == null) return; timeEdit = timeEdit || { from: S.sel.from, to: S.sel.to }; S.sel[id === "tFrom" ? "from" : "to"] = m; refresh(); }
      else if (id === "strat") { S.strat = e.target.value; refresh(); }
      else if (id === "sTest") { S.settings.testMode = e.target.checked; saveSettings(); $("#testTag").hidden = !e.target.checked; refresh(); toast(e.target.checked ? "Test mode on. Nothing will be booked." : "Live booking on. Bookings use your vouchers."); }
      else if (id === "sBeta") { S.settings.betaLive = e.target.checked; saveSettings(); closePop(); toast(e.target.checked ? "Beta on: bookings in progress can be ended early." : "Beta off."); }
      else if (id === "emailAll") { S.settings.emailAll = e.target.checked; saveSettings(); for (const en of S.entries) en.email = e.target.checked; changedPlan(); }
      else if (e.target.dataset && e.target.dataset.email) { const en = S.entries.find((x) => String(x.id) === e.target.dataset.email); if (en) { en.email = e.target.checked; if (!en.email && S.settings.emailAll) { S.settings.emailAll = false; saveSettings(); } changedPlan(); } }
      else if (id === "lsort") { S.settings.listSort = e.target.value; saveSettings(); renderBoard(); }
      else if (id === "lpast") { S.settings.listPast = e.target.checked; saveSettings(); renderBoard(); }
    });
    shadow.addEventListener("toggle", (e) => { if (e.target.id === "costBox") { S.settings.costOpen = e.target.open; saveSettings(); } }, true);
    shadow.addEventListener("focusin", (e) => { if (e.target.id === "vq") renderCombo(true); if (e.target.id === "lq") listSugg(true); });
    shadow.addEventListener("focusout", (e) => { if (e.target.id === "tFrom" || e.target.id === "tTo") finishTimeEdit(e.target.id); });
    // After editing From or Until: keep the length when From moves past Until, and start an hour before a new Until.
    function finishTimeEdit(id) {
      const was = timeEdit; timeEdit = null;
      if (!was) return;
      const f = S.sel.from, t = S.sel.to;
      if (id === "tFrom" && f != null && (t == null || t <= f)) { const d = was.to != null && was.from != null ? was.to - was.from : 60; S.sel.to = Math.min(P.LAST_MIN, f + Math.max(d, 15)); }
      if (id === "tTo" && t != null && (f == null || t <= f)) S.sel.from = Math.max(0, t - 60);
      commit();
    }
    shadow.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closePop(); if ($("#vlist")) renderCombo(false); closeModal(); }
      const c = e.target.closest && e.target.closest("[data-goto]");
      if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); }
      if (e.key === "Enter" && (e.target.id === "nvNick" || e.target.id === "nvPlate")) { e.preventDefault(); const b = $("#nvAdd"); if (b && !b.disabled) b.click(); }
      if (e.key === "Enter" && e.target.id === "fvNick") { e.preventDefault(); const b = $("#fvSave"); if (b && !b.disabled) b.click(); }
      if (e.key === "Enter" && (e.target.id === "edFrom" || e.target.id === "edTo")) { e.preventDefault(); const b = $("#edSave") || $("#enSave") || $("#edOk"); if (b) b.click(); }
      if (e.target.id === "lq") {
        if (e.key === "Enter") { e.preventDefault(); const o = $("#llist .opt"); if (o) o.click(); }
        else if (e.key === "Backspace" && !e.target.value && S.listFilter.length) { S.listFilter.pop(); renderBoard(); $("#lq").focus(); }
      }
      if (e.target.id === "vq") {
        const opts = $$("#vlist .opt");
        if (e.key === "ArrowDown") { e.preventDefault(); comboIdx = Math.min(opts.length - 1, comboIdx + 1); renderCombo(true); }
        else if (e.key === "ArrowUp") { e.preventDefault(); comboIdx = Math.max(0, comboIdx - 1); renderCombo(true); }
        else if (e.key === "Enter") { e.preventDefault(); const o = opts[comboIdx]; if (o) pickOpt(o); }
        else if (e.key === "Backspace" && !e.target.value && S.sel.vrns.length) { S.sel.vrns.pop(); commit(); }
      }
    });
    shadow.addEventListener("input", (e) => { if (e.target.id === "vq") { comboIdx = 0; renderCombo(true); } if (e.target.id === "lq") listSugg(true); bulkField(e.target); });
    // Bulk time fields update the preview in place, so typing isn't interrupted by a re-render.
    function bulkField(t) {
      const bt = S.bulkTime;
      if (t.name === "bkMode") { bt.mode = t.value; $("#bkSet").hidden = bt.mode !== "set"; $("#bkShiftWrap").hidden = bt.mode !== "shift"; }
      else if (t.id === "bkFrom") bt.f = parseHM(t.value);
      else if (t.id === "bkTo") bt.t = parseHM(t.value);
      else if (t.id === "bkShift") bt.shift = Math.round(+t.value || 0);
      else return false;
      bulkPreview(); return true;
    }

    function pickOpt(o) {
      $("#vq").value = ""; comboIdx = 0; renderCombo(false);
      if (o.dataset.new) { S.newv = { vrn: o.dataset.new, save: false, nick: "", touched: false }; renderNewV(); $("#nvAdd").focus(); return; }
      if (!S.sel.vrns.includes(o.dataset.vrn)) S.sel.vrns.push(o.dataset.vrn);
      defaultSel();
      commit(); $("#vq").focus();
    }
    async function addNewVehicle() {
      const n = S.newv, vrn = normal(n.vrn);
      if (n.save) {
        n.checking = true; renderNewV();
        try { const r = await W.checkNickname(n.nick.trim()); n.checking = false; if (!r.ok) { n.error = r.message || "The council site won't accept that nickname."; renderNewV(); return; } }
        catch (e) { n.checking = false; n.error = e.message; renderNewV(); return; }
      }
      const existing = S.vehicles.find((v) => v.vrn === vrn);
      if (existing && !existing.fav) { existing.pendingFav = n.save; if (n.save) existing.nick = n.nick.trim(); }
      else if (!existing) S.vehicles.push({ vrn, fav: false, pendingFav: n.save, nick: n.save ? n.nick.trim() : vrn });
      if (!S.sel.vrns.includes(vrn)) S.sel.vrns.push(vrn);
      S.newv = null; defaultSel();
      commit(); toast(n.save ? `Added "${n.nick.trim()}".` : `Added ${vrn} for this plan only.`);
    }
    async function buy(kind, n, btn) {
      const pr = S.prices && S.prices[kind]; if (!pr) return;
      const count = Math.max(1, Math.round(n / (pr.book || 1)));
      btn.disabled = true; btn.textContent = "Checking…";
      try {
        await W.buyUrl(S.permitId, pr.periodPriceId, count); // checks the council allows that many
        await savePlan();
        // Hand over to the council's own Buy Again dialog on its permits page, which leads to its payment page with the Pay button.
        // content.js opens the dialog and fills it in there; you press Buy and pay yourself.
        const bk = pr.book || 1;
        await store.set("vb:buy", { permitId: S.permitId, periodPriceId: pr.periodPriceId, count, label: bk > 1 ? `${count} book${count > 1 ? "s" : ""} of ${bk} × ${VT[kind].label}` : `${count} × ${VT[kind].label}`, at: Date.now() });
        if (/^\/Home\/ApplicantPermits/i.test(location.pathname) && typeof root.VB.buyHandoff === "function") { S.busy = false; api.close(); root.VB.buyHandoff(); }
        else location.assign("/Home/ApplicantPermits");
      } catch (e) { btn.disabled = false; btn.textContent = "Try again"; toast(e.message); }
    }

    // drag or tap to add (day view), 15-minute snap, never before now
    shadow.addEventListener("pointerdown", (e) => {
      const lane = e.target.closest(".lane.draggable"); if (!lane || e.target.closest(".blk")) return;
      const r = lane.getBoundingClientRect(), win = viewWindow(), isToday = lane.dataset.dk === TK();
      const at = (x) => { const m = Math.round((win.f + (Math.min(Math.max(x - r.left, 0), r.width) / r.width) * (win.t - win.f)) / 15) * 15; return isToday ? Math.max(m, S.now) : m; };
      const ghost = el("div", "blk dragging"); lane.appendChild(ghost);
      drag = { lane, at, start: at(e.clientX), end: at(e.clientX), ghost, win };
      lane.setPointerCapture(e.pointerId);
      drag.update = () => { const a = Math.min(drag.start, drag.end), b = Math.max(drag.start, drag.end), span = win.t - win.f; ghost.style.left = ((a - win.f) / span) * 100 + "%"; ghost.style.width = ((b - a) / span) * 100 + "%"; ghost.textContent = b > a ? hm(a) + "–" + hm(b) : ""; };
      drag.update();
    });
    shadow.addEventListener("pointermove", (e) => { if (drag) { drag.end = drag.at(e.clientX); drag.update(); } });
    shadow.addEventListener("pointerup", () => {
      if (!drag) return;
      const d = drag; drag = null; d.ghost.remove();
      let a = Math.min(d.start, d.end), b = Math.max(d.start, d.end);
      if (b - a < 15) b = a + 60;
      const id = entrySeq++;
      S.entries.push({ id, vrn: d.lane.dataset.vrn, dk: d.lane.dataset.dk, from: a, to: Math.min(P.LAST_MIN, b), ...(S.settings.emailAll ? { email: true } : {}) });
      changedPlan();
      toast(`Added ${hm(a)}–${hm(b)} to the plan.`, () => { S.entries = S.entries.filter((x) => x.id !== id); changedPlan(); });
    });
    shadow.addEventListener("pointercancel", () => { if (drag) { drag.ghost.remove(); drag = null; } });

    // Cancel booked vouchers one by one, stopping at the first failure. A planned change to a cancelled booking is
    // dropped, so it doesn't turn into a new booking. Reloads bookings and vouchers afterwards.
    async function cancelVouchers(ids, onProgress) {
      let done = 0, err = null;
      for (const id of ids) { onProgress && onProgress(done, ids.length); try { await W.cancelBooking(id); done++; } catch (e) { err = e; break; } }
      const gone = new Set(ids.slice(0, done));
      const before = S.entries.length;
      S.entries = S.entries.filter((e) => !(e.replaces || []).some((id) => gone.has(id)));
      if (S.entries.length !== before) await savePlan();
      try { await loadPermitData(); } catch (e) { /* shown on next refresh */ }
      return { done, err, dropped: before - S.entries.length };
    }

    // ---------- booking popover ----------
    function closePop() { if (S.pop) { S.pop.remove(); S.pop = null; } }
    function placePop(p, btn) {
      wrap.appendChild(p); S.pop = p;
      if (isNarrow()) return;
      const r = btn.getBoundingClientRect(), x = Math.min(window.innerWidth - 302, Math.max(12, r.left));
      let y = r.bottom + 8; if (y + p.offsetHeight > window.innerHeight - 12) y = Math.max(12, r.top - p.offsetHeight - 8);
      p.style.left = x + "px"; p.style.top = y + "px";
    }
    function stopInlineEdit() { if (S.editing != null) { S.editing = null; renderPlan(); } }
    function openVehiclePop(btn) {
      closePop(); stopInlineEdit();
      const v = vehicle(btn.dataset.vpop);
      if (!v.fav || !v.favId) { openAddFavPop(btn, v); return; }
      const p = el("div", "pop"); p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Favourite vehicle");
      p.innerHTML = `<h5><span>${esc(v.nick)}</span><span class="status st-up">Favourite</span></h5><div>${plateHTML(v.vrn)}</div>
        <div class="acts" id="popActs"><button class="ghost" id="vDel">Delete favourite</button></div>`;
      placePop(p, btn);
      p.querySelector("#vDel").onclick = () => {
        p.querySelector("#popActs").innerHTML = `<span class="note" style="flex-basis:100%">Delete "${esc(v.nick)}" from your favourites on the council site? Bookings already made aren't affected.</span><button class="danger" id="vYes">Yes, delete</button><button class="ghost" id="vNo">Keep</button>`;
        p.querySelector("#vNo").onclick = closePop;
        p.querySelector("#vYes").onclick = async (ev) => {
          ev.target.disabled = true; ev.target.textContent = "Deleting…";
          let err = null;
          try {
            await W.deleteFavourite(v.favId);
            const favs = await W.loadVehicles();
            if (favs.some((f) => f.favId === v.favId)) throw new W.PortalError("The council site didn't delete it. Try on its Vehicles page.");
            const inUse = S.sel.vrns.includes(v.vrn) || S.entries.some((e) => e.vrn === v.vrn);
            applyFavourites(favs, inUse ? [v.vrn] : []);
          } catch (e) { err = e; }
          closePop(); refresh();
          toast(err ? `Couldn't delete "${v.nick}". ${err.message}` : `Deleted "${v.nick}" from your favourites.`);
        };
      };
    }
    // Save a plate as a favourite on the council site now, rather than with its next booking.
    function openAddFavPop(btn, v) {
      const p = el("div", "pop"); p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Save as favourite");
      p.innerHTML = `<h5><span>${esc(vText(v))}</span><span class="status st-past">${v.pendingFav ? "Saves with next booking" : "Not a favourite"}</span></h5><div>${plateHTML(v.vrn)}</div>
        <div class="ctl"><label for="fvNick">Nickname</label><input type="text" id="fvNick" value="${esc(v.pendingFav ? v.nick : "")}" autocomplete="off"></div>
        <span class="err" id="fvErr" hidden></span>
        <div class="acts"><button class="primary" id="fvSave" style="height:34px">Save as favourite</button><button class="ghost" id="fvNo">Cancel</button></div>`;
      placePop(p, btn);
      const inp = p.querySelector("#fvNick"), err = p.querySelector("#fvErr"), save = p.querySelector("#fvSave");
      const fail = (m) => { err.hidden = false; err.textContent = m; save.disabled = false; save.textContent = "Save as favourite"; };
      inp.focus();
      p.querySelector("#fvNo").onclick = closePop;
      save.onclick = async () => {
        const nick = inp.value.trim();
        if (!nick) return fail("Enter a nickname.");
        if (S.vehicles.some((x) => x !== v && isFavV(x) && x.nick.toLowerCase() === nick.toLowerCase())) return fail(`You already have a favourite called "${nick}".`);
        save.disabled = true; save.textContent = "Saving…"; err.hidden = true;
        try {
          const r = await W.checkNickname(nick);
          if (!r.ok) return fail(r.message || "The council site won't accept that nickname.");
          await W.createFavourite(nick, v.vrn);
          const favs = await W.loadVehicles();
          if (!favs.some((f) => f.vrn === v.vrn)) return fail("The council site didn't save it. Try on its Vehicles page.");
          applyFavourites(favs);
        } catch (e) { return fail(e.message); }
        closePop(); refresh(); toast(`Saved "${nick}" as a favourite.`);
      };
    }
    // A planned block on the board or a planned row in the list: change its time or remove it.
    function openEntryPop(btn) {
      closePop(); stopInlineEdit();
      const e = S.entries.find((x) => String(x.id) === btn.dataset.eid); if (!e) return;
      const v = vehicle(e.vrn);
      const p = el("div", "pop"); p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Planned booking");
      p.innerHTML = `<h5><span>${vName(v)}</span><span class="status st-plan">${e.replaces ? "Planned change" : "Planned"}</span></h5><div>${plateHTML(v.vrn)}</div>
        <span class="note">${fmtDay(fromKey(e.dk))}. Nothing is sent until you review your plan.</span>${timeEdHTML(e.from, e.to)}
        <div class="acts"><button class="primary" id="enSave" style="height:34px">Save time</button><button class="ghost" id="enRm">${e.replaces ? "Drop this change" : "Remove from plan"}</button></div>`;
      placePop(p, btn);
      p.querySelector("#enSave").onclick = () => { const r = readTimeEd(p, e.dk); if (r) { closePop(); setEntryTime(e, r); } };
      p.querySelector("#enRm").onclick = () => {
        closePop(); S.entries = S.entries.filter((x) => x !== e); changedPlan();
        toast(e.replaces ? "Change dropped. The booking stays as it is." : "Removed from the plan.", () => { S.entries.push(e); changedPlan(); });
      };
    }
    // What a changed booking would use, and whether buying other vouchers first would be cheaper.
    function changePreview(vrn, dk, r, ids) {
      const tmp = { id: "chg", vrn, dk, from: r.f, to: r.t, replaces: ids };
      const list = S.entries.filter((e) => !(e.replaces || []).some((id) => ids.includes(id))).concat(tmp);
      const plan = P.allocate(ctx(), list, S.balance, S.strat), it = plan.items.find((x) => x.entry === tmp);
      let h = it.need ? `The new time uses ${typesText(it.need)}.` : it.bill ? "Not enough vouchers for the new time." : "The new time needs no voucher.";
      const adv = P.purchaseAdvice(ctx(), list, plan, S.balance);
      if (adv && adv.saving) h += ` Buying ${typesText(adv.buy)} first would save ${gbp(adv.saving)} on your plan. You can choose that in the plan.`;
      return h;
    }
    function openPop(btn) {
      closePop(); stopInlineEdit();
      const ids = btn.dataset.ids.split(","), items = S.bookings.filter((b) => ids.includes(b.id || b.ref)).sort((a, b) => a.start - b.start);
      if (!items.length) return;
      const v = vehicle(items[0].vrn), d = fromKey(items[0].date);
      const f = items[0].start, t = items[items.length - 1].start + items[items.length - 1].mins, st = bookingStatus(items[0].date, f, t);
      const stTxt = { past: ["st-past", "Finished"], live: ["st-live", "In progress"], up: ["st-up", "Upcoming"] }[st];
      const canCancel = items.every((i) => i.cancellable) && st === "up";
      const shrink = st === "live" ? P.shrinkOptions(items, S.now) : [];
      const p = el("div", "pop"); p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Booking details");
      p.innerHTML = `<h5><span>${vName(v)}</span><span class="status ${stTxt[0]}">${stTxt[1]}</span></h5><div>${plateHTML(v.vrn)}</div>
        <dl><dt>When</dt><dd>${fmtDay(d)}, ${hm(f)}–${hm(t)}</dd><dt>Vouchers</dt><dd>${items.length}</dd><dt>Refs</dt><dd>${items.map((i) => esc(i.ref)).join("<br>")}</dd></dl>
        <div class="acts" id="popActs">${canCancel ? `<button class="ghost" id="pChange">Change time</button><button class="ghost" id="pCancel">Cancel booking</button>` : `<span class="note">${st === "live" ? (shrink.length ? "The voucher running now can't be cancelled." : "Started bookings can't be cancelled.") : st === "past" ? "This booking has finished." : "The council site doesn't allow cancelling this booking."}</span>`}${shrink.length ? (S.settings.betaLive ? `<button class="ghost" id="pShrink">End early</button>` : `<span class="note">To end it early, turn on the beta option in Settings.</span>`) : ""}<button class="ghost" id="pAgain">Book again</button></div>`;
      placePop(p, btn);
      const bIds = items.map((i) => i.id), acts = p.querySelector("#popActs");
      const ch = p.querySelector("#pChange");
      if (ch) ch.onclick = () => {
        acts.innerHTML = `${timeEdHTML(f, t)}<span class="note" id="edPrev">The booking is cancelled and rebooked at the new time when you review your plan.</span><button class="primary" id="edOk" style="height:34px">Add change to plan</button><button class="ghost" id="edBack">Back</button>`;
        const prev = acts.querySelector("#edPrev");
        const upd = () => { const r = readTimeEd(acts, items[0].date); if (r) prev.textContent = changePreview(v.vrn, items[0].date, r, bIds); };
        acts.querySelector("#edFrom").onchange = upd; acts.querySelector("#edTo").onchange = upd;
        acts.querySelector("#edBack").onclick = closePop;
        acts.querySelector("#edOk").onclick = () => {
          const r = readTimeEd(acts, items[0].date); if (!r) return;
          if (r.f === f && r.t === t) { const er = acts.querySelector("#edErr"); er.hidden = false; er.textContent = "That's the booking's current time."; return; }
          planChange(v.vrn, items[0].date, bIds, r);
          closePop(); changedPlan();
          toast(`Change to ${hm(r.f)}–${hm(r.t)} added to your plan${S.adv ? ". See the plan for a cheaper voucher option" : ""}. Review it to apply.`);
        };
      };
      const sh = p.querySelector("#pShrink");
      if (sh) sh.onclick = () => {
        acts.innerHTML = `<div class="ctl" style="flex-basis:100%"><label for="shEnd">End at</label><select id="shEnd">${shrink.map((o, i) => `<option value="${i}">${hm(o.end)} · cancels ${o.cancel.length} voucher${o.cancel.length > 1 ? "s" : ""}</option>`).join("")}</select></div>
          <span class="note">Beta. The voucher running now can't be cancelled, so the booking can only end when a voucher ends. Later vouchers are cancelled and go back to your unused vouchers.</span><button class="danger" id="shYes">End early</button><button class="ghost" id="shNo">Keep</button>`;
        acts.querySelector("#shNo").onclick = closePop;
        acts.querySelector("#shYes").onclick = async (ev) => {
          const o = shrink[+acts.querySelector("#shEnd").value];
          ev.target.disabled = true; ev.target.textContent = "Cancelling…";
          const { done, err } = await cancelVouchers([...o.cancel].reverse()); // latest first, so what's left stays unbroken
          closePop(); refresh();
          toast(err ? `Cancelled ${done} of ${o.cancel.length}. ${err.message}` : `Now ends at ${hm(o.end)}. ${done} voucher${done > 1 ? "s" : ""} returned.`);
        };
      };
      p.querySelector("#pAgain").onclick = () => { if (!S.sel.vrns.includes(v.vrn)) S.sel.vrns.push(v.vrn); S.sel.from = f; S.sel.to = t; S.sel.days = []; closePop(); S.view = "cal"; commit(); toast("Pick the days, then add them to the plan."); };
      const c = p.querySelector("#pCancel");
      if (c) c.onclick = () => {
        p.querySelector("#popActs").innerHTML = `<span class="note" style="flex-basis:100%">Cancel ${items.length} voucher${items.length > 1 ? "s" : ""}? ${items.length > 1 ? "They go" : "It goes"} back to your unused vouchers.</span><button class="danger" id="pYes">Yes, cancel</button><button class="ghost" id="pNo">Keep</button>`;
        p.querySelector("#pNo").onclick = closePop;
        p.querySelector("#pYes").onclick = async (ev) => {
          ev.target.disabled = true; ev.target.textContent = "Cancelling…";
          const { done, err, dropped } = await cancelVouchers(items.map((i) => i.id));
          closePop(); refresh();
          toast(err ? `Cancelled ${done} of ${items.length}. ${err.message}` : `Cancelled. ${done} voucher${done > 1 ? "s" : ""} returned.${dropped ? " Its planned change was removed from your plan." : ""}`);
        };
      };
    }

    // ---------- error report ----------
    // Plain text for pasting into a bug report. Includes plates and permit ids, but no tokens or cookies.
    function errorReport({ failed, test, ops, picked, done, stop, startedAt, available }) {
      const j = (o) => { try { return JSON.stringify(o, null, 2); } catch (e) { return String(o); } };
      let version = "?"; try { version = chrome.runtime.getManifest().version; } catch (e) { /* not in an extension */ }
      const L = [];
      L.push("Voucherboard error report", "========================");
      L.push(`Version: ${version}`, `Run started: ${startedAt}`, `Reported: ${new Date().toISOString()}`, `Mode: ${test ? "test" : "live"}`);
      L.push(`Page: ${location.href}`, `Browser: ${navigator.userAgent}`, `Permit: ${S.permitId}`, "");
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
    async function copyText(t) {
      try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fall back below */ }
      const ta = el("textarea"); ta.value = t; ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      wrap.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e) { /* unsupported */ }
      ta.remove();
      return ok;
    }

    // ---------- review & run ----------
    function closeModal() { if (modal && !modal._busy) { modal.remove(); modal = null; } }
    function openReview() {
      // Operations in order: a changed booking is cancelled just before its replacement is booked.
      const acts = P.activations(S.plan).map((a) => ({ ...a }));
      const byId = new Map(S.bookings.map((b) => [b.id, b])), repl = new Map();
      for (const it of S.plan.items) if (!it.pending && it.replaces.length) repl.set(it.entry.id, it.replaces.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.start - b.start));
      const ops = [], emitted = new Set();
      const emailFor = (a) => { const en = S.entries.find((x) => x.id === a.eid); return !!(en && en.email); };
      const cancelOp = (eid) => { emitted.add(eid); const bs = repl.get(eid); ops.push({ kind: "cancel", eid, bookings: bs, vrn: bs[0].vrn, dk: bs[0].date }); };
      for (const a of acts) { if (repl.has(a.eid) && !emitted.has(a.eid)) cancelOp(a.eid); ops.push({ kind: "book", a }); }
      for (const eid of repl.keys()) if (!emitted.has(eid)) cancelOp(eid);
      if (!ops.length) return;
      const test = S.settings.testMode, nBook = acts.length, nCancel = [...repl.values()].reduce((n, bs) => n + bs.length, 0);
      const total = nBook * W.STEPS.length + (test ? 0 : nCancel * 2 + repl.size) + 2;
      const favFirst = new Set(), seen = new Set();
      ops.forEach((o, i) => { if (o.kind !== "book") return; const v = vehicle(o.a.vrn); if (v.pendingFav && !seen.has(v.vrn)) { seen.add(v.vrn); favFirst.add(i); } });
      const used = { h1: 0, h5: 0, day: 0 }; acts.forEach((a) => used[a.type]++);
      const value = valueOf(used, S.prices);
      const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
      const what = [nBook && `activate ${plural(nBook, "voucher")}`, nCancel && `cancel ${plural(nCancel, "booked voucher")}`].filter(Boolean).join(" and ");
      const goText = test ? "Run test" : [nBook && `Book ${plural(nBook, "voucher")}`, nCancel && `cancel ${nCancel}`].filter(Boolean).join(", ");
      const stat = ops.map((o) => o.kind === "book" && o.a.moved ? { cls: "wait", txt: "Moved to now" } : { cls: "wait", txt: "Waiting" });
      const cell = (i) => `<td class="qs ${stat[i].cls}" id="qs${i}">${esc(stat[i].txt)}${stat[i].err ? `<div class="errline">${esc(stat[i].err)}</div>` : ""}</td>`;
      const rows = () => ops.map((o, i) => {
        if (o.kind === "cancel") {
          const v = vehicle(o.vrn), b0 = o.bookings[0], bl = o.bookings[o.bookings.length - 1];
          return `<tr class="cancel"><td>${fmtDay(fromKey(o.dk))}</td><td>${hm(b0.start)}–${hm(bl.start + bl.mins)}</td><td>Cancel ${o.bookings.length}</td><td>${plateHTML(v.vrn, true)} <span class="note">${esc(vText(v))} · old time</span></td>${cell(i)}</tr>`;
        }
        const a = o.a, v = vehicle(a.vrn);
        return `<tr${a.moved ? ' class="moved"' : ""}><td>${fmtDay(fromKey(a.dk))}</td><td>${a.type === "day" ? "All day" : hm(a.start)}</td><td>${VT[a.type].label}</td><td>${plateHTML(v.vrn, true)} <span class="note">${esc(vText(v))}${favFirst.has(i) ? " · saves as favourite" : ""}${repl.has(a.eid) ? " · new time" : ""}${emailFor(a) ? " · email" : ""}</span></td>${cell(i)}</tr>`;
      }).join("");
      modal = el("div", "scrim");
      modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rvT"><header><h3 id="rvT">${test ? "Test: " : ""}${what[0].toUpperCase() + what.slice(1)}</h3><p>${value != null && nBook ? gbp(value) + " of vouchers. " : ""}Each one is sent separately to the council site, in this order. Check the plates.</p></header>
        <div class="prog"><div class="prog-top"><span id="pgCount">${total} requests to send</span><span id="pgEta">About ${fmtDur(total * SECS_PER_REQ)}</span></div>
          <div class="bar" role="progressbar" aria-label="Requests sent" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0" id="pgBar"><i></i></div>
          <span class="note" id="pgStep">${test ? `Test mode: every booking check runs with the council site, but nothing is booked${nCancel ? " or cancelled" : ""} and no vouchers are used.` : "Nothing is sent until you press the button."}</span></div>
        <div class="body" style="overflow-x:auto"><table class="q"><thead><tr><th>Day</th><th>Start</th><th>Voucher</th><th>Vehicle</th><th>Status</th></tr></thead><tbody id="rvBody">${rows()}</tbody></table></div>
        <footer><span class="foot-note" id="rvNote">If a step fails, the rest stop and nothing is retried. You can stop after the current step.</span><button class="ghost" id="rvCopy" hidden>Copy error details</button><button class="ghost" id="rvBack">Back</button><button class="primary" id="rvGo">${goText}</button></footer></div>`;
      wrap.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
      const q = (s) => modal.querySelector(s);
      const setStat = (i, cls, txt, err) => { stat[i] = { cls, txt, err }; const c = q("#qs" + i); if (c) c.outerHTML = cell(i); };
      const back = q("#rvBack"); back.onclick = closeModal;
      const bar = q("#pgBar"), cnt = q("#pgCount"), eta = q("#pgEta"), stepEl = q("#pgStep");
      let sent = 0, stop = false;
      const bump = (label) => { sent++; bar.firstChild.style.width = (Math.min(sent, total) / total) * 100 + "%"; bar.setAttribute("aria-valuenow", sent); cnt.textContent = `Request ${Math.min(sent, total)} of ${total}`; const left = total - sent; eta.textContent = left > 0 ? `About ${fmtDur(left * SECS_PER_REQ)} left` : "Finished"; stepEl.textContent = label; };
      q("#rvGo").onclick = async function () {
        this.disabled = true; modal._busy = true; S.busy = true;
        back.textContent = "Stop after this step"; back.onclick = () => { stop = true; back.disabled = true; back.textContent = "Stopping…"; };
        let done = 0, cancelled = 0, failed = null, fresh = null;
        const startedAt = new Date().toISOString(), picked = [], booked = [], cancelledE = new Set();
        W.clearTrace();
        const poolOf = (d) => { const pl = { h1: [], h5: [], day: [] }; for (const u of d.unused) if (pl[u.type]) pl[u.type].push(u); return pl; };
        try {
          bump("Reading your current vouchers");
          fresh = await W.loadDetails(S.permitId);
          let pool = poolOf(fresh);
          const lastV = {}; // test mode: checks don't use vouchers up, so one can be checked again
          for (let i = 0; i < ops.length; i++) {
            if (stop) break;
            const o = ops[i], cur = q("#qs" + i);
            if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
            if (o.kind === "cancel") {
              const v = vehicle(o.vrn);
              if (test) { setStat(i, "test", "Would cancel ✓"); continue; }
              setStat(i, "run", "Cancelling…");
              try {
                for (const b of [...o.bookings].reverse()) {
                  bump(`Cancelling ${hm(b.start)} · ${fmtDay(fromKey(o.dk))} · ${vText(v)}`);
                  await W.cancelBooking(b.id); bump(`Cancelled ${hm(b.start)}`); cancelled++;
                }
                bump("Reading your vouchers again");
                fresh = await W.loadDetails(S.permitId); pool = poolOf(fresh);
              } catch (e) { e.index = i; throw e; }
              cancelledE.add(o.eid); setStat(i, "done", "Cancelled ✓");
              continue;
            }
            const a = o.a, v = vehicle(a.vrn);
            // nothing may start before the current minute: move today's remaining starts forward, keeping their order
            const nowM = nowMin();
            if (a.dk === key(todayDate()) && a.start < nowM) {
              const shift = nowM - a.start;
              for (let j = i; j < ops.length; j++) if (ops[j].kind === "book" && ops[j].a.dk === a.dk) { ops[j].a.start += shift; ops[j].a.moved = true; if (stat[j].cls === "wait") stat[j].txt = "Moved to now"; }
              q("#rvBody").innerHTML = rows();
            }
            setStat(i, "run", "Starting");
            let voucher = pool[a.type].shift();
            if (!voucher && test) voucher = lastV[a.type];
            if (voucher) lastV[a.type] = voucher;
            if (!voucher && test && repl.has(a.eid)) { setStat(i, "test", "Not checked: needs the cancelled voucher"); continue; }
            if (!voucher) throw Object.assign(new W.PortalError(`No unused ${VT[a.type].label} voucher left.`), { index: i });
            const activateNow = a.dk === key(todayDate()) && a.start <= nowMin();
            picked[i] = { voucher, activateNow };
            try {
              await W.bookOne({
                permitId: S.permitId, voucher, act: a, activateNow, testMode: test,
                vehicle: { vrn: v.vrn, favId: v.favId, saveAsFavourite: !!v.pendingFav, nickname: v.nick }, sendEmail: emailFor(a),
                onStep: (k, label) => { setStat(i, "run", `${k + 1}/${W.STEPS.length}`); bump(`Voucher ${done + 1} of ${nBook}: ${label} · ${fmtDay(fromKey(a.dk))} ${a.type === "day" ? "all day" : hm(a.start)} · ${vText(v)}`); }
              });
            } catch (e) { e.index = i; throw e; }
            if (!test && v.pendingFav) v.pendingFav = false; // saved with this booking
            setStat(i, test ? "test" : "done", test ? "Checked ✓" : "Booked ✓"); done++; booked.push(a);
          }
        } catch (e) {
          failed = e;
          if (e.index != null) setStat(e.index, "fail", "Failed", e.message);
        }
        for (let i = 0; i < ops.length; i++) if (/^(wait|run)$/.test(stat[i].cls)) setStat(i, "wait", "Not sent");
        bump(test ? "Finishing" : "Checking the council site shows every change");
        let missing = 0;
        if (!test && (done || cancelled)) {
          try {
            await loadPermitData();
            missing = booked.filter((a) => !S.bookings.some((b) => b.vrn === a.vrn && b.date === a.dk && Math.abs(b.start - a.start) <= 1)).length;
            S.entries = P.advanceEntries(ctx(), S.entries);
            buildPlan();
            S.entries = S.entries.filter((en) => S.plan.items.some((it) => it.entry === en && (it.acts.length || it.replaces.length)));
            await savePlan();
          } catch (e) { failed = failed || e; }
        }
        bar.classList.toggle("done", !failed && !stop); if (!failed && !stop) bar.firstChild.style.width = "100%";
        modal._busy = false; S.busy = false;
        const note = q("#rvNote"), fo = failed && failed.index != null ? ops[failed.index] : null;
        const vNum = fo ? ops.slice(0, failed.index + 1).filter((o) => o.kind === "book").length : 1;
        const lost = fo && fo.kind === "book" && cancelledE.has(fo.a.eid) ? " The old booking for this change was already cancelled; its vouchers are back in your unused vouchers and the change stays in your plan." : "";
        const summary = [done && `${done} booked`, cancelled && `${cancelled} cancelled`].filter(Boolean).join(", ") || "Nothing changed";
        if (test) note.textContent = failed ? `Test stopped at ${fo && fo.kind === "cancel" ? "a cancellation" : "voucher " + vNum}: ${failed.message}` : `Test passed for all ${plural(done, "voucher")}${nCancel ? ` (${nCancel} cancellation${nCancel === 1 ? "" : "s"} skipped: they can't be tested)` : ""}. Nothing was booked. Turn off test mode in Settings to book them.`;
        else if (failed) note.textContent = `${summary}. Then: ${failed.message}${lost} The rest were not sent and stay in your plan.`;
        else if (stop) note.textContent = `${summary}. The rest were not sent and stay in your plan.`;
        else note.textContent = missing ? `${summary}, but ${missing} don't appear on the council site yet. Check its Active permits list.` : `${summary}. The council site now lists these under Active permits.`;
        back.hidden = true;
        if (failed) {
          const copy = q("#rvCopy"); copy.hidden = false;
          const report = errorReport({ failed, test, ops, picked, done, stop, startedAt, available: fresh });
          copy.onclick = async () => {
            const ok = await copyText(report);
            copy.textContent = ok ? "Copied ✓" : "Couldn't copy";
            setTimeout(() => { copy.textContent = "Copy error details"; }, 2500);
          };
        }
        const go = q("#rvGo"); go.disabled = false; go.textContent = "Done";
        go.onclick = () => { closeModal(); refresh(); if (!test && (done || cancelled)) toast(`${summary}.`); };
      };
    }

    // ---------- clock ----------
    function tick() {
      const t = todayDate();
      if (key(t) !== key(S.today)) { S.today = t; S.cursor = new Date(t); S.now = nowMin(); if (!S.busy) load({ keepPermits: true }); return; }
      const n = nowMin(); if (n === S.now) return;
      S.now = n;
      if (S.loading) return;
      const before = S.entries.map((e) => e.from).join();
      S.entries = P.advanceEntries(ctx(), S.entries);
      if (S.entries.map((e) => e.from).join() !== before) savePlan();
      enforceNotPast();
      const typing = shadow.activeElement && /^(nvNick|nvPlate|vq|tFrom|tTo|edFrom|edTo|fvNick|lq|shEnd|bkFrom|bkTo|bkShift)$/.test(shadow.activeElement.id);
      if (!modal && !drag && !typing && S.editing == null && !S.bulkPanel) refresh();
    }
    let timer = null, rsT = null, wasNarrow = null;
    const onResize = () => { clearTimeout(rsT); rsT = setTimeout(() => { const n = isNarrow(); if (n !== wasNarrow) { wasNarrow = n; closePop(); if (!S.loading && $("#board")) renderBoard(); } }, 150); };

    const api = {
      async open() {
        await cssReady;
        host.hidden = false; document.documentElement.style.overflow = "hidden";
        S.settings = { ...S.settings, ...(await store.get("vb:settings", {})) };
        window.addEventListener("resize", onResize);
        if (!timer) timer = setInterval(tick, 15000);
        S.today = todayDate(); S.now = nowMin();
        await load({ keepPermits: false });
      },
      close() {
        if (S.busy) { toast("Wait for the booking run to finish first."); return; }
        host.hidden = true; document.documentElement.style.overflow = "";
        window.removeEventListener("resize", onResize);
        clearInterval(timer); timer = null; closePop();
        if (typeof api.onClose === "function") api.onClose();
      },
      get busy() { return S.busy; }
    };
    return api;
  }

  root.VB = root.VB || {};
  root.VB.app = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
