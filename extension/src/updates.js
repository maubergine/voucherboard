// Safari only: Chrome, Edge and Firefox update from their stores, but the Safari app is a download from the GitHub
// release, so it checks there for a newer one. At most once a day, after the terms are accepted; it sends nothing.
(function (root) {
  "use strict";
  const LATEST = "https://api.github.com/repos/maubergine/voucherboard/releases/latest";
  const KEY = "vb:update"; // { checked, version, url, asset, download, shown }
  const DAY_MS = 864e5;
  const ASSET = /^voucherboard-safari-([\d.]+)\.zip$/i; // Voucherboard-Safari- before 0.7.3

  const isSafari = (url) => /^safari-web-extension:/.test(url || "");
  const parts = (v) => String(v || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  function newer(a, b) { // is a newer than b
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  // A release counts only once its Safari zip is attached: that happens after the tag, when the owner approves it.
  function parse(rel) {
    if (!rel || rel.draft || rel.prerelease) return null;
    const a = (rel.assets || []).find((x) => ASSET.test(x.name || ""));
    if (!a) return null;
    return { version: ASSET.exec(a.name)[1], url: rel.html_url, asset: a.name, download: a.browser_download_url || rel.html_url };
  }
  // Returns the stored record, refreshed if a day has passed. `available` is set when it's newer than `current`.
  async function check({ store, fetch, now = Date.now(), current }) {
    let rec = (await store.get(KEY, null)) || {};
    if (!rec.checked || now - rec.checked >= DAY_MS || now < rec.checked) {
      rec = { ...rec, checked: now };
      try {
        const r = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
        const rel = r.ok ? parse(await r.json()) : null;
        if (rel) rec = { ...rec, ...rel };
      } catch (e) { /* offline or rate limited: try again tomorrow */ }
      await store.set(KEY, rec);
    }
    return { ...rec, available: !!rec.version && newer(rec.version, current) };
  }
  const markShown = async (store, version) => store.set(KEY, { ...((await store.get(KEY, null)) || {}), shown: version });

  const api = { LATEST, KEY, isSafari, newer, parse, check, markShown };
  root.VB = root.VB || {};
  root.VB.updates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
