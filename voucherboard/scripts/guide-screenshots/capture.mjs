// Regenerates every screenshot in guide/img/, by driving a real headless Chrome (via puppeteer-core)
// against the harness server (server.mjs) with the clock pinned to 2026-09-28T10:30:00 — the same
// moment test/ui.test.js pins. Never contacts the real council site: harness-boot.js intercepts every
// council-shaped fetch and answers it from test/fixtures, plus one synthetic second permit (for the
// permit selector and a purchase-advice example) built in harness-boot.js itself.
//
// Usage:
//   node server.mjs &         # in one terminal
//   node capture.mjs          # in another
//
// Raw screenshots land in ./shots (gitignored). At the end, this script copies the ones the guide uses
// into ../../guide/img/, named as guide/README.md references them. Nothing else under guide/img is
// touched. If a click target has moved, the step throws — check the log, fix the selector, and rerun.
import puppeteer from "puppeteer-core";
import { mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "shots");
const GUIDE_IMG = path.join(__dirname, "..", "..", "guide", "img");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8891";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--force-prefers-reduced-motion"] });
const failures = [];

// Runs one scene in its own page; retries once (fresh page) on failure, since headless timing can be
// flaky, then logs and carries on so one bad step doesn't sink the whole run.
async function scene(name, fn) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const page = await page1280();
    try { await fn(page); return; }
    catch (e) {
      if (attempt === 2) { console.error(`[FAILED] ${name}:`, e.message); failures.push(name); }
      else console.warn(`[retry] ${name}:`, e.message);
    } finally { await page.close(); }
  }
}
async function page1280() {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  return page;
}
async function page390() {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  return page;
}

async function open(page, query, expect = "#board") {
  await page.goto(`${BASE}/index.html${query || ""}`, { waitUntil: "networkidle0" });
  await page.waitForFunction((expect) => {
    const h = document.getElementById("voucherboard-host");
    return h && h.shadowRoot && h.shadowRoot.querySelector(expect);
  }, { timeout: 15000 }, expect);
  await sleep(250);
  // app.js's resize handler starts with wasNarrow=null, so the FIRST resize event on a page always calls
  // closePop(), and Puppeteer's page.screenshot() triggers one — so a later screenshot could close a
  // popover we still need. Fire and settle a harmless one now, before anything is open.
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await sleep(200);
}
const $click = (page, sel) => page.evaluate((sel) => {
  const el = document.getElementById("voucherboard-host").shadowRoot.querySelector(sel);
  if (!el) throw new Error("not found: " + sel);
  el.click();
}, sel);
// Click a list-view row's Manage button, or tick its bulk checkbox, picking the row by a plate fragment
// (the same way test/ui.test.js's manage() helper does).
const $manageRow = (page, plateFragment) => page.evaluate((frag) => {
  const rows = [...document.getElementById("voucherboard-host").shadowRoot.querySelectorAll(".lt tbody tr")];
  const row = rows.find((r) => r.textContent.replace(/\s/g, "").includes(frag));
  if (!row) throw new Error("list row not found for " + frag);
  row.querySelector("[data-ids]").click();
}, plateFragment);
const $checkRow = (page, plateFragment) => page.evaluate((frag) => {
  const rows = [...document.getElementById("voucherboard-host").shadowRoot.querySelectorAll(".lt tbody tr")];
  const row = rows.find((r) => r.textContent.replace(/\s/g, "").includes(frag));
  if (!row) throw new Error("list row not found for " + frag);
  const box = row.querySelector("[data-bsel]");
  if (!box || box.disabled) throw new Error("row not selectable: " + frag);
  box.checked = true;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}, plateFragment);
