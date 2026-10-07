const test = require("node:test");
const assert = require("node:assert");
const { find } = require("../src/plates.js");

const vrns = (lines) => find(lines).map((x) => x.vrn);
const L = (text, confidence = 0.9) => ({ text, confidence });

test("finds a current-format plate, read as one or two pieces", () => {
  assert.deepStrictEqual(vrns([L("AB12 CDE")]), ["AB12CDE"]);
  assert.deepStrictEqual(vrns([L("AB12"), L("CDE")]), ["AB12CDE"]);
  assert.deepStrictEqual(vrns([L("ab12-cde")]), ["AB12CDE"]);
});

test("fixes OCR mix-ups only where the format says letter or digit", () => {
  assert.strictEqual(vrns([L("VW55 XYZ")])[0], "VW55XYZ");
  assert.strictEqual(vrns([L("VWSS XYZ")])[0], "VW55XYZ", "S read for 5 in the age digits");
  assert.strictEqual(vrns([L("TU44 VWX")])[0], "TU44VWX");
  assert.strictEqual(vrns([L("TU44 VVX")])[0], "TU44VVX", "letters stay letters");
  assert.strictEqual(vrns([L("0B12 CDE")])[0], "OB12CDE", "0 read for O in the area code");
});

test("finds older prefix, suffix and dateless plates", () => {
  assert.ok(vrns([L("A123 BCD")]).includes("A123BCD"));
  assert.ok(vrns([L("ABC 123D")]).includes("ABC123D"));
  assert.ok(vrns([L("ABC 123")]).includes("ABC123"));
});

test("ranks a real plate above words and other text on a car photo", () => {
  const r = find([L("BMW", 0.95), L("SERVICED BY", 0.7), L("GH78 JKL", 0.92), L("LONDON", 0.9), L("020 7946 0000", 0.8)]);
  assert.strictEqual(r[0].vrn, "GH78JKL");
  assert.ok(!r.some((x) => x.vrn === "LONDON"));
});

test("several cars give several plates; nothing plate-like gives none", () => {
  const r = vrns([L("AB12 CDE"), L("EF56 GHJ")]);
  assert.ok(r.includes("AB12CDE") && r.includes("EF56GHJ"));
  assert.deepStrictEqual(vrns([L("Hello"), L("No parking")]), []);
  assert.deepStrictEqual(vrns([]), []);
});

test("a read with letters the DVLA never issues isn't treated as UK, but is still offered", () => {
  const r = find([L("QB12 CDE")]).find((x) => x.vrn === "QB12CDE");
  assert.ok(r, "still offered: it may be a visitor's plate");
  assert.strictEqual(r.uk, false);
});

test("keeps foreign plates as read, below UK reads", () => {
  for (const [text, vrn] of [["AB-123-CD", "AB123CD"], ["B MD 1234", "BMD1234"], ["131-D-12345", "131D12345"], ["12-ABC-3", "12ABC3"], ["1234 BCD", "1234BCD"]]) {
    assert.ok(vrns([L(text)]).includes(vrn), `${text} → ${vrn}`);
  }
  const r = find([L("AB-123-CD", 0.95), L("GH78 JKL", 0.9)]);
  assert.strictEqual(r[0].vrn, "GH78JKL");
  assert.strictEqual(r.find((x) => x.vrn === "AB123CD").uk, false);
});

test("a UK plate read with a mix-up is offered once, in its UK form", () => {
  assert.deepStrictEqual(vrns([{ text: "KR2I FLB", confidence: 0.9 }]), ["KR21FLB"]);
  assert.deepStrictEqual(vrns([{ text: "KR2IFLB", confidence: 0.9 }]), ["KR21FLB"]);
  assert.deepStrictEqual(vrns([{ text: "AB12 CDE", confidence: 0.9 }, { text: "AB1Z CDE", confidence: 0.6 }]), ["AB12CDE"]);
});

test("doesn't take phone numbers or words without digits for plates", () => {
  assert.deepStrictEqual(vrns([L("020 7946 0000"), L("PARKING"), L("01234567890")]), []);
});

test("formats UK plates with their usual space, and others as stored", () => {
  const { format } = require("../src/plates.js");
  assert.strictEqual(format("AB12CDE"), "AB12 CDE");
  assert.strictEqual(format("A123BCD"), "A123 BCD");
  assert.strictEqual(format("ABC123D"), "ABC 123D");
  assert.strictEqual(format("ABC123"), "ABC 123");
  assert.strictEqual(format("AB123CD"), "AB123CD");
  assert.strictEqual(format("131D12345"), "131D12345");
});

test("a whole foreign read beats an old-format UK fragment of it", () => {
  assert.deepStrictEqual(vrns([L("ZX19 QRS")]), ["ZX19QRS"]);
  const r = vrns([L("AB12 CDE FR")]);
  assert.strictEqual(r[0], "AB12CDE", "a strong UK read isn't lost to a longer one");
});
