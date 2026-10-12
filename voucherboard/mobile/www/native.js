// The UI side of the mobile bridge (mobile/BRIDGE.md). VBNative.call(cmd, args) talks to the iOS or Android shell;
// in a desktop browser, a page can set window.VBDev = { call(cmd, args) } first, to run the UI against stubs.
(function (root) {
  "use strict";
  const listeners = {};
  const pending = new Map();
  let seq = 0, platform = "none";

  let send;
  const ios = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.vb;
  if (ios) {
    platform = "ios";
    send = (cmd, args) => ios.postMessage({ cmd, args: args || {} });
  } else if (root.vbNative && typeof root.vbNative.postMessage === "function") {
    platform = "android";
    root.vbNative.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value === undefined ? null : m.value); else p.reject(new Error(m.error || "failed"));
    };
    send = (cmd, args) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      root.vbNative.postMessage(JSON.stringify({ id, cmd, args: args || {} }));
    });
  } else if (root.VBDev) {
    platform = "dev";
    send = (cmd, args) => root.VBDev.call(cmd, args || {});
  } else {
    send = () => Promise.reject(new Error("Voucherboard's app shell isn't available."));
  }

  const api = {
    get platform() { return platform; },
    get available() { return platform !== "none"; },
    call: (cmd, args) => Promise.resolve().then(() => send(cmd, args)),
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    // Native calls this. Returns the last listener's result, so "back" can say whether the UI handled it.
    emit(name, data) { let r; for (const fn of listeners[name] || []) { try { r = fn(data || {}); } catch (e) { /* keep going */ } } return r; },

    // Same shape as a fetch Response, for VB.portal.transport.
    async transport(path, opt) {
      const r = await api.call("council.fetch", { method: opt.method || "GET", path: String(path), headers: opt.headers || {}, body: opt.body == null ? null : String(opt.body) });
      if (!r || r.error) throw new Error((r && r.error) || "network");
      return { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url || "", text: async () => r.body || "", json: async () => JSON.parse(r.body || "") };
    },
    store: {
      async get(key, dflt) { try { const v = await api.call("store.get", { key }); return v == null ? dflt : v; } catch (e) { return dflt; } },
      async set(key, value) { try { await api.call("store.set", { key, value }); } catch (e) { /* storage unavailable */ } },
      async remove(key) { try { await api.call("store.remove", { key }); } catch (e) { /* storage unavailable */ } }
    }
  };

  // Links to anywhere else open in the system browser; the UI view never leaves the app bundle.
  root.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || !/^https:/i.test(a.getAttribute("href"))) return;
    e.preventDefault();
    api.call("openExternal", { url: a.href }).catch(() => {});
  });

  root.VBNative = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