const $set = (page, sel, val) => page.evaluate((sel, val) => {
  const sr = document.getElementById("voucherboard-host").shadowRoot, el = sr.querySelector(sel);
  el.value = val;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, sel, val);
const $check = (page, sel, val) => page.evaluate((sel, val) => {
  const sr = document.getElementById("voucherboard-host").shadowRoot, el = sr.querySelector(sel);
  el.checked = val;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, sel, val);
const $focus = (page, sel) => page.evaluate((sel) => document.getElementById("voucherboard-host").shadowRoot.querySelector(sel).focus(), sel);
const $exists = (page, sel) => page.evaluate((sel) => !!document.getElementById("voucherboard-host").shadowRoot.querySelector(sel), sel);
async function waitSel(page, sel, timeout = 12000) {
  await page.waitForFunction((sel) => {
    const sr = document.getElementById("voucherboard-host").shadowRoot;
    return sr && sr.querySelector(sel);
  }, { timeout }, sel);
  await sleep(120);
}
async function waitGone(page, sel, timeout = 12000) {
  await page.waitForFunction((sel) => {
    const sr = document.getElementById("voucherboard-host").shadowRoot;
    return sr && !sr.querySelector(sel);
  }, { timeout }, sel);
}
async function waitText(page, sel, re, timeout = 20000) {
  await page.waitForFunction((sel, reSrc) => {
    const sr = document.getElementById("voucherboard-host").shadowRoot;
    const el = sr && sr.querySelector(sel);
    return el && new RegExp(reSrc).test(el.textContent);
  }, { timeout }, sel, re.source);
}

async function shotFull(page, name) {
  await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
  console.log("shot", name);
}
// Screenshots one element, cropped tight with padding. Scrolls it into view first, since a tall aside
// panel can put it below the fold.
async function shotClip(page, name, sel, pad = 20) {
  const box = await page.evaluate((sel, pad) => {
    const sr = document.getElementById("voucherboard-host").shadowRoot;
    const el = sr.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
    return { x, y, width: Math.min(window.innerWidth - x, r.width + pad * 2), height: Math.min(window.innerHeight - y, r.height + pad * 2) };
  }, sel, pad);
  if (!box || box.width <= 0 || box.height <= 0) throw new Error("shotClip: not found or empty " + sel);
  await page.screenshot({ path: path.join(OUT, name + ".png"), clip: box });
  console.log("shot", name);
}
// Screenshots the union of two elements (e.g. a combo box and its dropdown list, which sits outside the
// box's own layout box since it's position:absolute).
async function shotClipUnion(page, name, selA, selB, pad = 10) {
  const box = await page.evaluate((selA, selB, pad) => {
    const sr = document.getElementById("voucherboard-host").shadowRoot;
    const a = sr.querySelector(selA).getBoundingClientRect(), b = sr.querySelector(selB).getBoundingClientRect();
    const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top), right = Math.max(a.right, b.right), bottom = Math.max(a.bottom, b.bottom);
    const x = Math.max(0, left - pad), y = Math.max(0, top - pad);
    return { x, y, width: (right - left) + pad * 2, height: Math.min(window.innerHeight - y, (bottom - top) + pad * 2) };
  }, selA, selB, pad);
  await page.screenshot({ path: path.join(OUT, name + ".png"), clip: box });
  console.log("shot", name);
}

await scene("01-launcher", async (page) => {
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle0" });
  await sleep(250);
  await shotFull(page, "01-launcher");
});

await scene("02-terms-gate", async (page) => {
  await open(page, "?terms=0&open=1", ".terms-gate");
  await shotFull(page, "02-terms-gate");
});

await scene("planner-and-composer", async (page) => {
  await open(page, "?open=1");
  await shotFull(page, "03-week-view");
  await shotClip(page, "04-zone-balance", ".subbar", 10);

  await $click(page, '[data-view="day"]');
  await sleep(200);
  await shotFull(page, "05-day-view");

  await $click(page, '[data-view="list"]');
  await sleep(200);
  await shotFull(page, "06-list-view");
  await $click(page, '[data-view="week"]');
  await sleep(200);

  // booking popover, change time, cancel confirm (Blair Visitor's upcoming VW55XYZ booking)
  await $click(page, '[data-view="list"]');
  await sleep(150);
  await $manageRow(page, "VW55XYZ");
  await waitSel(page, ".pop");
  await shotClip(page, "14-booking-popover", ".pop");
  await $click(page, "#pChange");
  await waitSel(page, "#edFrom");
  await shotClip(page, "16-change-time", ".pop");
  await $click(page, "#edBack");
  await waitGone(page, "#edFrom");
  await $manageRow(page, "VW55XYZ");
  await waitSel(page, ".pop");
  await $click(page, "#pCancel");
  await waitSel(page, "#pYes");
  await shotClip(page, "15-cancel-confirm", ".pop");
  await $click(page, "#pNo"); // don't actually cancel
  await waitGone(page, ".pop");

  // bulk manage: turned on, then the change-time panel with rows ticked
  await $click(page, "#bulkBtn");
  await sleep(150);
  await shotFull(page, "21-bulk-manage");
  await $checkRow(page, "VW55XYZ");
  await sleep(150);
  await $click(page, "#bkTime");
  await waitSel(page, ".bulkpanel");
  await shotClip(page, "22-bulk-change-time", ".bulkpanel", 12);
  await $click(page, "#bkClose");
  await sleep(150);
  await $click(page, "#bulkBtn"); // back to Done
  await $click(page, '[data-view="week"]');
  await sleep(150);

  // plan panel, after adding a booking, with the cost breakdown open
  const hasCost = await $exists(page, "#costBox");
  if (hasCost) { await $click(page, "#costBox summary"); await sleep(150); }
  await shotClip(page, "11-plan-panel", "aside.composer", 0);
});

await scene("composer-sections", async (page) => {
  await open(page, "?open=1&plan=0");
  await $focus(page, "#vq");
  await sleep(200);
  await shotClipUnion(page, "07-composer-vehicle", ".combo", "#vlist");

  const sectionWith = async (id) => page.evaluate((id) => {
    const sr = document.getElementById("voucherboard-host").shadowRoot;
    const el = [...sr.querySelectorAll(".c-sec")].find((s) => s.querySelector(id));
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 10), width: r.width + 20, height: r.height + 20 };
  }, id);
  await page.screenshot({ path: path.join(OUT, "09-composer-days.png"), clip: await sectionWith("#dquick") });
  console.log("shot 09-composer-days");
  await page.screenshot({ path: path.join(OUT, "10-composer-time.png"), clip: await sectionWith("#tquick") });
  console.log("shot 10-composer-time");

  // new one-off plate prompt
  await $set(page, "#vq", "ZZ11ZZZ");
  await sleep(150);
  await $click(page, "#vlist .opt[data-new]");
  await waitSel(page, "#nvSave");
  await $check(page, "#nvSave", true);
  await sleep(150);
  await shotClip(page, "08-composer-new-vehicle", ".newv", 16);
});

