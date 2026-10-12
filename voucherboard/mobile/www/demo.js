// Demo mode: a made-up council site, in memory, for people without a Lewisham permit (App Review, guideline 2.1).
// VB.demo.create() returns { fetch }, which stands in for VB.portal.transport. It answers the same requests as the real
// site, with the same markup the parsers read, and its bookings are placed around today so reminders and the Live
// Activity have something to show. Nothing leaves the phone, and nothing is stored.
(function (root) {
  "use strict";
  const BASE = "https://parkingpermits.lewisham.gov.uk", PERMIT = "xdemopermit00001", REF = "LV-00012345", ZONE = "B1 - Lewisham Central";
  const PRICE = { h1: "1 Hour (£2.24)", h5: "5 Hours (£5.59)", day: "1 Day (£8.69)", week: "1 Week (£37.25)" };
  const LABEL = { h1: "1 Hour", h5: "5 Hours", day: "1 Day" }, MINS = { h1: 60, h5: 300 };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dotted = (dk) => { const [y, m, d] = dk.split("-"); return `${d}.${m}.${y}`; };
  const slashed = (dk) => { const [y, m, d] = dk.split("-"); return `${d}/${m}/${y}`; };
  const fromSlashed = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const minsOf = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const nowParts = () => { const d = new Date(); return { dk: keyOf(d), min: d.getHours() * 60 + d.getMinutes() }; };

  function create() {
    const now = new Date(), today = dayOf(now), nowMin = now.getHours() * 60 + now.getMinutes();
    let seq = 1;
    const id = (p) => `${p}${String(seq++).padStart(12, "0")}`;
    const ref = () => String(8100000000 + seq++);
    const favs = [
      { id: "xdemofav00000001", nick: "Mum", vrn: "VW55XYZ" },
      { id: "xdemofav00000002", nick: "Sam", vrn: "GH78JKL" },
      { id: "xdemofav00000003", nick: "Builder", vrn: "TU44VWX" }
    ];
    const unused = [];
    const addUnused = (type, n) => { for (let i = 0; i < n; i++) unused.push({ id: id("xdemov"), type, ref: ref() }); };
    addUnused("h1", 8); addUnused("h5", 2); addUnused("day", 1);
    const bookings = [];
    const book = (vrn, dk, start, mins) => bookings.push({ id: id("xdemob"), vrn, dk, start, mins: Math.min(mins, 1440 - start), ref: ref() });
    // A visitor parked now, with a voucher still to start (so End early has something to offer).
    const s = Math.max(0, Math.min(Math.floor(nowMin / 60) * 60 - 60, 1440 - 180));
    for (let i = 0; i < 3; i++) book("TU44VWX", keyOf(today), s + i * 60, 60);
    book("VW55XYZ", keyOf(shift(today, -1)), 600, 60);
    book("VW55XYZ", keyOf(shift(today, 1)), 600, 60); book("VW55XYZ", keyOf(shift(today, 1)), 660, 60);
    book("GH78JKL", keyOf(shift(today, 2)), 540, 300);
    book("AB12CDE", keyOf(shift(today, 5)), 780, 60);

    const started = (b) => { const n = nowParts(); return b.dk < n.dk || (b.dk === n.dk && b.start <= n.min); };
    const ended = (b) => { const n = nowParts(); return b.dk < n.dk || (b.dk === n.dk && b.start + b.mins <= n.min); };
    const card = (b) => `<div class="used-vouchers"><div class="vouchers-info">
      <div class="row padding-left"><div class="control-label col-md-4"><span>Number Plate</span></div><div class="col-md-8" id="Vrn"> ${esc(b.vrn)} </div></div>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Valid from</span></div><div class="col-md-8" id="Date"> ${dotted(b.dk)} ${hhmm(b.start)} </div></div>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Valid to</span></div><div class="col-md-8" id="EndDate"> ${dotted(b.dk)} ${hhmm(b.start + b.mins - 1)} </div></div>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Number</span></div><div class="col-md-8" id="VoucherNumber"> ${esc(b.ref)} </div></div>
      </div>${ended(b) ? `<span data-id="${esc(b.id)}"></span>` : `<div class="vouchers-buttons"><button type="button" class="cancelVoucherBtn" data-id="${esc(b.id)}"${started(b) ? " disabled" : ""}>Cancel</button></div>`}</div>`;
    const section = (sid, trigger, title, inner) => `<button class="accordion-trigger" aria-controls="${sid}" id="${trigger}">${title}</button><div id="${sid}" aria-labelledby="${trigger}">${inner}</div>`;
    const sorted = () => [...bookings].sort((a, b) => a.dk.localeCompare(b.dk) || a.start - b.start);

    const pages = {
      permits: () => `<main><div class="hometile permit-card-info"><input id="Id" name="item.PermitId" type="hidden" value="${PERMIT}">
        <input id="UniqueIdentifier" name="item.UniqueIdentifier" type="hidden" value="${REF}"><span class="label-text">${REF}</span>
        <div class="col-md-8" id="ZoneName">${ZONE}</div><div class="col-md-8" id="PermitCategoryName">Visitor Permits</div>
        <div class="col-md-8" id="PermitStatus">Active</div><div class="col-md-8" id="NumberOfVisitorPermits">${unused.length}</div>
        <button class="buyAgainBtn" data-permitid="${PERMIT}">Buy Again</button></div></main>`,
      details: () => `<main><input type="hidden" id="Id" name="Id" value="${PERMIT}"><span class="label-text">${REF}</span>
        <div class="row padding-left"><div class="control-label col-md-4"><span>Zone name</span></div><div class="col-md-8">${ZONE}</div></div>
        ${section("sectE", "expiredVisitorAccordion", "Expired Permits", sorted().filter(ended).map(card).join(""))}
        ${section("sectA", "activeVisitorAccordion", "Active Permits", sorted().filter((b) => !ended(b)).map(card).join(""))}
        ${section("sectU", "unusedVisitorAccordion", "Unused permits", `<table><tbody>${unused.map((u) =>
          `<tr><td>${LABEL[u.type]}</td><td>${u.ref}</td><td><input type="button" value="Use" class="visitor-btn-voucher unusedVisitorVoucher" data-permit-vehicle-id="${u.id}"></td></tr>`).join("")}</tbody></table>`)}</main>`,
      vehicles: () => `<main><div id="vehicleContainer">${favs.map((f) =>
        `<div class="hometile"><input name="item.Id" type="hidden" value="${esc(f.id)}"><label class="names">${esc(f.nick)}</label><div id="Vrn">${esc(f.vrn)}</div></div>`).join("")}</div></main>`,
      prices: () => `<select id="PeriodPriceIdSelected" name="PeriodPriceIdSelected"><option value="">Select...</option>${Object.entries(PRICE).map(([k, l], i) => `<option value="${9100 + i}">${l}</option>`).join("")}</select><input id="NumberSelected" type="number" value="0">`,
      form: (u) => `<form><input name="__RequestVerificationToken" type="hidden" value="DEMO-TOKEN"><input id="PermitId" name="PermitId" type="hidden" value="${PERMIT}">
        <input id="PermitVehicleId" name="PermitVehicleId" type="hidden" value="${esc(u.id)}"><input id="VoucherActivationType" type="hidden" value="Account">
        <input id="EnableCarPark" type="hidden" value="False"><input id="RestrictToVrnOnApplication" type="hidden" value="False">
        <select id="VisitorVoucherPeriodId" name="VisitorVoucherPeriodId"><option value="">Select...</option><option value="xdemoperiod-${u.type}">${LABEL[u.type]}</option></select>
        <select id="FavoriteVehiclesId" name="FavoriteVehiclesId"><option value="">Select...</option>${favs.map((f) => `<option value="${esc(f.id)}">${esc(f.nick)}</option>`).join("")}</select></form>`,
      popup: (action, value) => `<div class="clearfix"><form action="${action}" method="post"><input name="__RequestVerificationToken" type="hidden" value="DEMO-TOKEN"><input id="Id" name="Id" type="hidden" value="${esc(value)}"></form></div>`,
      createFav: () => `<div class="clearfix"><form action="/FavouriteVehicle/Create" method="post"><input name="__RequestVerificationToken" type="hidden" value="DEMO-TOKEN"><input id="Id" name="Id" type="hidden" value=""><input id="Name" name="Name" type="text" value=""><input id="Vrn" name="Vrn" type="text" value=""></form></div>`
    };

    const reply = (body, url, status = 200) => ({ ok: status >= 200 && status < 300, status, url: url || "", text: async () => body, json: async () => JSON.parse(body) });
    const html = (body, u) => reply(`<!doctype html><html><body>${body}</body></html>`, BASE + u.pathname + u.search);
    const json = (o) => reply(JSON.stringify(o), "");
    const toDetails = () => reply("", `${BASE}/Permit/Details?permitId=${PERMIT}`);
    const addFav = (nick, vrn) => { if (vrn && !favs.some((f) => f.vrn === vrn)) favs.push({ id: id("xdemofav"), nick: nick || vrn, vrn }); };

    async function fetch(path, opt = {}) {
      const u = new URL(String(path), BASE + "/Home/Index"), m = String(opt.method || "GET").toUpperCase();
      const body = new URLSearchParams(opt.body || ""), at = (p) => u.pathname.toLowerCase() === p.toLowerCase();
      if (at("/Home/ApplicantPermits")) return html(pages.permits(), u);
      if (at("/Permit/Details")) return html(pages.details(), u);
      if (at("/Home/ApplicantVehicles")) return html(pages.vehicles(), u);
      if (at("/VoucherBuyAgain/VoucherSelect")) return html(pages.prices(), u);
      if (at("/VoucherBuyAgain/ValidateBuyAgainLimits")) return json({ Result: "Success" });
      if (at("/Permit/VerifyNicknameOfVisitorVoucher")) return json({ Result: "Success" });
      if (at("/Permit/GetNonEnforceableCoverage")) return json({ Result: "Success" });
      if (at("/Permit/VerifyDateTimeOfVisitorVoucher")) return json({ Message: "" });
      if (at("/Permit/VisitorPermit") && m === "GET") {
        const v = unused.find((x) => x.id === u.searchParams.get("permitVehicleId"));
        return v ? html(pages.form(v), u) : reply("", BASE + u.pathname, 404);
      }
      if (at("/Permit/GetVisitorVoucherConfirmation")) {
        const fav = favs.find((f) => f.id === body.get("FavoriteVehiclesId"));
        const vrn = body.get("VrnNumber") || (fav ? `${fav.vrn} (${fav.nick.toUpperCase()})` : "");
        return html(`<div>Number Plate ${esc(vrn)} Start Date ${esc(body.get("Date"))} Start Time ${esc(body.get("FromTime"))}</div>`, u);
      }
      if (at("/Permit/VisitorPermit") && m === "POST") {
        const f = (k) => body.get(`visitorPermit[${k}]`);
        const i = unused.findIndex((x) => x.id === f("PermitVehicleId"));
        const fav = favs.find((x) => x.id === f("FavoriteVehiclesId"));
        const vrn = String(fav ? fav.vrn : f("VrnNumber") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const n = nowParts(), dk = f("IsActivateNow") === "true" ? n.dk : fromSlashed(f("Date")), start = f("IsActivateNow") === "true" ? n.min : minsOf(f("FromTime"));
        if (i < 0 || !vrn || !dk || start == null) return reply("", BASE + "/Permit/VisitorPermit", 400);
        const [v] = unused.splice(i, 1);
        bookings.push({ id: id("xdemob"), vrn, dk, start, mins: Math.min(MINS[v.type] || 1440, 1440 - start), ref: v.ref, type: v.type });
        if (f("SaveVrnAsFavoriteVehicle") === "true") addFav(f("FavoriteVehicleNickname"), vrn);
        return toDetails();
      }
      if (at("/Permit/CancelVoucherConfirmationPopup")) return html(pages.popup("/Permit/CancelVisitorVoucher", u.searchParams.get("permitVehicleId")), u);
      if (at("/Permit/CancelVisitorVoucher")) {
        const i = bookings.findIndex((b) => b.id === body.get("Id"));
        if (i >= 0 && !started(bookings[i])) {
          const [b] = bookings.splice(i, 1);
          unused.push({ id: id("xdemov"), type: b.type || (b.mins >= 1380 ? "day" : b.mins >= 300 ? "h5" : "h1"), ref: b.ref });
        }
        return toDetails();
      }
      if (at("/FavouriteVehicle/Create") && m === "GET") return html(pages.createFav(), u);
      if (at("/FavouriteVehicle/Create")) { addFav(body.get("Name"), String(body.get("Vrn") || "").toUpperCase()); return reply("", BASE + "/Home/ApplicantVehicles"); }
      if (at("/FavouriteVehicle/Delete") && m === "GET") return html(pages.popup("/FavouriteVehicle/Delete", u.searchParams.get("id")), u);
      if (at("/FavouriteVehicle/Delete")) { const i = favs.findIndex((f) => f.id === body.get("Id")); if (i >= 0) favs.splice(i, 1); return reply("", BASE + "/Home/ApplicantVehicles"); }
      return reply("", BASE + u.pathname, 404);
    }
    return { fetch, state: { favs, unused, bookings } };
  }

  root.VB = root.VB || {};
  root.VB.demo = { create, PERMIT, slashed };
  if (typeof module !== "undefined" && module.exports) module.exports = root.VB.demo;
})(typeof globalThis !== "undefined" ? globalThis : this);
