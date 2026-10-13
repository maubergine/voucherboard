// A fake council site for the jsdom tests: routes the planner's requests to the saved pages in fixtures/.
// Records calls, and which bookings were cancelled and favourites deleted or created. No network.
const fs = require("node:fs");
const path = require("node:path");

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const BASE = "https://parkingpermits.lewisham.gov.uk";

function fakeSite(w, { nonEnforced = false, zone = null, loggedOut = false } = {}) {
  const calls = [], deleted = new Set(), cancelled = new Set(), created = [];
  const zoned = (html) => (zone ? html.replaceAll("P - Hither Green East", zone) : html);
  const vehiclesPage = () => {
    if (!deleted.size && !created.length) return fx("applicant-vehicles.html");
    const d = new w.DOMParser().parseFromString(fx("applicant-vehicles.html"), "text/html");
    for (const t of d.querySelectorAll(".hometile")) { const i = t.querySelector('input[name="item.Id"]'); if (i && deleted.has(i.value)) t.remove(); }
    for (const c of created) d.querySelector("#vehicleContainer").insertAdjacentHTML("beforeend", `<div class="hometile"><input name="item.Id" type="hidden" value="${c.id}"><label class="names">${c.name}</label><div id="Vrn">${c.vrn}</div></div>`);
    return d.documentElement.outerHTML;
  };
  const detailsPage = () => {
    if (!cancelled.size) return zoned(fx("permit-details.html"));
    const d = new w.DOMParser().parseFromString(fx("permit-details.html"), "text/html");
    for (const c of d.querySelectorAll(".used-vouchers")) if ([...c.querySelectorAll("[data-id]")].some((x) => cancelled.has(x.getAttribute("data-id")))) c.remove();
    return d.documentElement.outerHTML;
  };
  const reply = (body, { url, json } = {}) => ({ ok: true, status: 200, url: url || "", text: async () => body, json: async () => (json !== undefined ? json : JSON.parse(body)) });
  async function fetch(p, opt = {}) {
    const u = new URL(p, BASE + "/Home/Index"), m = (opt.method || "GET").toUpperCase();
    calls.push({ m, path: u.pathname, body: opt.body || "" });
    if (loggedOut) return reply(`<form action="/Account/Login"><input type="password"></form>`, { url: BASE + "/Account/Login?ReturnUrl=" + encodeURIComponent(u.pathname) });
    const at = (x) => u.pathname === x;
    if (at("/Home/ApplicantPermits")) return reply(zoned(fx("applicant-permits.html")), { url: u.href });
    if (at("/Permit/Details")) return reply(detailsPage(), { url: u.href });
    if (at("/Home/ApplicantVehicles")) return reply(vehiclesPage(), { url: u.href });
    if (at("/Permit/CancelVoucherConfirmationPopup")) return reply(fx("cancel-popup.html").replace("xd771d26b887ce0ee", u.searchParams.get("permitVehicleId")), { url: u.href });
    if (at("/Permit/CancelVisitorVoucher")) { cancelled.add(new URLSearchParams(opt.body).get("Id")); return reply("", { url: BASE + "/Permit/Details?permitId=x80b66f1c3b5e7742" }); }
    if (at("/Permit/VerifyNicknameOfVisitorVoucher")) return reply("", { json: { Result: "Success" } });
    if (at("/FavouriteVehicle/Create") && m === "GET") return reply(fx("favourite-create-popup.html"), { url: u.href });
    if (at("/FavouriteVehicle/Create") && m === "POST") { const b = new URLSearchParams(opt.body); created.push({ id: "xnew" + created.length, name: b.get("Name"), vrn: b.get("Vrn") }); return reply("", { url: BASE + "/Home/ApplicantVehicles" }); }
    if (at("/FavouriteVehicle/Delete") && m === "GET") return reply(fx("favourite-delete-popup.html").replace("x7611b00bb2be593e", u.searchParams.get("id")), { url: u.href });
    if (at("/FavouriteVehicle/Delete") && m === "POST") { deleted.add(new URLSearchParams(opt.body).get("Id")); return reply("", { url: BASE + "/Home/ApplicantVehicles" }); }
    if (at("/VoucherBuyAgain/VoucherSelect")) return reply(fx("voucher-select.html"), { url: u.href });
    if (at("/Permit/VisitorPermit") && m === "GET") return reply(fx("visitor-permit-form.html"), { url: u.href });
    if (at("/Permit/GetNonEnforceableCoverage")) return reply("", { json: nonEnforced ? { Result: "Error", message: "The date or time you have selected is during non-enforcement hours" } : { Result: "Success" } });
    if (at("/Permit/VerifyDateTimeOfVisitorVoucher")) return reply("", { json: { Message: "" } });
    if (at("/Permit/GetVisitorVoucherConfirmation")) {
      const b = new URLSearchParams(opt.body);
      const favs = w.VB.portal.parseVehicles(w.VB.portal.parseHtml(fx("applicant-vehicles.html")));
      const fav = favs.find((f) => f.favId === b.get("FavoriteVehiclesId"));
      const d = b.get("Date"), vrn = b.get("VrnNumber") || (fav ? `${fav.vrn} (${fav.nick.toUpperCase()})` : "UNKNOWN");
      return reply(`<div>Number Plate ${vrn} Start Date ${d} Start Time ${b.get("FromTime")}</div>`, { url: u.href });
    }
    if (at("/Permit/VisitorPermit") && m === "POST") return reply(fx("permit-details.html"), { url: BASE + "/Permit/Details?permitId=1" });
    throw new Error("unexpected request " + m + " " + u.pathname);
  }
  return { fetch, calls, deleted, cancelled, created };
}

module.exports = { fakeSite, fx };
