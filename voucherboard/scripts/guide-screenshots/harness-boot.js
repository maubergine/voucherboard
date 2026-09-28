// Voucherboard screenshot harness. Stubs chrome.* and fetch, modelled on test/ui.test.js's setup(),
// but running in a real Chrome tab (via a local static server) instead of jsdom, and serving two
// permits so the permit selector and purchase-advice states have something real to show.
// Never contacts the real council site: every /Permit, /Home, /VoucherBuyAgain, /FavouriteVehicle
// path is intercepted here; everything else (src/app.css, guide/index.html) is a normal same-origin fetch.
(function () {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const NOW = "2026-09-28T10:30:00"; // Mon 28 Sep 2026, 10:30 — matches test/ui.test.js's pinned clock

  // Pin the clock, exactly like ui.test.js does for jsdom.
  const RD = Date, fixed = new RD(NOW).getTime();
  window.Date = class extends RD {
    constructor(...a) { super(...(a.length ? a : [fixed])); }
    static now() { return fixed; }
  };

  const MAIN_ID = "x80b66f1c3b5e7742"; // the real anonymised fixture permit (LV-00000001, zone P)
  const SECOND_ID = "xsecondpermit0042"; // synthetic second permit (LV-00000042, zone B1) for the selector + purchase advice

  const storage = {};
  if (qs.get("terms") !== "0") storage["vb:terms"] = { version: "2026-09-28c" }; // must match terms.js VERSION
  if (qs.get("testmode") === "1") storage["vb:settings"] = { testMode: true };
  if (qs.get("beta") === "1") storage["vb:settings"] = { ...(storage["vb:settings"] || {}), betaLive: true };
  if (qs.get("open") === "1") storage["vb:open"] = true;
  if (qs.get("entries")) {
    storage["vb:plan:" + MAIN_ID] = JSON.parse(atob(qs.get("entries")));
  } else if (qs.get("plan") !== "0") {
    storage["vb:plan:" + MAIN_ID] = [
      { id: 1, vrn: "GH78JKL", dk: "2026-09-29", from: 630, to: 690 }, // Harper Visitor, new entry, Tue 10:30-11:30 (within zone P's controls)
      { id: 2, vrn: "VW55XYZ", dk: "2026-09-30", from: 600, to: 720, replaces: ["xd771d26b887ce0ee"] } // Blair Visitor, change replacing the booked 10:00-11:00 voucher
    ];
  }
  if (qs.get("advice") === "1") {
    storage["vb:plan:" + SECOND_ID] = [{ id: 1, vrn: "AB12CDE", dk: "2026-10-01", from: 540, to: 840 }]; // Drew Visitor, Thu 09:00-14:00 (5h) — triggers "save by buying a 5-hour voucher"
  }

  const cancelled = new Set(), deleted = new Set(), created = [], booked = [];

  window.chrome = {
    runtime: {
      getURL: (p) => new URL(p, location.href).toString(),
      getManifest: () => ({ version: "0.1.0" })
    },
    storage: { local: {
      get: async (k) => {
        if (k == null) return { ...storage };
        const ks = Array.isArray(k) ? k : [k], o = {};
        for (const x of ks) if (storage[x] !== undefined) o[x] = storage[x];
        return o;
      },
      set: async (o) => Object.assign(storage, o),
      remove: async (k) => { for (const x of Array.isArray(k) ? k : [k]) delete storage[x]; }
    } }
  };
  window.__vbStorage = storage; // for the capture script to poke at directly if needed

  const fxCache = {};
  async function fx(name) {
    if (fxCache[name]) return fxCache[name];
    const r = await fetch("fixtures/" + name, { cache: "no-store" });
    return (fxCache[name] = await r.text());
  }
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");

  // ---------- second permit, a synthetic in-window fixture (zone B1, Mon-Sat 09:00-19:00) ----------
  function secondPermitDetails() {
    const rows = [
      ["1 Hour", "8000000001", "xsuv01"], ["1 Hour", "8000000002", "xsuv02"], ["1 Hour", "8000000003", "xsuv03"],
      ["1 Hour", "8000000004", "xsuv04"], ["1 Hour", "8000000005", "xsuv05"], ["1 Hour", "8000000006", "xsuv06"]
    ].map(([label, ref, id]) => `<tr><td>${label}</td><td>${ref}</td><td><input type="button" value="Use" class="visitor-btn-voucher unusedVisitorVoucher" data-permit-vehicle-id="${id}"></td></tr>`).join("");
    const cancelled1 = cancelled.has("xsvoucher01");
    return `<!doctype html><html><body>
      <input type="hidden" id="Id" name="Id" value="${SECOND_ID}">
      <span class="label-text">LV-00000042</span>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Zone name</span></div><div class="col-md-8" id="ZoneName"> B1 - Lewisham Central </div></div>
      <button class="accordion-trigger" aria-controls="sectA" id="activeVisitorAccordion">Active Permits</button>
      <div id="sectA" aria-labelledby="activeVisitorAccordion">
        ${cancelled1 ? "" : `<div class="used-vouchers">
          <div id="Vrn">CD65EFG</div><div id="Date">30.09.2026 09:00</div><div id="EndDate">30.09.2026 13:59</div>
          <div id="VoucherNumber">8100000001</div><button class="cancelVoucherBtn" data-id="xsvoucher01">Cancel</button>
        </div>`}
      </div>
      <button class="accordion-trigger" aria-controls="sectU" id="unusedVisitorAccordion">Unused permits</button>
      <div id="sectU" aria-labelledby="unusedVisitorAccordion"><table><tbody>${rows}</tbody></table></div>
      </body></html>`;
  }

  // ---------- /Home/ApplicantPermits: real fixture plus a second active visitor permit tile ----------
  async function permitsPage() {
    const doc = parse(await fx("applicant-permits.html"));
    const first = doc.querySelector(".hometile.permit-card-info");
    const clone = first.cloneNode(true);
    clone.querySelector('input[name="item.PermitId"]').setAttribute("value", SECOND_ID);
    clone.querySelector('#UniqueIdentifier').setAttribute("value", "LV-00000042");
    const label = clone.querySelector(".label-text"); if (label) label.textContent = "LV-00000042";
    const zone = clone.querySelector("#ZoneName"); if (zone) zone.textContent = " B1 - Lewisham Central ";
    const buyBtn = clone.querySelector(".buyAgainBtn"); if (buyBtn) buyBtn.setAttribute("data-permitid", SECOND_ID);
    const manage = clone.querySelector(".permit-action-button"); if (manage) manage.setAttribute("href", `/Permit/Details?permitId=${SECOND_ID}&returnType=Permits`);
    first.after(clone);
    return doc.documentElement.outerHTML;
  }

  // A booked voucher, in the same markup the real fixture uses, so a run's "reads it back" check passes.
  function usedVoucherCard({ vrn, dateStr, endStr, ref, dataId }) {
    return `<div class="used-vouchers"><div class="vouchers-info">
      <div class="row padding-left"><div class="control-label col-md-4"><span>Number Plate</span></div><div class="col-md-8" id="Vrn"> ${vrn} </div></div>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Valid from</span></div><div class="col-md-8" id="Date"> ${dateStr} </div></div>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Valid to</span></div><div class="col-md-8" id="EndDate"> ${endStr} </div></div>
      <div class="row padding-left"><div class="control-label col-md-4"><span>Number</span></div><div class="col-md-8" id="VoucherNumber"> ${ref} </div></div>
      </div><div class="vouchers-buttons"><button type="button" class="cancelVoucherBtn" data-id="${dataId}" disabled>Cancel</button></div></div>`;
  }
  async function detailsPage(permitId) {
    if (permitId === SECOND_ID) return secondPermitDetails();
    if (!cancelled.size && !booked.length) return fx("permit-details.html");
    const doc = parse(await fx("permit-details.html"));
    for (const c of doc.querySelectorAll(".used-vouchers")) if ([...c.querySelectorAll("[data-id]")].some((x) => cancelled.has(x.getAttribute("data-id")))) c.remove();
    if (booked.length) {
      const active = doc.querySelector('[aria-labelledby="activeVisitorAccordion"] .accordion-vouchers');
      if (active) for (const b of booked) active.insertAdjacentHTML("beforeend", usedVoucherCard(b));
    }
    return doc.documentElement.outerHTML;
  }

  async function vehiclesPage() {
    if (!deleted.size && !created.length) return fx("applicant-vehicles.html");
    const doc = parse(await fx("applicant-vehicles.html"));
    for (const t of doc.querySelectorAll(".hometile")) { const i = t.querySelector('input[name="item.Id"]'); if (i && deleted.has(i.value)) t.remove(); }
    for (const c of created) doc.querySelector("#vehicleContainer").insertAdjacentHTML("beforeend", `<div class="hometile"><input name="item.Id" type="hidden" value="${c.id}"><label class="names">${c.name}</label><div id="Vrn">${c.vrn}</div></div>`);
    return doc.documentElement.outerHTML;
  }

  function mk(body, url, json) {
    return { ok: true, status: 200, url: url || "", text: async () => body, json: async () => (json !== undefined ? json : JSON.parse(body)) };
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (p, opt = {}) => {
    const u = new URL(p, location.href);
    if (u.origin === location.origin && !/^\/(Permit|Home|VoucherBuyAgain|FavouriteVehicle|Account)(\/|$)/.test(u.pathname)) return realFetch(p, opt);
    if (qs.get("neterr") === "1") throw new TypeError("Failed to fetch");
    const m = (opt.method || "GET").toUpperCase();
    const at = (x) => u.pathname === x;
    const base = "https://parkingpermits.lewisham.gov.uk";
    if (at("/Home/ApplicantPermits")) return mk(await permitsPage(), base + u.pathname);
    if (at("/Permit/Details")) return mk(await detailsPage(u.searchParams.get("permitId")), base + u.pathname + u.search);
    if (at("/Home/ApplicantVehicles")) return mk(await vehiclesPage(), base + u.pathname);
    if (at("/Permit/CancelVoucherConfirmationPopup")) return mk((await fx("cancel-popup.html")).replace(/x[0-9a-f]{16}/, u.searchParams.get("permitVehicleId")), base + u.pathname);
    if (at("/Permit/CancelVisitorVoucher")) { cancelled.add(new URLSearchParams(opt.body).get("Id")); return mk("", base + "/Permit/Details?permitId=" + MAIN_ID); }
    if (at("/Permit/VerifyNicknameOfVisitorVoucher")) return mk("", "", { Result: "Success" });
    if (at("/FavouriteVehicle/Create") && m === "GET") return mk(await fx("favourite-create-popup.html"), base + u.pathname);
    if (at("/FavouriteVehicle/Create") && m === "POST") { const b = new URLSearchParams(opt.body); created.push({ id: "xnew" + created.length, name: b.get("Name"), vrn: b.get("Vrn") }); return mk("", base + "/Home/ApplicantVehicles"); }
    if (at("/FavouriteVehicle/Delete") && m === "GET") return mk((await fx("favourite-delete-popup.html")).replace(/x[0-9a-f]{16}/, u.searchParams.get("id")), base + u.pathname);
    if (at("/FavouriteVehicle/Delete") && m === "POST") { deleted.add(new URLSearchParams(opt.body).get("Id")); return mk("", base + "/Home/ApplicantVehicles"); }
    if (at("/VoucherBuyAgain/VoucherSelect")) return mk(await fx("voucher-select.html"), base + u.pathname);
    if (at("/VoucherBuyAgain/ValidateBuyAgainLimits")) return mk("", "", { Result: "Success" });
    if (at("/Permit/VisitorPermit") && m === "GET") return mk(await fx("visitor-permit-form.html"), base + u.pathname);
    if (at("/Permit/GetNonEnforceableCoverage")) return mk("", "", qs.get("nonenforced") === "1" ? { Result: "Error", message: "The date or time you have selected is during non-enforcement hours" } : { Result: "Success" });
    if (at("/Permit/VerifyDateTimeOfVisitorVoucher")) return mk("", "", { Message: "" });
    if (at("/Permit/GetVisitorVoucherConfirmation")) {
      const b = new URLSearchParams(opt.body);
      const favs = window.VB.portal.parseVehicles(window.VB.portal.parseHtml(await fx("applicant-vehicles.html")));
      const fav = favs.find((f) => f.favId === b.get("FavoriteVehiclesId"));
      const d = b.get("Date"), vrn = b.get("VrnNumber") || (fav ? `${fav.vrn} (${fav.nick.toUpperCase()})` : "UNKNOWN");
      return mk(`<div>Number Plate ${vrn} Start Date ${d} Start Time ${b.get("FromTime")}</div>`, base + u.pathname);
    }
    if (at("/Permit/VisitorPermit") && m === "POST") {
      const b = new URLSearchParams(opt.body);
      const [dd, mo, yy] = (b.get("visitorPermit[Date]") || "").split("/");
      const [hh, mi] = (b.get("visitorPermit[FromTime]") || "00:00").split(":").map(Number);
      const endMin = Math.min(23 * 60 + 59, hh * 60 + mi + 59), eh = String(Math.floor(endMin / 60)).padStart(2, "0"), em = String(endMin % 60).padStart(2, "0");
      const favs = window.VB.portal.parseVehicles(window.VB.portal.parseHtml(await fx("applicant-vehicles.html")));
      const fav = favs.find((f) => f.favId === b.get("visitorPermit[FavoriteVehiclesId]"));
      const vrn = b.get("visitorPermit[VrnNumber]") || (fav ? fav.vrn : "UNKNOWN");
      if (dd) booked.push({
        vrn, dateStr: `${dd}.${mo}.${yy} ${b.get("visitorPermit[FromTime]")}`, endStr: `${dd}.${mo}.${yy} ${eh}:${em}`,
        ref: "91" + String(9000000 + booked.length), dataId: "xharnessbooked" + booked.length
      });
      return mk("", base + "/Permit/Details?permitId=" + MAIN_ID);
    }
    throw new Error("harness: unexpected request " + m + " " + u.pathname);
  };
})();
