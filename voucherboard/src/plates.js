// Finds number plates in text read from a photo (on the phone, by Vision or ML Kit), and formats plates for display.
// Pure; no DOM or network. UK formats rank first and get OCR mix-ups fixed; any other plate-like run of letters
// and digits on one line (a visitor's foreign plate) is kept too, as read.
// find(lines): lines are [{ text, confidence }] in reading order. Returns [{ vrn, score, fixed, uk }], best first.
(function (root) {
  "use strict";
  // L = letter, D = digit. Current (AB12 CDE), prefix (A123 BCD), suffix (ABC 123D), dateless (ABC 123, 1234 AB).
  const FORMATS = [
    { re: /^LLDDLLL$/, w: 1 },
    { re: /^LD{1,3}LLL$/, w: 0.9 },
    { re: /^LLLD{1,3}L$/, w: 0.85 },
    { re: /^L{1,3}D{1,4}$/, w: 0.6, min: 3, exact: true },
    { re: /^D{1,4}L{1,3}$/, w: 0.55, min: 3, exact: true }
  ];
  // OCR mix-ups, fixed only where the format says which kind of character belongs.
  const TO_L = { 0: "O", 1: "I", 2: "Z", 4: "A", 5: "S", 6: "G", 8: "B" };
  const TO_D = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", T: "1", Z: "2", A: "4", S: "5", G: "6", B: "8" };
  const isL = (c) => c >= "A" && c <= "Z", isD = (c) => c >= "0" && c <= "9";

  // Every L/D shape the string could have, if mix-ups were fixed, with how many fixes each needs.
  function readAs(s, shape) {
    let out = "", fixed = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i], want = shape[i];
      if (want === "L") { if (isL(c)) out += c; else if (TO_L[c]) { out += TO_L[c]; fixed++; } else return null; }
      else { if (isD(c)) out += c; else if (TO_D[c]) { out += TO_D[c]; fixed++; } else return null; }
    }
    return { vrn: out, fixed };
  }
  // The shapes each format allows at this length, e.g. "LDDDLLL" for a 7-character prefix plate.
  function shapes(n) {
    const out = [];
    for (let m = 0; m < 1 << n; m++) {
      let s = ""; for (let i = 0; i < n; i++) s += m & (1 << i) ? "D" : "L";
      const f = FORMATS.find((x) => x.re.test(s) && n >= (x.min || 0));
      if (f) out.push({ shape: s, w: f.w, maxFix: f.exact ? 0 : f.w === 1 ? 2 : 1 });
    }
    return out;
  }
  const SHAPES = {}; for (let n = 2; n <= 7; n++) SHAPES[n] = shapes(n);

  function best(s) {
    let top = null;
    for (const { shape, w, maxFix } of SHAPES[s.length] || []) {
      const r = readAs(s, shape); if (!r || r.fixed > maxFix) continue;
      // the current format has no I, Q or Z in the area code, and no I or Q in the last three
      if (shape === "LLDDLLL" && (/[IQZ]/.test(r.vrn.slice(0, 2)) || /[IQ]/.test(r.vrn.slice(4)))) continue;
      const score = w - 0.12 * r.fixed;
      if (!top || score > top.score) top = { vrn: r.vrn, score, fixed: r.fixed, shape, uk: true, weak: w < 0.8 };
    }
    return top;
  }

  // Anything else that could be a plate: 4 to 10 letters and digits with at least one of each, read as is.
  // Foreign formats vary too much to check, so these rank below UK reads and the user picks.
  const OTHER = 0.5;
  function other(s) { return s.length >= 4 && s.length <= 10 && /\d/.test(s) && /[A-Z]/.test(s) && !/\d{7}/.test(s) ? { vrn: s, score: OTHER, fixed: 0, uk: false } : null; }

  // True if the UK read u is the same characters as the raw read c, with only OCR mix-ups fixed (KR21FLB from KR2IFLB).
  const sameRead = (c, u) => c.length === u.length && [...c].every((x, k) => x === u[k] || TO_L[x] === u[k] || TO_D[x] === u[k]);

  const MIN = 0.4;
  function find(lines) {
    const found = [], tokens = [];
    (lines || []).forEach((l, n) => {
      const conf = l.confidence == null ? 0.8 : Math.max(0, Math.min(1, +l.confidence));
      for (const t of String(l.text || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean)) tokens.push({ t, conf, line: n });
    });
    // A plate may be read as one token, two (AB12 CDE), or split across lines; try up to three in a row.
    for (let i = 0; i < tokens.length; i++) {
      let s = "", conf = 1;
      const cuts = [];
      for (let j = i; j < Math.min(tokens.length, i + 4); j++) {
        if (j > i) cuts.push(s.length);
        s += tokens[j].t; conf = Math.min(conf, tokens[j].conf);
        if (s.length > 10) break;
        // a foreign plate is read as is, from pieces on one line
        const o = tokens[j].line === tokens[i].line ? other(s) : null;
        if (o) found.push({ ...o, weak: true, score: Math.round(o.score * conf * 1000) / 1000, i, j });
        if (s.length > 7 || j - i > 2) continue;
        const b = best(s); if (!b) continue;
        if (cuts.some((c) => b.shape[c - 1] === b.shape[c])) continue; // pieces join where letters meet digits, as on a plate
        // every plate has digits; a word with none is only trusted as a modern plate read in its two halves
        if (!/\d/.test(s) && !(b.shape === "LLDDLLL" && cuts.length === 1 && cuts[0] === 4)) continue;
        if (j > i && b.fixed && (b.score < 0.75 || tokens[j].line !== tokens[i].line)) continue; // joined pieces with fixes: a modern plate, on one line
        const score = Math.round(b.score * conf * 1000) / 1000;
        if (score >= MIN) found.push({ vrn: b.vrn, score, fixed: b.fixed, uk: true, weak: b.weak, current: b.shape === "LLDDLLL", i, j });
      }
    }
    // A piece of a longer read (GH78 out of GH78 JKL) isn't a plate of its own, if the longer read scores as well,
    // or the piece is only an old dateless or unknown format (ZX19 out of a foreign ZX19 QRS).
    const keep = found.filter((c) => !found.some((d) => d !== c && d.i <= c.i && d.j >= c.j && (d.j - d.i > c.j - c.i) && (d.score >= c.score || c.weak)));
    const by = new Map();
    for (const c of keep) { if (c.score < MIN) continue; const o = by.get(c.vrn); if (!o || c.score > o.score) by.set(c.vrn, { vrn: c.vrn, score: c.score, fixed: c.fixed, uk: c.uk, current: !!c.current }); }
    // A raw read that's only a current UK plate with mix-ups unfixed (KR2IFLB for KR21FLB) is the same plate: offer
    // the UK rendering alone. Older UK formats don't count: they're rare now, and their reads overlap real foreign
    // plates (1234 BCD is Spanish, not a misread I234 BCD).
    const cur = [...by.values()].filter((c) => c.current);
    for (const c of [...by.values()]) if (!c.uk && cur.some((u) => sameRead(c.vrn, u.vrn))) by.delete(c.vrn);
    return [...by.values()].map(({ current, ...c }) => c).sort((a, b) => b.score - a.score || a.vrn.localeCompare(b.vrn)).slice(0, 6);
  }

  // A plate as it's printed: UK formats with their usual space (AB12 CDE, A123 BCD, ABC 123D, ABC 123), anything
  // else as stored, since foreign spacing can't be known from the letters alone.
  function format(vrn) {
    const v = String(vrn || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let m;
    if ((m = /^([A-Z]{2}\d{2})([A-Z]{3})$/.exec(v))) return m[1] + " " + m[2];
    if ((m = /^([A-Z]\d{1,3})([A-Z]{3})$/.exec(v))) return m[1] + " " + m[2];
    if ((m = /^([A-Z]{3})(\d{1,3}[A-Z])$/.exec(v))) return m[1] + " " + m[2];
    if ((m = /^([A-Z]{1,3})(\d{1,4})$/.exec(v)) || (m = /^(\d{1,4})([A-Z]{1,3})$/.exec(v))) return m[1] + " " + m[2];
    return v;
  }

  const api = { find, format };
  root.VB = root.VB || {};
  root.VB.plates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
