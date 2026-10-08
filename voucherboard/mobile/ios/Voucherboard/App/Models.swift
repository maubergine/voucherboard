import Foundation

// The engine's view models (mobile/www/views.js), decoded as they come. Text is already worded for the screen;
// times are minutes after midnight and days are YYYY-MM-DD keys.

struct Pill: Decodable, Hashable { let text: String; let tone: String }
struct Span: Decodable, Hashable { let f: Int; let t: Int }

/// A booking ("visit") or a planned entry, as listed on Today, the agenda and a vehicle's page.
struct Row: Decodable, Hashable {
  let kind: String
  let key: String?
  let id: Int?
  let dk: String
  let day: String
  let date: String
  let vrn: String
  let plate: String
  let name: String
  let time: String
  let start: Int
  let pill: Pill
  /// Bookings only: whether it can be cancelled from the list, and what that gives back.
  let canCancel: Bool?
  let cancelText: String?
  var rowID: String { kind == "visit" ? "b:" + (key ?? "") : "e:\(id ?? 0)" }
}

struct HomeView: Decodable {
  struct Zone: Decodable { let code: String; let name: String; let live: Bool; let text: String }
  struct Tray: Decodable { let title: String; let short: String; let subtitle: String; let ready: Bool }
  let phase: String
  let demo: Bool?
  let error: String?
  let signedOut: Bool?
  let loading: Bool?
  let updated: String
  let testMode: Bool
  let version: String?
  let zone: Zone
  let balance: String
  let tray: Tray?
  let running: Bool
  let busy: Bool?
}

struct TodayView: Decodable {
  struct Live: Decodable, Identifiable {
    struct Extend: Decodable { let vrn: String; let dk: String; let end: Int }
    let key: String, vrn: String, plate: String, name: String, time: String, vouchers: String, ends: String
    let pct: Int, note: String, canExtend: Bool, extend: Extend?, canEndEarly: Bool
    /// Milliseconds from now to the start and end, for the Live Activity.
    let startIn: Double, endIn: Double
    var id: String { key }
  }
  struct Favourite: Decodable, Identifiable { let vrn: String; let nick: String; let plate: String; var id: String { vrn } }
  let live: [Live]
  let liveActivity: Bool
  let zone: String
  let next: [Row]
  let more: Int
  let total: Int
  let favourites: [Favourite]
}

struct CalendarView: Decodable {
  struct Day: Decodable, Identifiable {
    let dk: String, date: Int, label: String, off: Bool, today: Bool, selected: Bool, enabled: Bool, booked: Bool, planned: Bool
    var id: String { dk }
  }
  let weekdays: [String]
  let days: [Day]
  let selected: Agenda
}

struct Agenda: Decodable { let dk: String; let title: String; let ctl: String; let items: [Row]; let bookable: Bool }

struct Hour: Decodable, Hashable { let min: Int; let label: String; let short: String }

struct Block: Decodable, Hashable {
  let kind: String
  let key: String?
  let id: Int?
  let sel: String
  let dayIndex: Int
  let f: Int
  let t: Int
  let status: String
  let changing: Bool
  let label: String
  var blockID: String { sel }
}

struct Lane: Decodable, Identifiable { let vrn: String; let plate: String; let name: String; let blocks: [Block]; var id: String { vrn } }

struct DayTimeline: Decodable {
  let dk: String, title: String, ctl: String, bookable: Bool, prev: String, next: String
  let from: Int, to: Int, hours: [Hour], controls: [Span], now: Int?, lanes: [Lane]
}

struct Board: Decodable {
  struct Day: Decodable, Identifiable { let dk: String; let label: String; let today: Bool; let off: Bool; let controls: [Span]; let bookable: Bool; var id: String { dk } }
  struct Now: Decodable { let dayIndex: Int; let min: Int }
  let zoom: String, label: String, from: Int, to: Int, hours: [Hour], days: [Day], now: Now?, prev: String?, next: String?, lanes: [Lane]
}

struct VehiclesView: Decodable {
  struct Item: Decodable, Identifiable { let vrn: String; let plate: String; let name: String; let status: Pill; var id: String { vrn } }
  let favourites: [Item]
  let others: [Item]
}

struct VehicleView: Decodable {
  let vrn: String, plate: String, title: String, subtitle: String, fav: Bool, canDelete: Bool, nick: String, bookLabel: String, items: [Row]
}

struct Suggestions: Decodable {
  struct Match: Decodable, Identifiable { let vrn: String; let plate: String; let name: String; let nick: String; var id: String { vrn } }
  let matches: [Match]
  let newVrn: String?
  let newPlate: String?
}

struct PlanView: Decodable {
  struct Item: Decodable, Identifiable {
    let id: Int, dk: String, day: String, date: String, vrn: String, plate: String, change: Bool, time: String, need: String, bad: String?, start: Int
  }
  struct Advice: Decodable { struct Buy: Decodable, Identifiable { let kind: String; let n: Int; let label: String; var id: String { kind } }; let tone: String; let title: String; let text: String; let buys: [Buy] }
  let items: [Item], subtitle: String, cost: String?, ready: Bool, reviewLabel: String, advice: Advice?, empty: Bool
}

