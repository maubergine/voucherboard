// Reminders built from bookings: "VW55 XYZ: voucher ends at 11:00", a set time before a visit's last voucher ends,
// when controls carry on after it. Pure; the app hands the list to the phone's local notifications.
(function (root) {
  "use strict";
  const P = (root.VB && root.VB.planner) || (typeof require === "function" ? require("./planner.js") : null);
  const { key, fromKey, hm, addDays } = P;
  const MAX = 40; // iOS keeps at most 64 pending local notifications per app
  const plate = (v) => { const PL = (root.VB && root.VB.plates) || (typeof require === "function" ? require("./plates.js") : null); return PL ? PL.format(v) : v; };

  // Back-to-back bookings for one vehicle on one day count as one visit. A visit's end can run into later days.
  function visits(bookings) {
    const by = new Map();
    for (const b of bookings) { const k = b.vrn + "|" + b.date; if (!by.has(k)) by.set(k, []); by.get(k).push(b); }
    const out = [];
    for (const list of by.values()) {
      list.sort((a, b) => a.start - b.start);
      let cur = null;
      for (const b of list) {
        if (cur && b.start <= cur.end) { cur.end = Math.max(cur.end, b.start + b.mins); cur.ids.push(b.id); continue; }
        cur = { vrn: b.vrn, dk: b.date, start: b.start, end: b.start + b.mins, ids: [b.id] };
        out.push(cur);
      }
    }
    return out;
  }

  // ctx: { today, now, zone, bookings, vehicles, lead } (lead in minutes). Returns notifications in time order.
  function schedule(ctx) {
    const lead = ctx.lead == null ? 15 : ctx.lead, tk = key(ctx.today), last = key(addDays(ctx.today, P.WINDOW_DAYS));
    const name = (vrn) => { const v = (ctx.vehicles || []).find((x) => x.vrn === vrn); return v && (v.fav || v.pendingFav) ? v.nick : null; };
    const out = [];
    for (const v of visits(ctx.bookings)) {
      // A day or week voucher ends on a later day: work from that day and minute.
      const ed = addDays(fromKey(v.dk), Math.floor(v.end / 1440)), end = v.end % 1440, ek = key(ed), at = Math.max(v.end > 1440 ? 0 : v.start, end - lead);
      if (ek < tk || v.dk > last) continue;
      if (ek === tk && at <= ctx.now) continue;
      const c = P.controls(ctx.zone, ed);
      const carryOn = c ? c.find((x) => x.f <= end && x.t > end) : null;
      if (c && !carryOn) continue; // controls end with the visit, so there's nothing to do
      const who = name(v.vrn);
      const body = (who ? who + ". " : "") + (carryOn ? `Controls run until ${hm(carryOn.t)}.` : "Check the street signs for controlled hours.");
      out.push({
        id: `end:${v.vrn}:${ek}:${end}`,
        at: new Date(ed.getFullYear(), ed.getMonth(), ed.getDate(), 0, at).toISOString(),
        title: `${plate(v.vrn)}: voucher ends at ${hm(end)}`,
        body,
        actions: [{ id: "extend", title: "Extend 1 hour" }],
        data: { vrn: v.vrn, dk: ek, end }
      });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, MAX);
  }

  const api = { visits, schedule };
  root.VB = root.VB || {};
  root.VB.reminders = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
