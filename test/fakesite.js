// A fake council site for the jsdom tests: routes the planner's requests to the saved pages in fixtures/.
// Records calls, and which bookings were cancelled and favourites deleted or created. No network.
// multi: the account also holds LV-00000002, a second active permit in zone P applied for on 2 Sep, after LV-00000001
// (11 Jul): 2 × 5 hours, 3 × 1 hour, and the 11:00 half of VW55XYZ's visit on 30 Sep. And LV-00000004 in zone V
// (4 × 1 hour). secondOlder dates LV-00000002 1 Jan, so it's the older one; secondEmpty leaves it no unused vouchers.
// In multi mode, a booked voucher leaves its permit's unused vouchers.
// long: LV-00000001 as the live site showed it with TU44VWX booked for 5 hours (26 Oct), a day (27 Oct) and a week
// (2 Nov), all from 10:00, and a 5-hour, a day and a week voucher unused. Its booking form offers every length, and the
// confirmation shows the length booked, as the live site's do.
const fs = require("node:fs");
const path = require("node:path");

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const BASE = "https://parkingpermits.lewisham.gov.uk";
const MAIN = "x80b66f1c3b5e7742", SECOND = "x246a5c3e00d2f6ef", OTHER = "x7c1f00d4e2a9b315";
const DETAILS = { [MAIN]: "permit-details.html", [SECOND]: "permit-details-second.html", [OTHER]: "permit-details-other-zone.html" };

