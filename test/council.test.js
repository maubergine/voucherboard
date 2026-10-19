// The app's council view script: after payment starts, the app goes back once the council's dialogs have all closed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const fx = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const src = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "council", "council.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const opened = [];
test.afterEach(() => { for (const w of opened.splice(0)) w.close(); });

function setup() {
  const dom = new JSDOM(fx("applicant-permits.html"), { url: "https://parkingpermits.lewisham.gov.uk/Home/ApplicantPermits", runScripts: "outside-only", pretendToBeVisual: true });
  opened.push(dom.window);
  dom.window.eval(src);
  return dom.window;
}

test("popupsClosed waits while a dialog or the payment frame is open, then resolves", async () => {
  const w = setup(), d = w.document;
  const modal = d.createElement("div"); modal.className = "modal in"; modal.style.display = "block";
  const frame = d.createElement("iframe"); frame.src = "about:blank#/PermitPayment/Pay";
  modal.appendChild(frame); d.body.appendChild(modal);
  let done = false;
  w.__vbCouncil.popupsClosed().then(() => { done = true; });
  await sleep(2000);
  assert.strictEqual(done, false, "still paying");
  modal.style.display = "none";
  await sleep(2300);
  assert.strictEqual(done, true, "back once nothing has been open for 1.5 s");
});

test("a hidden dialog left in the page doesn't hold it open", async () => {
  const w = setup(), d = w.document;
  const modal = d.createElement("div"); modal.className = "modal fade"; modal.style.display = "none";
  modal.appendChild(d.createElement("iframe")).src = "about:blank#/PermitPayment/Pay"; d.body.appendChild(modal);
  const t0 = Date.now();
  assert.strictEqual(await w.__vbCouncil.popupsClosed(), true);
  assert.ok(Date.now() - t0 < 2500);
});
