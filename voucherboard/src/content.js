// Entry point on the council permit site: adds a "Voucherboard" button and opens the planner over the page.
(function () {
  "use strict";
  if (window.top !== window) return; // never inside frames

  // Stay out of anything to do with payment or signing in, even if the manifest's exclusions miss a page.
  const blocked = /\/(PermitPayment|VoucherBuyAgain|Payment|Account)(\/|$)/i.test(location.pathname)
    || document.querySelector('input[name*="Card" i], input[autocomplete^="cc-"], input[type="password"], form[action*="securesuite" i]');
  if (blocked) return;

  const launcher = document.createElement("button");
  launcher.type = "button";
  launcher.textContent = "Voucherboard Beta";
  launcher.setAttribute("aria-label", "Open Voucherboard beta visitor permit planner");
  Object.assign(launcher.style, {
    position: "fixed", right: "16px", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", zIndex: "2147483000",
    background: "#2b4972", color: "#fff", border: "0", borderRadius: "24px", padding: "0 20px", minHeight: "48px",
    font: "700 15px 'Nunito Sans', system-ui, sans-serif", boxShadow: "0 8px 24px -8px rgba(32,44,83,.6)", cursor: "pointer"
  });

  const host = document.createElement("div");
  host.id = "voucherboard-host";
  host.hidden = true;
  Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "2147483001", overflow: "auto", background: "#f6f8fb", WebkitOverflowScrolling: "touch" });

  let app = null;
  async function open() {
    if (!app) { app = VB.app.create(host); app.onClose = () => { launcher.hidden = false; }; }
    launcher.hidden = true;
    await app.open();
  }
  launcher.addEventListener("click", open);

  document.documentElement.append(host, launcher);

  // ---------- buy hand-off ----------
  // The planner's Buy button saves what to buy and comes here, to the permits page. This opens the council's own
  // Buy Again dialog for that permit and fills in the period and number. The user checks it and presses Buy and Pay
  // themselves; Voucherboard never runs on the payment page.
  const BUY_MAX_AGE = 5 * 60 * 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) { const t0 = Date.now(); for (;;) { const v = fn(); if (v || Date.now() - t0 > ms) return v; await sleep(100); } }
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  function notice(msg, ok) {
    const old = document.getElementById("voucherboard-notice"); if (old) old.remove();
    const n = document.createElement("div");
    n.id = "voucherboard-notice"; n.setAttribute("role", "status");
    Object.assign(n.style, {
      position: "fixed", left: "16px", right: "16px", bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", zIndex: "2147483000", maxWidth: "520px", margin: "0 auto",
      background: ok ? "#2b4972" : "#a94442", color: "#fff", borderRadius: "8px", padding: "12px 44px 12px 14px",
      font: "600 14px/1.4 'Nunito Sans', system-ui, sans-serif", boxShadow: "0 8px 24px -8px rgba(32,44,83,.6)"
    });
    n.textContent = msg;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Dismiss");
    Object.assign(x.style, { position: "absolute", top: "6px", right: "8px", background: "transparent", border: "0", color: "#fff", font: "700 20px sans-serif", cursor: "pointer" });
    x.onclick = () => n.remove();
    n.appendChild(x);
    document.documentElement.appendChild(n);
    setTimeout(() => n.remove(), 20000);
  }
  async function buyHandoff() {
    let intent = null;
    try { intent = (await chrome.storage.local.get("vb:buy"))["vb:buy"]; await chrome.storage.local.remove("vb:buy"); } catch (e) { return false; }
    if (!intent || Date.now() - intent.at > BUY_MAX_AGE) return false;
    const manual = " Use Buy Again on your permit instead.";
    const btn = [...document.querySelectorAll(".buyAgainBtn")].find((b) => b.getAttribute("data-permitid") === intent.permitId);
    if (!btn) { notice("Voucherboard couldn't find the Buy Again button for your permit." + manual); return true; }
    btn.scrollIntoView && btn.scrollIntoView({ block: "center" });
    btn.click();
    const sel = await waitFor(() => document.getElementById("PeriodPriceIdSelected"), 10000);
    const num = sel && await waitFor(() => document.getElementById("NumberSelected"), 2000);
    if (!sel || !num) { notice("The council's Buy Again dialog didn't open." + manual); return true; }
    if (![...sel.options].some((o) => o.value === String(intent.periodPriceId))) { notice(`The council's dialog doesn't offer that voucher. Choose ${intent.label} yourself.`); return true; }
    const fill = () => { sel.value = String(intent.periodPriceId); fire(sel, "change"); num.value = String(intent.count); fire(num, "input"); fire(num, "change"); };
    fill();
    await sleep(400);
    if (sel.value !== String(intent.periodPriceId) || num.value !== String(intent.count)) fill(); // the site may reset the number when the period changes
    num.focus();
    notice(`Voucherboard filled in ${intent.label}. Check it, then press Buy and pay on the council's page. Voucherboard reopens afterwards.`, true);
    return true;
  }
  (window.VB = window.VB || {}).buyHandoff = buyHandoff;

  // Reopen straight away when coming back from the council's own pages, if the planner was left open.
  // A pending purchase comes first: the planner stays closed so the council's dialog can be used.
  try {
    chrome.storage.local.get(["vb:open", "vb:buy"]).then(async (r) => {
      if (r["vb:buy"] && await buyHandoff()) return;
      if (r["vb:open"]) open();
    });
    const setOpen = (v) => chrome.storage.local.set({ "vb:open": v });
    launcher.addEventListener("click", () => setOpen(true));
    host.addEventListener("click", (e) => { const t = e.composedPath()[0]; if (t && t.id === "close") setOpen(false); });
  } catch (e) { /* storage unavailable */ }
})();