await scene("end-early", async (page) => {
  // beta off: the in-progress popover just points at Settings
  await open(page, "?open=1");
  await $click(page, '[data-view="list"]');
  await sleep(200);
  await $manageRow(page, "TU44VWX");
  await waitSel(page, ".pop");
  await shotFull(page, "17-in-progress-popover");
});
await scene("end-early-beta-on", async (page) => {
  await open(page, "?open=1&beta=1");
  await $click(page, '[data-view="list"]');
  await sleep(200);
  await $manageRow(page, "TU44VWX");
  await waitSel(page, ".pop");
  await $click(page, "#pShrink");
  await waitSel(page, "#shYes");
  await shotClip(page, "18-end-early", ".pop");
});

await scene("favourites", async (page) => {
  await open(page, "?open=1");
  await $click(page, "#grpPast");
  await sleep(200);
  await $click(page, '[data-vpop="NP22RST"]');
  await waitSel(page, "#fvNick");
  await $set(page, "#fvNick", "Nina");
  await sleep(150);
  await shotClip(page, "20-save-favourite", ".pop");
  await $click(page, "#fvNo");
  await waitGone(page, ".pop");

  await $click(page, '[data-vpop="LM11NPR"]'); // Casey Visitor, a favourite
  await waitSel(page, "#vDel");
  await $click(page, "#vDel");
  await waitSel(page, "#vYes");
  await shotClip(page, "19-favourite-popover", ".pop");
});