struct EntryView: Decodable {
  struct Note: Decodable, Hashable { let tone: String; let text: String }
  let id: Int, vrn: String, plate: String, name: String, title: String, dayText: String, ctl: String, limits: Span?, from: Int, to: Int
  let cost: String?, notes: [Note], removeLabel: String
}

struct VisitView: Decodable {
  struct Voucher: Decodable, Hashable { let label: String; let running: Bool; let past: Bool }
  struct Shrink: Decodable, Identifiable { let index: Int; let end: String; let returns: String; var id: Int { index } }
  let key: String, vrn: String, plate: String, name: String, status: String, statusText: String, dayText: String, time: String
  let start: Int, end: Int, limits: Span?, vouchersText: String, vouchers: [Voucher], refs: String, canCancel: Bool, canChange: Bool, note: String
  let cancelText: String, canEndEarly: Bool, shrink: [Shrink], keepLabel: String
}

/// Every booking and planned item (`list`). Each row is a `Row`, plus its bulk key and whether it can be picked.
struct ListView: Decodable {
  struct Item: Decodable, Identifiable {
    let row: Row, sel: String, pick: Bool, why: String?
    var id: String { sel }
    private enum K: String, CodingKey { case sel, pick, why }
    init(from d: Decoder) throws {
      let c = try d.container(keyedBy: K.self)
      sel = try c.decode(String.self, forKey: .sel); pick = try c.decode(Bool.self, forKey: .pick); why = try c.decodeIfPresent(String.self, forKey: .why)
      row = try Row(from: d)
    }
  }
  struct Vehicle: Decodable, Identifiable { let vrn: String, plate: String, name: String, on: Bool; var id: String { vrn } }
  let rows: [Item], vehicles: [Vehicle], summary: String, empty: String
}

/// What a bulk time change would do (`bulkTimes`).
struct BulkTimesView: Decodable {
  let from: Int, to: Int, limits: Span?, ok: Int, text: String, bad: [String], apply: String
}

struct BulkView: Decodable {
  struct Item: Decodable, Hashable { let plate: String; let text: String; let pill: String }
  let title: String, items: [Item], note: String, action: String, cancels: Bool, single: String?
}

/// The quick-book form. Native keeps it and hands it back with every quick-book call.
struct QuickForm: Codable, Equatable {
  var vrns: [String]
  var when: String
  var days: [String]
  var from: Int
  var to: Int
  var preset: String
}

struct QuickView: Decodable {
  struct Preset: Decodable, Identifiable { let id: String; let label: String; let on: Bool }
  struct Days: Decodable {
    struct Choice: Decodable, Identifiable { let id: String; let label: String }
    struct Day: Decodable, Identifiable { let dk: String; let date: Int; let label: String; let off: Bool; let today: Bool; let on: Bool; let enabled: Bool; var id: String { dk } }
    let choices: [Choice], days: [Day], count: Int
  }
  struct Vehicle: Decodable, Identifiable { let vrn: String; let plate: String; let name: String; var id: String { vrn } }
  struct Preview: Decodable { let text: String; let notes: [String]; let ok: Bool; let bad: Bool; let canAdd: Bool; let canBook: Bool }
  let q: QuickForm, when: String, presets: [Preset], days: Days?, from: Int, to: Int, fromText: String, toText: String
  let fromEditable: Bool, limits: Span?, note: String, vehicles: [Vehicle], preview: Preview
}

struct ConfirmView: Decodable {
  let plate: String?, name: String?, plates: [String], dayLabel: String, dayText: String, timeText: String
  let vouchersText: String, email: Bool, test: Bool, note: String, goLabel: String
}

struct RunView: Decodable {
  struct Op: Decodable, Identifiable { let kind: String; let tag: String; let plate: String; let text: String; let status: String; let statusText: String; let err: String?; var id: String { plate + text + tag } }
  let phase: String, test: Bool, title: String, tag: String, balance: String, heading: String, goLabel: String
  let progress: Int, label: String, stopping: Bool, ops: [Op], info: String, modeNote: String, note: String
  let failed: Bool, ok: Bool, reminder: String?, canResume: Bool, hasReport: Bool
}

struct MoreView: Decodable {
  struct Permit: Decodable, Identifiable { let id: String; let label: String; let selected: Bool }
  struct Subzone: Decodable, Identifiable { let code: String; let label: String; let selected: Bool; var id: String { code } }
  struct Settings: Decodable { let testMode: Bool; let betaLive: Bool; let emailAll: Bool; let reminders: Bool; let lead: Int; let liveActivity: Bool }
  let permits: [Permit], subzones: [Subzone], settings: Settings, leads: [Int], hasReport: Bool, issuesUrl: String, footer: String
  let demo: Bool?, privacyUrl: String, supportUrl: String
}

struct TermsView: Decodable { let html: String; let version: String; let owner: String; let privacyUrl: String? }

/// What an action returns: a message to show, an undo id, or an error. Scans also return plates.
struct ActionResult: Decodable {
  struct Candidate: Decodable, Identifiable, Hashable { let vrn: String; let plate: String; let name: String?; var id: String { vrn } }
  var toast: String?
  var undo: Int?
  var err: String?
  var cancelled: Bool?
  var cands: [Candidate]?
  var vrn: String?
}
