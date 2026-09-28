// Talks to the council permit site from the page the user is already logged in to.
// Parsers take a Document so they can be tested against saved pages. Requests are same-origin
// and use the browser's existing session; no credentials are read, stored or sent anywhere else.
(function (root) {
  "use strict";

  const GAP_MS = 500; // pause between requests, so the run looks like a person clicking
  const STEPS = ["Opening voucher", "Checking controlled hours", "Checking date and time", "Getting confirmation", "Booking"];

  class PortalError extends Error {
    constructor(message, step, detail) { super(message); this.step = step; if (detail !== undefined) this.detail = detail; }
  }

  // ---------- parsing helpers ----------
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const val = (root, sel) => { const el = root.querySelector(sel); return el ? (el.value != null ? el.value : el.getAttribute("value")) || "" : ""; };
  const normVrn = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pad = (n) => String(n).padStart(2, "0");

  function parseHtml(html) { return new DOMParser().parseFromString(html, "text/html"); }

  function isLoginPage(doc) {
    return !!doc.querySelector('form[action*="/Account/Login"], input[type="password"]');
  }

  // "1 Hour" -> h1, "5 Hours" -> h5, "1 Day" -> day, "1 Week" -> week
  function durationType(label) {
    const m = /(\d+)\s*(hour|day|week)/i.exec(label || "");
    if (!m) return null;
    const n = +m[1], u = m[2].toLowerCase();
    if (u === "hour") return n === 1 ? "h1" : n === 5 ? "h5" : "h" + n;
    if (u === "day") return "day";
    return "week";
  }

  // "28.09.2026 10:00" -> { dk: "2026-09-28", min: 600 }
  function parseStamp(s) {
    const m = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})/.exec(s || "");
    if (!m) return null;
    return { dk: `${m[3]}-${m[2]}-${m[1]}`, min: +m[4] * 60 + +m[5] };
  }

  // Value next to a "Label" span in the portal's label/value rows.
  function rowValue(root, label) {
    for (const span of root.querySelectorAll(".control-label span, .control-label")) {
      if (text(span) === label) {
        const row = span.closest(".row") || span.parentElement.parentElement;
        const v = row && row.querySelector(".col-md-8");
        if (v) return text(v);
      }
    }
    return "";
  }

  // Home/ApplicantPermits
  function parsePermits(doc) {
    const out = [];
    for (const card of doc.querySelectorAll(".hometile")) {
      const id = val(card, 'input[name="item.PermitId"]');
      if (!id) continue;
      out.push({
        id,
        ref: val(card, 'input[name="item.UniqueIdentifier"]') || text(card.querySelector(".label-text")),
        zoneName: text(card.querySelector("#ZoneName")),
        type: text(card.querySelector("#PermitCategoryName")),
        status: text(card.querySelector("#PermitStatus")),
        count: parseInt(text(card.querySelector("#NumberOfVisitorPermits")), 10) || 0
      });
    }
    return out;
  }
  const isUsableVisitorPermit = (p) => /visitor/i.test(p.type) && /active/i.test(p.status);

  function sectionFor(doc, triggerId, headingText) {
    const byId = doc.querySelector(`[aria-labelledby="${triggerId}"]`);
    if (byId) return byId;
    for (const b of doc.querySelectorAll(".accordion-trigger")) {
      if (text(b).toLowerCase().startsWith(headingText.toLowerCase())) {
        const id = b.getAttribute("aria-controls");
        if (id) return doc.getElementById(id);
      }
    }
    return null;
  }

  // Permit/Details?permitId=...
  function parseDetails(doc) {
    const bookings = [];
    const readSection = (sec, state) => {
      if (!sec) return;
      for (const card of sec.querySelectorAll(".used-vouchers")) {
        const from = parseStamp(text(card.querySelector("#Date")));
        const to = parseStamp(text(card.querySelector("#EndDate")));
        if (!from) continue;
        const cancelBtn = card.querySelector(".cancelVoucherBtn");
        const mins = to ? (to.dk === from.dk ? to.min - from.min + 1 : 24 * 60 - from.min) : 60;
        bookings.push({
          vrn: normVrn(text(card.querySelector("#Vrn"))),
          date: from.dk, start: from.min, mins,
          ref: text(card.querySelector("#VoucherNumber")),
          id: cancelBtn ? cancelBtn.getAttribute("data-id") : (card.querySelector("[data-id]") || { getAttribute: () => "" }).getAttribute("data-id"),
          cancellable: !!cancelBtn && !cancelBtn.hasAttribute("disabled"),
          state
        });
      }
    };
    readSection(sectionFor(doc, "expiredVisitorAccordion", "Expired Permits"), "expired");
    readSection(sectionFor(doc, "activeVisitorAccordion", "Active Permits"), "active");

    const unused = [];
    const us = sectionFor(doc, "unusedVisitorAccordion", "Unused permits");
    if (us) {
      for (const tr of us.querySelectorAll("tbody tr")) {
        const btn = tr.querySelector(".unusedVisitorVoucher, [data-permit-vehicle-id]");
        if (!btn) continue;
        const cells = tr.querySelectorAll("td");
        const label = text(cells[0]);
        unused.push({ type: durationType(label), label, ref: text(cells[1]), permitVehicleId: btn.getAttribute("data-permit-vehicle-id") });
      }
    }
    return {
      permitId: val(doc, "input#Id") || val(doc, 'input[name="Id"]'),
      ref: text(doc.querySelector(".label-text")),
      zoneName: rowValue(doc, "Zone name"),
      bookings, unused
    };
  }

  // Home/ApplicantVehicles
  function parseVehicles(doc) {
    const out = [];
    for (const card of doc.querySelectorAll(".hometile")) {
      const favId = val(card, 'input[name="item.Id"]');
      const nick = text(card.querySelector("label.names"));
      const vrn = normVrn(text(card.querySelector("#Vrn")));
      if (favId && vrn) out.push({ favId, nick: nick || vrn, vrn });
    }
    return out;
  }

  // Permit/VisitorPermit partial (the "Use visitor permit" form)
  function parseVisitorForm(doc) {
    // A choice of lengths comes as a <select>. A voucher with one fixed length comes as a hidden field
    // holding its period id, with no label; bookOne then matches it to the voucher's own type.
    const periodEl = doc.querySelector("#VisitorVoucherPeriodId");
    const periods = periodEl && periodEl.tagName === "SELECT"
      ? [...periodEl.querySelectorAll("option")].filter((o) => o.value).map((o) => ({ id: o.value, label: text(o), type: durationType(text(o)) }))
      : periodEl && periodEl.value ? [{ id: periodEl.value, label: "", type: null, fixed: true }] : [];
    const favourites = [...doc.querySelectorAll("#FavoriteVehiclesId option")].filter((o) => o.value)
      .map((o) => ({ id: o.value, name: text(o) }));
    return {
      token: val(doc, 'input[name="__RequestVerificationToken"]'),
      permitId: val(doc, "#PermitId"),
      permitVehicleId: val(doc, "#PermitVehicleId"),
      voucherActivationType: val(doc, "#VoucherActivationType") || "Account",
      enableCarPark: val(doc, "#EnableCarPark") || "False",
      carParkRequired: /^true$/i.test(val(doc, "#EnableCarPark")),
      vehicleRestricted: /^true$/i.test(val(doc, "#RestrictToVrnOnApplication")),
      periods, favourites
    };
  }

  // VoucherBuyAgain/VoucherSelect: the Buy Again dialog. Each option reads like "1 Hour (£2.24)".
  // Some accounts may sell books, e.g. "Book of 10 x 1 Hour (£22.40)"; price is then per voucher.
  function parsePrices(doc) {
    const out = {};
    for (const o of doc.querySelectorAll("#PeriodPriceIdSelected option")) {
      if (!o.value) continue;
      const label = text(o), type = durationType(label.replace(/book of \d+\s*x?\s*/i, ""));
      const m = /£\s*([\d,]+(?:\.\d{1,2})?)/.exec(label);
      if (!type || !m) continue;
      const book = +((/book of (\d+)/i.exec(label) || [])[1] || 1);
      const total = parseFloat(m[1].replace(/,/g, ""));
      out[type] = { periodPriceId: o.value, label, book, price: Math.round((total / book) * 100) / 100 };
    }
    return out;
  }

  function parseCancelPopup(doc) {
    return { token: val(doc, 'input[name="__RequestVerificationToken"]'), id: val(doc, "#Id") };
  }

  // ---------- trace ----------
  // Recent requests and replies, kept in memory only, so a failure can be copied into a report.
  // Anti-forgery tokens are blanked; nothing here leaves the page unless the user copies it.
  const trace = [];
  const TRACE_MAX = 200, REPLY_MAX = 6000;
  const redact = (s) => String(s)
    .replace(/(__RequestVerificationToken(?:%5D)?=)[^&]*/gi, "$1[redacted]")
    .replace(/(name="__RequestVerificationToken"[^>]*?value=")[^"]*/gi, "$1[redacted]")
    .replace(/(value=")[^"]*("[^>]*?name="__RequestVerificationToken")/gi, "$1[redacted]$2");
  const squash = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/\s+/g, " ").trim();
  function noteReply(body) {
    const e = trace[trace.length - 1];
    if (!e) return;
    const s = redact(squash(body));
    e.replyLength = s.length;
    e.reply = s.length > REPLY_MAX ? s.slice(0, REPLY_MAX) + " …[truncated]" : s;
  }
  function clearTrace() { trace.length = 0; }

  // ---------- network ----------
  let last = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function pace() { const w = last + api.GAP_MS - Date.now(); if (w > 0) await sleep(w); last = Date.now(); }
  const bust = () => "_=" + Date.now();
  const form = (obj) => new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, v == null ? "" : String(v)])).toString();

  async function request(path, { method = "GET", body = null, xhr = false } = {}) {
    await pace();
    const headers = {};
    if (xhr) headers["X-Requested-With"] = "XMLHttpRequest";
    if (body != null) headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    const entry = { at: new Date().toISOString(), method, path, body: body == null ? null : redact(body) };
    trace.push(entry); if (trace.length > TRACE_MAX) trace.shift();
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(path, { method, body, headers, credentials: "same-origin", redirect: "follow", cache: "no-store" });
    } catch (e) {
      entry.error = String(e && e.message || e);
      throw new PortalError("Couldn't reach the council site. Check your connection.");
    }
    Object.assign(entry, { status: res.status, finalUrl: res.url, ms: Date.now() - t0 });
    if (/\/Account\/Login/i.test(res.url)) throw new PortalError("You've been logged out of the council site. Log in again, then reopen Voucherboard.");
    if (!res.ok) throw new PortalError(`The council site returned an error (${res.status}).`);
    return res;
  }
  async function getDoc(path, opts) {
    const res = await request(path, opts);
    const html = await res.text();
    noteReply(html);
    const doc = parseHtml(html);
    if (isLoginPage(doc)) throw new PortalError("You've been logged out of the council site. Log in again, then reopen Voucherboard.");
    return doc;
  }
  async function getJson(path, opts) {
    const res = await request(path, opts);
    let j;
    try { j = await res.json(); } catch (e) { noteReply("[not JSON] " + (e && e.message)); throw new PortalError("The council site sent an unexpected reply."); }
    noteReply(JSON.stringify(j));
    return j;
  }

  async function loadPermits() { return parsePermits(await getDoc("/Home/ApplicantPermits")); }
  async function loadDetails(permitId) { return parseDetails(await getDoc(`/Permit/Details?permitId=${encodeURIComponent(permitId)}&returnType=Permits`)); }
  async function loadVehicles() { return parseVehicles(await getDoc("/Home/ApplicantVehicles")); }

  // Same request the site's own "Buy Again" button makes. It only returns the selection dialog.
  async function loadPrices(permitId) {
    return parsePrices(await getDoc("/VoucherBuyAgain/VoucherSelect", { method: "POST", body: form({ permitId }), xhr: true }));
  }

  // Checks the purchase is allowed, then returns the council's own payment page for it.
  // Voucherboard never runs on that page: the user pays there themselves.
  async function buyUrl(permitId, periodPriceId, count) {
    const r = await getJson("/VoucherBuyAgain/ValidateBuyAgainLimits", { method: "POST", body: form({ permitId, numberOfVouchers: count }), xhr: true });
    if (r.Result !== "Success") throw new PortalError(r.message || r.Message || "The council site won't allow that many vouchers.");
    return `/PermitPayment/BuyAgainOnlineWithCardPay?permitId=${encodeURIComponent(permitId)}&periodPriceId=${encodeURIComponent(periodPriceId)}&numberOfVouchers=${encodeURIComponent(count)}`;
  }

  async function checkNickname(nickname) {
    const r = await getJson(`/Permit/VerifyNicknameOfVisitorVoucher?nickname=${encodeURIComponent(nickname)}&${bust()}`, { xhr: true });
    return { ok: r.Result !== "Error", message: r.Message || "" };
  }

  const ddmmyyyy = (dk) => { const [y, m, d] = dk.split("-"); return `${d}/${m}/${y}`; };
  const hhmm = (min) => pad(Math.floor(min / 60)) + ":" + pad(min % 60);

  // Book one voucher. Mirrors the site's own sequence. In test mode every check runs but the booking isn't sent.
  // act: { dk, start, type }  vehicle: { vrn, favId?, saveAsFavourite?, nickname? }
  async function bookOne({ permitId, voucher, act, vehicle, activateNow, testMode, sendEmail, onStep }) {
    const step = (i) => onStep && onStep(i, STEPS[i]);
    const date = ddmmyyyy(act.dk), time = hhmm(act.start);

    step(0);
    const formDoc = await getDoc(`/Permit/VisitorPermit?permitId=${encodeURIComponent(permitId)}&permitVehicleId=${encodeURIComponent(voucher.permitVehicleId)}&${bust()}`, { xhr: true });
    const f = parseVisitorForm(formDoc);
    if (!f.token) throw new PortalError("The booking form didn't load properly.", 0);
    if (f.carParkRequired) throw new PortalError("This permit needs a car park choosing. Book it on the council site.", 0);
    if (f.vehicleRestricted) throw new PortalError("This permit is limited to one vehicle. Book it on the council site.", 0);
    const period = f.periods.find((p) => p.type === act.type) || (f.periods.length === 1 && act.type === voucher.type ? f.periods[0] : null);
    if (!period) {
      const sel = formDoc.querySelector("#VisitorVoucherPeriodId");
      throw new PortalError(`This voucher can't be used as ${{ h1: "a 1-hour", h5: "a 5-hour", day: "an all-day" }[act.type] || "a " + act.type} voucher.`, 0, {
        wantedType: act.type, voucher, formPeriods: f.periods, periodSelectHtml: sel ? squash(sel.outerHTML) : "(no #VisitorVoucherPeriodId on the form)"
      });
    }

    step(1);
    const cov = await getJson("/Permit/GetNonEnforceableCoverage", { method: "POST", body: form({ PermitId: permitId, Date: date, FromTime: time }), xhr: true });
    if (cov.Result !== "Success") throw new PortalError(cov.message || cov.Message || "The council site says no voucher is needed at this time.", 1, { reply: cov });

    step(2);
    if (!activateNow) {
      const v = await getJson(`/Permit/VerifyDateTimeOfVisitorVoucher?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}&${bust()}`, { xhr: true });
      if (v.Message) throw new PortalError(v.Message, 2, { reply: v });
    }

    const fields = {
      PermitId: permitId,
      PermitVehicleId: f.permitVehicleId || voucher.permitVehicleId,
      VrnNumber: vehicle.favId ? "" : vehicle.vrn,
      Date: date, FromTime: time,
      SendEmail: !!sendEmail, // the site's "send confirmation email" option
      FavoriteVehiclesId: vehicle.favId || "",
      SaveVrnAsFavoriteVehicle: !vehicle.favId && !!vehicle.saveAsFavourite,
      FavoriteVehicleNickname: !vehicle.favId && vehicle.saveAsFavourite ? vehicle.nickname || "" : "",
      IsActivateNow: !!activateNow,
      VisitorVoucherPeriodId: period.id,
      VoucherActivationType: f.voucherActivationType,
      EnableCarPark: f.enableCarPark
    };

    step(3);
    const conf = await request("/Permit/GetVisitorVoucherConfirmation", { method: "POST", body: form(fields), xhr: true });
    const confHtml = await conf.text();
    noteReply(confHtml);
    const confText = parseHtml(confHtml).body.textContent.replace(/\s+/g, " ");
    if (!normVrn(confText).includes(normVrn(vehicle.vrn))) throw new PortalError("The council site's confirmation shows a different number plate. Nothing was booked.", 3, { expectedVrn: vehicle.vrn, confirmationText: confText.slice(0, 2000) });
    if (!activateNow && !confText.includes(date)) throw new PortalError("The council site's confirmation shows a different date. Nothing was booked.", 3, { expectedDate: date, confirmationText: confText.slice(0, 2000) });

    step(4);
    if (testMode) return { tested: true };
    const body = {};
    for (const [k, v] of Object.entries(fields)) body[`visitorPermit[${k}]`] = v;
    body.__RequestVerificationToken = f.token;
    const res = await request("/Permit/VisitorPermit", { method: "POST", body: form(body), xhr: true });
    if (!/\/Permit\/Details/i.test(res.url)) noteReply(await res.text().catch(() => ""));
    if (!/\/Permit\/Details/i.test(res.url)) throw new PortalError("The council site didn't confirm the booking. Check its Active permits list.", 4, { finalUrl: res.url });
    return { booked: true };
  }

  async function cancelBooking(permitVehicleId) {
    const p = parseCancelPopup(await getDoc(`/Permit/CancelVoucherConfirmationPopup?permitVehicleId=${encodeURIComponent(permitVehicleId)}&returnUrl=&${bust()}`, { xhr: true }));
    if (!p.token) throw new PortalError("The cancel form didn't load properly.");
    const res = await request("/Permit/CancelVisitorVoucher", { method: "POST", body: form({ __RequestVerificationToken: p.token, Id: p.id || permitVehicleId, ReturnUrl: "" }) });
    if (!/\/Permit\/Details/i.test(res.url)) throw new PortalError("The council site didn't confirm the cancellation.");
    return true;
  }

  // Same as the site's own delete button: it loads a confirmation dialog, whose form is then submitted as-is.
  // The caller checks the favourites list afterwards, since the reply alone doesn't prove it worked.
  async function deleteFavourite(favId) {
    const doc = await getDoc(`/FavouriteVehicle/Delete?id=${encodeURIComponent(favId)}&${bust()}`, { xhr: true });
    const f = doc.querySelector("form");
    if (!f) throw new PortalError("The delete form didn't load properly.");
    const fields = {};
    for (const i of f.querySelectorAll("input[name]")) if (!/^(checkbox|radio)$/i.test(i.type) || i.checked) fields[i.name] = i.value;
    const action = f.getAttribute("action") || "/FavouriteVehicle/Delete";
    await request(action, { method: (f.getAttribute("method") || "POST").toUpperCase(), body: form(fields), xhr: true });
    return true;
  }

  // Same as the site's "Create favourite vehicle" dialog: load its form, fill in Name and Vrn, submit it.
  // The caller checks the favourites list afterwards.
  async function createFavourite(nick, vrn) {
    const doc = await getDoc(`/FavouriteVehicle/Create?${bust()}`, { xhr: true });
    const f = doc.querySelector("form");
    if (!f || !f.querySelector('[name="Name"]') || !f.querySelector('[name="Vrn"]')) throw new PortalError("The favourite vehicle form didn't load properly.");
    const fields = {};
    for (const i of f.querySelectorAll("input[name]")) if (!/^(checkbox|radio)$/i.test(i.type) || i.checked) fields[i.name] = i.value;
    fields.Name = nick; fields.Vrn = normVrn(vrn);
    await request(f.getAttribute("action") || "/FavouriteVehicle/Create", { method: "POST", body: form(fields), xhr: true });
    return true;
  }

  const api = { STEPS, GAP_MS, PortalError, trace, clearTrace, normVrn, durationType, parseStamp, parseHtml, isLoginPage,
    parsePermits, isUsableVisitorPermit, parseDetails, parseVehicles, parseVisitorForm, parseCancelPopup, parsePrices,
    loadPermits, loadDetails, loadVehicles, loadPrices, buyUrl, checkNickname, bookOne, cancelBooking, deleteFavourite, createFavourite, ddmmyyyy, hhmm };
  root.VB = root.VB || {};
  root.VB.portal = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
