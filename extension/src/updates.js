// Safari only: Chrome, Edge and Firefox update from their stores, but the Safari app is a download from the GitHub
// releases, so it checks there for a newer one. At most once a day, after the terms are accepted; it sends nothing.
// Each platform has its own releases: only safari-v* ones count, and the version running is the Safari app's.
(function (root) {
  "use strict";
  const RELEASES = "https://api.github.com/repos/maubergine/voucherboard/releases";
  const PER_PAGE = 100, PAGES = 3;
  const KEY = "vb:update"; // { checked, version, url, asset, download, shown }
  const DAY_MS = 864e5;
  const ASSET = /^voucherboard-safari-([\d.]+)\.zip$/;
  const TAG = /^safari-v(\d+(?:\.\d+)*)$/;

  const isSafari = (url) => /^safari-web-extension:/.test(url || "");
  const parts = (v) => String(v || "").replace(/^(safari-)?v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  function newer(a, b) { // is a newer than b
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  const safari = (rel) => !!rel && !rel.draft && !rel.prerelease && TAG.test(rel.tag_name || "");
  // A safari-v* release counts only once its zip, of the same version, is attached: that happens after the tag, when
  // the owner approves it.
  function parse(rel) {
    if (!safari(rel)) return null;
    const version = TAG.exec(rel.tag_name)[1];
    const a = (rel.assets || []).find((x) => (ASSET.exec(x.name || "") || [])[1] === version);
    if (!a) return null;
    return { version, url: rel.html_url, asset: a.name, download: a.browser_download_url || rel.html_url };
  }
  // Releases come newest first, every platform's mixed together. This takes the newest safari-v* release with its zip,
  // stopping at the version running: nothing older can be an update.
  function pick(list, current) {
    for (const rel of list || []) {
      const p = parse(rel);
      if (p) return { found: p };
      if (safari(rel) && current && !newer(rel.tag_name, current)) return { done: true };
    }
    return {};
  }
  // Returns the stored record, refreshed if a day has passed. `available` is set when it's newer than `current`.
  async function check({ store, fetch, now = Date.now(), current }) {
    let rec = (await store.get(KEY, null)) || {};
    if (!rec.checked || now - rec.checked >= DAY_MS || now < rec.checked) {
      rec = { ...rec, checked: now };
      try {
        for (let page = 1; page <= PAGES; page++) {
          const r = await fetch(`${RELEASES}?per_page=${PER_PAGE}&page=${page}`, { headers: { Accept: "application/vnd.github+json" }, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
          const list = r.ok ? await r.json() : null;
          if (!Array.isArray(list)) break;
          const { found, done } = pick(list, current);
          if (found) { rec = { ...rec, ...found }; break; }
          if (done || list.length < PER_PAGE) break;
        }
      } catch (e) { /* offline or rate limited: try again tomorrow */ }
      await store.set(KEY, rec);
    }
    return { ...rec, available: !!rec.version && newer(rec.version, current) };
  }
  const markShown = async (store, version) => store.set(KEY, { ...((await store.get(KEY, null)) || {}), shown: version });

  const api = { RELEASES, PER_PAGE, KEY, isSafari, newer, parse, pick, check, markShown };
  root.VB = root.VB || {};
  root.VB.updates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