function fakeSite(w, { nonEnforced = false, zone = null, loggedOut = false, multi = false, secondOlder = false, secondEmpty = false, long = false } = {}) {
  const calls = [], deleted = new Set(), cancelled = new Set(), created = [], used = new Set();
  const zoned = (html) => (zone ? html.replaceAll("P - Hither Green East", zone) : html);
  const vehiclesPage = () => {
    if (!deleted.size && !created.length) return fx("applicant-vehicles.html");
    const d = new w.DOMParser().parseFromString(fx("applicant-vehicles.html"), "text/html");
    for (const t of d.querySelectorAll(".hometile")) { const i = t.querySelector('input[name="item.Id"]'); if (i && deleted.has(i.value)) t.remove(); }
    for (const c of created) d.querySelector("#vehicleContainer").insertAdjacentHTML("beforeend", `<div class="hometile"><input name="item.Id" type="hidden" value="${c.id}"><label class="names">${c.name}</label><div id="Vrn">${c.vrn}</div></div>`);
    return d.documentElement.outerHTML;
  };
  const permitsPage = () => {
    if (!multi) return zoned(fx("applicant-permits.html"));
    const d = new w.DOMParser().parseFromString(zoned(fx("applicant-permits.html")), "text/html"), cards = [...d.querySelectorAll(".hometile")];
    const card = (id) => cards.find((c) => c.querySelector('input[name="item.PermitId"]').value === id);
    card(SECOND).querySelector("#PermitStatus").textContent = "Active";
    const other = card(MAIN).cloneNode(true);
    other.querySelector('input[name="item.PermitId"]').value = OTHER;
    other.querySelector('input[name="item.UniqueIdentifier"]').value = "LV-00000004";
    other.querySelector(".label-text").textContent = "LV-00000004";
    other.querySelector("#ZoneName").textContent = "V - Lee";
    card(SECOND).after(other);
    return d.documentElement.outerHTML;
  };
  const detailsPage = (id) => {
    const name = (multi && DETAILS[id]) || (long ? "permit-details-long.html" : "permit-details.html");
    const page = secondOlder && id === SECOND ? zoned(fx(name)).replace("02.09.2026", "01.01.2026") : zoned(fx(name));
    const spent = (id === SECOND && secondEmpty) || used.size;
    if (!cancelled.size && !spent) return page;
    const d = new w.DOMParser().parseFromString(page, "text/html");
    for (const b of d.querySelectorAll("[data-permit-vehicle-id]")) if ((id === SECOND && secondEmpty) || used.has(b.getAttribute("data-permit-vehicle-id"))) b.closest("tr").remove();
    for (const c of d.querySelectorAll(".used-vouchers")) if ([...c.querySelectorAll("[data-id]")].some((x) => cancelled.has(x.getAttribute("data-id")))) c.remove();
    return d.documentElement.outerHTML;
  };
  const reply = (body, { url, json } = {}) => ({ ok: true, status: 200, url: url || "", text: async () => body, json: async () => (json !== undefined ? json : JSON.parse(body)) });
  async function fetch(p, opt = {}) {
    const u = new URL(p, BASE + "/Home/Index"), m = (opt.method || "GET").toUpperCase();
    calls.push({ m, path: u.pathname, body: opt.body || "" });
    if (loggedOut) return reply(`<form action="/Account/Login"><input type="password"></form>`, { url: BASE + "/Account/Login?ReturnUrl=" + encodeURIComponent(u.pathname) });
    const at = (x) => u.pathname === x;
    if (at("/Home/ApplicantPermits")) return reply(permitsPage(), { url: u.href });
    if (at("/Permit/Details")) return reply(detailsPage(u.searchParams.get("permitId")), { url: u.href });
    if (at("/Home/ApplicantVehicles")) return reply(vehiclesPage(), { url: u.href });
    if (at("/Permit/CancelVoucherConfirmationPopup")) return reply(fx("cancel-popup.html").replace("xd771d26b887ce0ee", u.searchParams.get("permitVehicleId")), { url: u.href });
    if (at("/Permit/CancelVisitorVoucher")) { cancelled.add(new URLSearchParams(opt.body).get("Id")); return reply("", { url: BASE + "/Permit/Details?permitId=x80b66f1c3b5e7742" }); }
    if (at("/Permit/VerifyNicknameOfVisitorVoucher")) return reply("", { json: { Result: "Success" } });
    if (at("/FavouriteVehicle/Create") && m === "GET") return reply(fx("favourite-create-popup.html"), { url: u.href });
    if (at("/FavouriteVehicle/Create") && m === "POST") { const b = new URLSearchParams(opt.body); created.push({ id: "xnew" + created.length, name: b.get("Name"), vrn: b.get("Vrn") }); return reply("", { url: BASE + "/Home/ApplicantVehicles" }); }
    if (at("/FavouriteVehicle/Delete") && m === "GET") return reply(fx("favourite-delete-popup.html").replace("x7611b00bb2be593e", u.searchParams.get("id")), { url: u.href });
    if (at("/FavouriteVehicle/Delete") && m === "POST") { deleted.add(new URLSearchParams(opt.body).get("Id")); return reply("", { url: BASE + "/Home/ApplicantVehicles" }); }
    if (at("/VoucherBuyAgain/ValidateBuyAgainLimits")) return reply("", { json: { Result: "Success" } });
    if (at("/VoucherBuyAgain/VoucherSelect")) return reply(fx("voucher-select.html"), { url: u.href });
    if (at("/Permit/VisitorPermit") && m === "GET") { // LV-00000002's 5-hour vouchers open a 5-hour form
      const h5 = /^xa1b2c3d4e5f6070[12]$/.test(u.searchParams.get("permitVehicleId"));
      let form = long ? fx("visitor-permit-form-all.html") : h5 ? fx("visitor-permit-form.html").replace(">1 Hour</option>", ">5 Hours</option>") : fx("visitor-permit-form.html");
      if (multi) form = form.replace(/(id="PermitVehicleId"[^>]*value=")[^"]*/, "$1" + u.searchParams.get("permitVehicleId"));
      return reply(form, { url: u.href });
    }
    if (at("/Permit/GetNonEnforceableCoverage")) return reply("", { json: nonEnforced ? { Result: "Error", message: "The date or time you have selected is during non-enforcement hours" } : { Result: "Success" } });
    if (at("/Permit/VerifyDateTimeOfVisitorVoucher")) return reply("", { json: { Message: "" } });
    if (at("/Permit/GetVisitorVoucherConfirmation")) {
      const b = new URLSearchParams(opt.body);
      const favs = w.VB.portal.parseVehicles(w.VB.portal.parseHtml(fx("applicant-vehicles.html")));
      const fav = favs.find((f) => f.favId === b.get("FavoriteVehiclesId"));
      const d = b.get("Date"), vrn = b.get("VrnNumber") || (fav ? `${fav.vrn} (${fav.nick.toUpperCase()})` : "UNKNOWN");
      const period = long && new w.DOMParser().parseFromString(fx("visitor-permit-form-all.html"), "text/html").querySelector(`#VisitorVoucherPeriodId option[value="${b.get("VisitorVoucherPeriodId")}"]`);
      return reply(`<div>Number Plate ${vrn} Start Date ${d} Start Time ${b.get("FromTime")}${period ? ` Duration ${period.textContent}` : ""}</div>`, { url: u.href });
    }
    if (at("/Permit/VisitorPermit") && m === "POST" && multi) used.add(new URLSearchParams(opt.body).get("visitorPermit[PermitVehicleId]"));
    if (at("/Permit/VisitorPermit") && m === "POST") return reply(fx("permit-details.html"), { url: BASE + "/Permit/Details?permitId=1" });
    throw new Error("unexpected request " + m + " " + u.pathname);
  }
  return { fetch, calls, deleted, cancelled, created };
}

module.exports = { fakeSite, fx, MAIN, SECOND, OTHER };
