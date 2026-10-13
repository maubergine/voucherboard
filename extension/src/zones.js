// Lewisham controlled parking zones and operating times.
// Source: https://lewisham.gov.uk/myservices/parking/permits/controlled-parking-zones-and-operating-times
// Days are ISO weekdays (1 = Monday ... 7 = Sunday). Times are minutes after midnight.
(function (root) {
  "use strict";
  const H = (h, m) => h * 60 + (m || 0);
  const MF = [1, 2, 3, 4, 5], MS = [1, 2, 3, 4, 5, 6];
  const Z = (code, name, rules) => ({ code, name, rules });

  const ZONES = [
    Z("BHA", "Blackheath", [{ d: MS, f: H(9), t: H(19) }]),
    Z("B1", "Lewisham Central", [{ d: MS, f: H(9), t: H(19) }]),
    Z("B2", "Lewisham Central Southern", [{ d: MS, f: H(9), t: H(19) }, { d: [7], f: H(9), t: H(13, 30) }]),
    Z("C", "Hindsley Place", [{ d: MS, f: H(8), t: H(18, 30) }]),
    Z("D", "Grove Park", [{ d: MF, f: H(9), t: H(17, 30) }]),
    Z("DP", "Deptford", [{ d: MF, f: H(9), t: H(17) }]),
    Z("DS", "Deptford South", [{ d: MF, f: H(9), t: H(17) }]),
    Z("E", "Rushey Green West", [{ d: MF, f: H(9), t: H(19) }]),
    Z("EN", "Evelyn", [{ d: MF, f: H(9), t: H(17) }]),
    Z("F", "Murillo Road", [{ d: MF, f: H(9), t: H(19) }]),
    Z("G", "Elverson", [{ d: MF, f: H(9), t: H(19) }]),
    Z("H", "Hither Green West", [{ d: MF, f: H(9), t: H(19) }]),
    Z("HO", "Honor Oak", [{ d: MF, f: H(9), t: H(17) }]),
    Z("J", "Canadian Avenue", [{ d: MF, f: H(9), t: H(19) }]),
    Z("K", "Catford West", [{ d: MF, f: H(9), t: H(19) }]),
    Z("L", "Rushey Green East", [{ d: MF, f: H(9), t: H(19) }]),
    Z("LG", "Lee Green", [{ d: MF, f: H(10), t: H(12) }]),
    Z("LW", "Ladywell West", [{ d: MF, f: H(10), t: H(12) }]),
    Z("M", "Barmeston Road", [{ d: MF, f: H(9), t: H(19) }]),
    Z("MH", "Manor House", [{ d: MF, f: H(10), t: H(12) }]),
    Z("MT/E", "Milford Towers / Rushey Green West", [{ d: MF, f: H(9), t: H(19) }]),
    Z("N", "Davids Road", [{ d: MF, f: H(9), t: H(17) }]),
    Z("OB", "Old Road / Bankwell", [{ d: MS, f: H(9), t: H(19) }]),
    Z("P", "Hither Green East", [{ d: MF, f: H(10), t: H(12) }]),
    Z("R", "Rushey Green South", [{ d: MF, f: H(9), t: H(19) }]),
    Z("RP", "Ravensbourne Park", [{ d: MF, f: H(9), t: H(17) }]),
    Z("S", "Deptford Central", [{ d: MF, f: H(9), t: H(18) }, { d: [6], f: H(9), t: H(13, 30) }]),
    Z("T", "Ladywell", [{ d: MF, f: H(9), t: H(19) }]),
    Z("V", "Lee", [{ d: MF, f: H(10), t: H(12) }]),
    Z("W", "Mountsfield Park", [{ d: MF, f: H(9), t: H(19) }])
  ];

  // England and Wales bank holidays. The council says to check street signs on these days.
  const BANK_HOLIDAYS = {
    "2026-01-01": "New Year's Day", "2026-04-03": "Good Friday", "2026-04-06": "Easter Monday",
    "2026-05-04": "Early May bank holiday", "2026-05-25": "Spring bank holiday", "2026-08-31": "Summer bank holiday",
    "2026-12-25": "Christmas Day", "2026-12-28": "Boxing Day (substitute)",
    "2027-01-01": "New Year's Day", "2027-03-26": "Good Friday", "2027-03-29": "Easter Monday",
    "2027-05-03": "Early May bank holiday", "2027-05-31": "Spring bank holiday", "2027-08-30": "Summer bank holiday",
    "2027-12-27": "Christmas Day (substitute)", "2027-12-28": "Boxing Day (substitute)"
  };

  // A permit for one of these zones is valid in each subzone, and their hours differ, so the user picks one.
  const SUBZONES = { B: ["B1", "B2"] };

  // "P - Hither Green East" -> zone P. Unknown zones return null; callers then rely on the site's own check.
  function findZone(zoneName) {
    if (!zoneName) return null;
    const code = String(zoneName).split(" - ")[0].trim().toUpperCase();
    return ZONES.find((z) => z.code === code) || null;
  }

  // "B - Lewisham Central" -> zones B1 and B2. Empty for zones without subzones.
  function subzones(zoneName) {
    const code = String(zoneName || "").split(" - ")[0].trim().toUpperCase();
    return (SUBZONES[code] || []).map(findZone);
  }

  const api = { ZONES, BANK_HOLIDAYS, SUBZONES, findZone, subzones, H };
  root.VB = root.VB || {};
  root.VB.zones = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
