// The Buy hand-off: on the permits page, open the council's own Buy Again dialog and fill it in.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(20); } throw new Error("timed out"); }

const opened = [];
test.afterEach(() => { for (const w of opened.splice(0)) w.close(); });

function setup(storage, { resetNumber = false, noDialog = false } = {}) {
  const dom = new JSDOM(fx("applicant-permits.html"), { url: "https://parkingpermits.lewisham.gov.uk/Home/ApplicantPermits", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, events = [];
  opened.push(w);
  w.chrome = { storage: { local: {
    get: async (k) => { const ks = Array.isArray(k) ? k : [k], o = {}; for (const x of ks) if (storage[x] !== undefined) o[x] = storage[x]; return o; },
    set: async (o) => Object.assign(storage, o),
    remove: async (k) => { delete storage[k]; }
  } } };
  // stands in for the site's own script: Buy Again loads the selection dialog into the page
  for (const b of w.document.querySelectorAll(".buyAgainBtn")) b.addEventListener("click", () => {
    if (noDialog) return;
    setTimeout(() => {
      const d = w.document.createElement("div"); d.className = "modal-body"; d.innerHTML = fx("voucher-select.html"); w.document.body.appendChild(d);
      const sel = w.document.getElementById("PeriodPriceIdSelected"), num = w.document.getElementById("NumberSelected");
      sel.addEventListener("change", () => { events.push("period:" + sel.value); if (resetNumber) num.value = "0"; });
      num.addEventListener("change", () => events.push("number:" + num.value));
    }, 50);
  });
  w.eval(src);
  return { w, events, storage };
}
const notice = (w) => { const n = w.document.getElementById("voucherboard-notice"); return n ? n.textContent : ""; };

test("fills the council's Buy Again dialog with the planned purchase", async () => {
  const { w, events, storage } = setup({ "vb:open": true, "vb:buy": { permitId: "x80b66f1c3b5e7742", periodPriceId: "22466", count: 3, label: "3 × 5 hours", at: Date.now() } });
  await until(() => /filled in 3 × 5 hours/.test(notice(w)));
  assert.strictEqual(w.document.getElementById("PeriodPriceIdSelected").value, "22466");
  assert.strictEqual(w.document.getElementById("NumberSelected").value, "3");
  assert.deepStrictEqual(events, ["period:22466", "number:3"], "the site's own change handlers see the values");
  assert.strictEqual(storage["vb:buy"], undefined, "used once");
  assert.strictEqual(w.document.getElementById("voucherboard-host").hidden, true, "planner stays closed so the dialog can be used");
});

test("fills the number again if the site resets it when the period changes", async () => {
  const { w } = setup({ "vb:buy": { permitId: "x80b66f1c3b5e7742", periodPriceId: "22465", count: 4, label: "4 × 1 hour", at: Date.now() } }, { resetNumber: true });
  await until(() => /filled in/.test(notice(w)));
  assert.strictEqual(w.document.getElementById("NumberSelected").value, "4");
});

test("ignores an old purchase, and says so when the dialog can't be found", async () => {
  const stale = setup({ "vb:buy": { permitId: "x80b66f1c3b5e7742", periodPriceId: "22465", count: 1, label: "1 × 1 hour", at: Date.now() - 10 * 60 * 1000 } });
  await sleep(300);
  assert.strictEqual(stale.w.document.getElementById("PeriodPriceIdSelected"), null, "Buy Again not pressed");
  assert.strictEqual(stale.storage["vb:buy"], undefined);
  const missing = setup({ "vb:buy": { permitId: "xNOPE", periodPriceId: "22465", count: 1, label: "1 × 1 hour", at: Date.now() } });
  await until(() => /couldn't find the Buy Again button/.test(notice(missing.w)));
});
