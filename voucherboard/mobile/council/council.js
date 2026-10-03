// Runs in the mobile app's council view, on the council site only (see mobile/BRIDGE.md). It carries the planner's
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

  function notice(msg, ok) {
    const old = document.getElementById("voucherboard-notice"); if (old) old.remove();
    const n = document.createElement("div");
    n.id = "voucherboard-notice"; n.setAttribute("role", "status"); n.textContent = msg;
    Object.assign(n.style, {
      position: "fixed", left: "12px", right: "12px", bottom: "calc(12px + env(safe-area-inset-bottom, 0px))", zIndex: "2147483000",
      background: ok ? "#2b4972" : "#a94442", color: "#fff", borderRadius: "10px", padding: "12px 14px",
      font: "600 15px/1.4 system-ui, -apple-system, sans-serif", boxShadow: "0 8px 24px -8px rgba(32,44,83,.6)"
    });
    n.onclick = () => n.remove();
    document.documentElement.appendChild(n);
    setTimeout(() => n.remove(), 20000);
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
      notice(r.message, r.ok);
      return r.ok;
    },
    ready: () => !blockedPage()
  };
})();
