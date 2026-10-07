// Fills in the council's own Buy Again dialog on its permits page. Used by the extension's content.js and by the
// mobile app's council view. It never presses Buy: the user checks the dialog and pays on the council's page.
(function (root) {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms) { const t0 = Date.now(); for (;;) { const v = fn(); if (v || Date.now() - t0 > ms) return v; await sleep(100); } }

  // intent: { permitId, periodPriceId, count, label }. Resolves to { ok, message } for the notice to show.
  async function buyFill(doc, intent) {
    const manual = " Use Buy Again on your permit instead.";
    const fire = (el, type) => el.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true }));
    const btn = [...doc.querySelectorAll(".buyAgainBtn")].find((b) => b.getAttribute("data-permitid") === intent.permitId);
    if (!btn) return { ok: false, message: "Voucherboard couldn't find the Buy Again button for your permit." + manual };
    if (btn.scrollIntoView) btn.scrollIntoView({ block: "center" });
    btn.click();
    const sel = await waitFor(() => doc.getElementById("PeriodPriceIdSelected"), 10000);
    const num = sel && await waitFor(() => doc.getElementById("NumberSelected"), 2000);
    if (!sel || !num) return { ok: false, message: "The council's Buy Again dialog didn't open." + manual };
    if (![...sel.options].some((o) => o.value === String(intent.periodPriceId))) return { ok: false, message: `The council's dialog doesn't offer that voucher. Choose ${intent.label} yourself.` };
    const fill = () => { sel.value = String(intent.periodPriceId); fire(sel, "change"); num.value = String(intent.count); fire(num, "input"); fire(num, "change"); };
    fill();
    await sleep(400);
    if (sel.value !== String(intent.periodPriceId) || num.value !== String(intent.count)) fill(); // the site may reset the number when the period changes
    num.focus();
    return { ok: true, message: `Voucherboard filled in ${intent.label}. Check it, then press Buy and pay on the council's page. Voucherboard reopens afterwards.` };
  }

  root.VB = root.VB || {};
  root.VB.buyFill = buyFill;
})(typeof globalThis !== "undefined" ? globalThis : this);