await scene("purchase-advice", async (page) => {
  await open(page, "?open=1&advice=1");
  await page.evaluate(() => {
    const sr = document.getElementById("voucherboard-host").shadowRoot, sel = sr.querySelector("#permitSel");
    sel.value = "xsecondpermit0042";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitText(page, "#summary", /Save £/, 15000);
  await waitSel(page, ".advice");
  await shotClip(page, "12-purchase-advice", ".advice", 12);
});

await scene("buy-handoff", async (page) => {
  await page.goto(`${BASE}/buy.html`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => /filled in/.test((document.getElementById("voucherboard-notice") || {}).textContent || ""), { timeout: 20000 });
  await sleep(250);
  await shotFull(page, "13-buy-handoff");
});

await scene("settings-and-tags", async (page) => {
  await open(page, "?open=1");
  await $click(page, "#settingsBtn");
  await waitSel(page, ".modal");
  await shotClip(page, "23-settings-modal", ".modal", 0);
});
await scene("test-mode-tag", async (page) => {
  await open(page, "?open=1&testmode=1");
  await shotClip(page, "24-test-mode-tag", ".toppanel .brand", 10);
});
await scene("terms-modal", async (page) => {
  await open(page, "?open=1");
  await $click(page, "#termsBtn");
  await waitSel(page, ".modal");
  await shotClip(page, "29-terms-modal", ".modal", 0);
});

await scene("review-test-mode", async (page) => {
  await open(page, "?open=1&testmode=1");
  await $click(page, "#review");
  await waitSel(page, ".modal");
  await shotClip(page, "25-review-modal", ".modal", 0);
  await $click(page, "#rvGo");
  await sleep(350); // mid-run: GAP_MS is the real 500ms, so this lands between requests
  await shotClip(page, "26-review-progress", ".modal", 0);
  await waitText(page, "#rvGo", /^Done$/, 20000);
  await sleep(200);
  await shotClip(page, "27-review-success", ".modal", 0);
});

await scene("review-error", async (page) => {
  const entries = [{ id: 1, vrn: "AB12CDE", dk: "2026-09-29", from: 630, to: 690 }];
  await open(page, `?open=1&nonenforced=1&entries=${encodeURIComponent(b64(entries))}`);
  await $click(page, "#review");
  await waitSel(page, ".modal");
  await $click(page, "#rvGo");
  await waitText(page, "#rvGo", /^Done$/, 20000);
  await sleep(200);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true }));
  const hasCopy = await page.evaluate(() => !document.getElementById("voucherboard-host").shadowRoot.querySelector("#rvCopy").hidden);
  if (hasCopy) { await $click(page, "#rvCopy"); await sleep(200); }
  await shotClip(page, "28-review-error", ".modal", 0);
});

// This scene needs a 390px page, not the default 1280px one scene() creates, so it manages its own.
{
  const page = await page390();
  try {
    await page.goto(`${BASE}/index.html?open=1`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => {
      const h = document.getElementById("voucherboard-host");
      return h && h.shadowRoot && h.shadowRoot.querySelector("#board");
    }, { timeout: 15000 });
    await sleep(250);
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await sleep(200);
    await shotFull(page, "30-mobile-week");
    await page.evaluate(() => {
      const sr = document.getElementById("voucherboard-host").shadowRoot;
      sr.querySelector("#plan").scrollIntoView({ block: "center" });
    });
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, "31-mobile-bar.png") }); // viewport only: the bar is fixed to the screen
    console.log("shot 31-mobile-bar");
  } catch (e) { console.error("[FAILED] mobile:", e.message); failures.push("mobile"); }
  finally { await page.close(); }
}

await browser.close();

// ---------- copy the curated set into guide/img, named as guide/README.md references them ----------
const CURATED = [
  "01-launcher", "02-terms-gate", "03-week-view", "04-zone-balance", "05-day-view", "06-list-view",
  "07-composer-vehicle", "08-composer-new-vehicle", "09-composer-days", "10-composer-time", "11-plan-panel",
  "12-purchase-advice", "13-buy-handoff", "14-booking-popover", "15-cancel-confirm", "16-change-time",
  "17-in-progress-popover", "18-end-early", "19-favourite-popover", "20-save-favourite", "21-bulk-manage",
  "22-bulk-change-time", "23-settings-modal", "24-test-mode-tag", "25-review-modal", "26-review-progress",
  "27-review-success", "28-review-error", "29-terms-modal", "30-mobile-week", "31-mobile-bar"
];
// Taken by hand on the live site (redacted), so a rerun doesn't replace them with the stand-in pages.
const KEEP = new Set(["01-launcher", "13-buy-handoff"]);
let copied = 0;
for (const name of CURATED.filter((n) => !KEEP.has(n))) {
  const from = path.join(OUT, name + ".png"), to = path.join(GUIDE_IMG, name + ".png");
  try { copyFileSync(from, to); copied++; } catch (e) { console.error("[missing]", name, "-", e.message); }
}
console.log(`copied ${copied}/${CURATED.length - KEEP.size} into ${GUIDE_IMG} (kept ${[...KEEP].join(", ")})`);
if (failures.length) { console.error("FAILED scenes:", failures.join(", ")); process.exitCode = 1; }
