// Runs in the mobile app's council view, on the council site only (see apps/mobile/BRIDGE.md). It carries the planner's
// requests as same-origin fetches in the user's own session, and fills in the Buy Again dialog. Nothing else.
(function () {
  "use strict";
  if (window.top !== window || location.hostname !== "parkingpermits.lewisham.gov.uk") return;
  const blockedPath = () => /\/(PermitPayment|VoucherBuyAgain|Payment|Account)(\/|$)/i.test(location.pathname);
  const blockedPage = () => blockedPath() || !!document.querySelector('input[name*="Card" i], input[autocomplete^="cc-"], input[type="password"], form[action*="securesuite" i]');

  async function councilFetch(req) {
    if (blockedPage()) throw new Error("blocked");
    const path = String(req.path || "");
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("bad path");
    const res = await fetch(path, { method: req.method || "GET", headers: req.headers || {}, body: req.body == null ? null : req.body, credentials: "same-origin", redirect: "follow", cache: "no-store" });
    return { status: res.status, url: res.url, body: await res.text() };
  }

  // times: the app's "Messages stay" setting, a multiple of 8 seconds (this note is longer than the app's own); 0 keeps it until closed.
  function notice(msg, ok, times) {
    const old = document.getElementById("voucherboard-notice"); if (old) old.remove();
    const n = document.createElement("div");
    n.id = "voucherboard-notice"; n.setAttribute("role", "status"); n.textContent = msg;
    Object.assign(n.style, {
      // At the top and click-through: the filled-in number box sits just above the keyboard, so the note mustn't cover it or catch its taps.
      position: "fixed", left: "12px", right: "12px", top: "12px", zIndex: "2147483000", pointerEvents: "none",
      background: ok ? "#2b4972" : "#a94442", color: "#fff", borderRadius: "10px", padding: "12px 48px 12px 14px",
      font: "600 15px/1.4 system-ui, -apple-system, sans-serif", boxShadow: "0 8px 24px -8px rgba(32,44,83,.6)"
    });
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Close");
    Object.assign(x.style, { position: "absolute", top: "2px", right: "2px", width: "44px", height: "44px", background: "transparent", border: "0", color: "#fff", font: "700 24px/1 system-ui, sans-serif", cursor: "pointer", pointerEvents: "auto" });
    const close = () => { n.remove(); document.removeEventListener("input", typed, true); };
    const typed = (e) => { if (e.isTrusted) close(); };
    x.onclick = close;
    n.appendChild(x);
    document.documentElement.appendChild(n);
    document.addEventListener("input", typed, true);
    const t = Number.isInteger(times) && times >= 0 && times <= 10 ? times : 1;
    if (t) setTimeout(close, 8000 * t);
  }

  window.__vbCouncil = {
    fetch: councilFetch,
    // Android: no awaitable evaluateJavascript, so the result comes back on the vbCouncil message channel.
    fetchAndPost(id, req) {
      const post = (o) => window.vbCouncil.postMessage(JSON.stringify(Object.assign({ id }, o)));
      councilFetch(req).then(post, (e) => post({ error: e && e.message === "blocked" ? "blocked" : "network" }));
    },
    async buy(intent) {
      if (blockedPage() || !/^\/Home\/ApplicantPermits/i.test(location.pathname) || typeof window.VB === "undefined") return false;
      const r = await window.VB.buyFill(document, intent);
      notice(r.message, r.ok, intent.messageTime);
      return r.ok;
    },
    // After payment starts, the app waits on this to go back by itself. It looks only at this page's own dialogs (the
    // payment frame sits in one), never inside the frame: true once none has been open for 1.5 s, so the step from one
    // dialog to the next doesn't count.
    popupsClosed() {
      const shown = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden") return false; } return true; };
      const open = () => [...document.querySelectorAll(".modal, .modal-backdrop, iframe[src*='Payment' i]")].some(shown);
      return new Promise((done) => {
        let since = 0;
        const t = setInterval(() => {
          if (open()) since = 0; else if (!since) since = Date.now(); else if (Date.now() - since >= 1500) { clearInterval(t); done(true); }
        }, 250);
      });
    },
    ready: () => !blockedPage()
  };
})();
