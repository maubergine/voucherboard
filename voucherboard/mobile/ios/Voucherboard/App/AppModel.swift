import SwiftUI
import WebKit
import Observation

/// Calls the engine in the invisible engine view (mobile/BRIDGE.md, "Engine API"). Results come back as JSON text and
/// are decoded into the view models in Models.swift.
@MainActor
final class EngineClient {
  weak var webView: WKWebView?
  private var ready = false
  private var waiting: [CheckedContinuation<Void, Never>] = []

  /// The engine page has loaded; calls made before this wait for it.
  func pageLoaded() {
    ready = true
    waiting.forEach { $0.resume() }
    waiting = []
  }

  func pageGone() { ready = false }

  func call<T: Decodable>(_ name: String, _ args: [String: Any] = [:], as type: T.Type = T.self) async throws -> T {
    if !ready { await withCheckedContinuation { waiting.append($0) } }
    guard let webView = webView else { throw EngineError("No engine") }
    let raw = try await webView.callAsyncJavaScript("return JSON.stringify(await VBEngine.call(name, args))",
                                                    arguments: ["name": name, "args": args], in: nil, contentWorld: .page)
    guard let text = raw as? String, let data = text.data(using: .utf8) else { throw EngineError("No answer") }
    return try JSONDecoder().decode(T.self, from: data)
  }
}

struct EngineError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

/// The form as plain JSON for the engine.
extension Encodable {
  var json: Any { (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) ?? NSNull() }
}

enum AppTab: Hashable { case today, calendar, list, vehicles, more }

/// What opens Book a visitor: a ready-made form (Extend, a favourite, a day), or plates from a scan.
struct QuickStart: Equatable {
  var view: QuickView.Seed = .init()
  var cands: [ActionResult.Candidate] = []
  var err: String?
  var scan: String?
}

extension QuickView {
  /// quickInit's options: vehicles, days and times to start with.
  struct Seed: Equatable {
    var vrns: [String] = []
    var days: [String]?
    var from: Int?
    var to: Int?
    var extend: TodayView.Live.Extend?
    var form: QuickForm?
  }
}

extension TodayView.Live.Extend: Equatable {
  static func == (a: Self, b: Self) -> Bool { a.vrn == b.vrn && a.dk == b.dk && a.end == b.end }
}

enum Sheet: Identifiable, Equatable {
  case quick(QuickStart)
  case plan
  case entry(Int)
  case visit(String)
  case bulk([String])
  case bulkTime([String])
  case run
  case newFavourite

  var id: String {
    switch self {
    case .quick: return "quick"
    case .plan: return "plan"
    case .entry(let id): return "entry:\(id)"
    case .visit(let key): return "visit:" + key
    case .bulk(let keys): return "bulk:" + keys.joined(separator: ",")
    case .bulkTime(let keys): return "bulkTime:" + keys.joined(separator: ",")
    case .run: return "run"
    case .newFavourite: return "newFavourite"
    }
  }
}

struct Toast: Equatable, Identifiable {
  let id = UUID()
  var text: String
  var undo: Int?
  var error = false
  /// Shown while an action runs; the result replaces it in place.
  var busy = false
  /// How much of a busy cancel is done, 0 to 1, from the engine's `progress` events. Nil shows a spinner.
  var progress: Double?
}

/// The app's screen state. The engine owns the data; this keeps what's on screen and fetches views again whenever
/// the engine says something changed (`version` goes up, and every screen's `.task(id:)` runs again).
@MainActor @Observable
final class AppModel {
  let engine = EngineClient()
  var home: HomeView?
  var tab: AppTab = .today
  var sheet: Sheet?
  var toast: Toast?
  var version = 0
  var boardSelection: Set<String> = []
  /// The List tab's select mode, and the rows ticked in it by bulk key. A bulk action ends select mode.
  var listSelecting = false
  var listSelection: Set<String> = []
  func endListSelect() { listSelecting = false; listSelection = [] }
  /// A link from a Live Activity, kept until the permits have loaded.
  private var pendingLink: URL?
  private var pendingChange = false
  private var toastTask: Task<Void, Never>?

  // MARK: Engine events

  func event(_ type: String, _ data: [String: Any]) {
    switch type {
    case "change", "tick", "run": changed()
    case "toast": if let text = data["text"] as? String { show(Toast(text: text)) }
    case "progress":
      guard var t = toast, t.busy, let done = (data["done"] as? NSNumber)?.intValue, let total = (data["total"] as? NSNumber)?.intValue, total > 0 else { return }
      t.progress = (Double(done) + 0.5) / Double(total) // the voucher being cancelled counts as half done
      if total > 1 { t.text = "Cancelling \(done + 1) of \(total) vouchers…" }
      toast = t
    case "home":
      sheet = nil
      tab = .today
    case "quick":
      if let view = data["view"] as? [String: Any], let q = view["q"], let form = try? decode(QuickForm.self, q) {
        sheet = .quick(QuickStart(view: .init(form: form)))
      }
    case "scan":
      let r = (try? decode(ActionResult.self, data)) ?? ActionResult()
      sheet = .quick(QuickStart(cands: r.cands ?? [], err: r.err))
    default: break
    }
  }

  /// Many changes can come at once (a run reports each step); they're folded into one refresh.
  private func changed() {
    guard !pendingChange else { return }
    pendingChange = true
    Task { @MainActor in
      try? await Task.sleep(nanoseconds: 40_000_000)
      pendingChange = false
      await refresh()
    }
  }

  func refresh() async {
    if let h = try? await engine.call("home", as: HomeView.self) {
      home = h
      if h.running, sheet != .run { sheet = .run }
      if !h.running, sheet == .run { sheet = nil }
      if h.phase == "ready" {
        if let t = try? await engine.call("today", as: TodayView.self) { LiveVisits.shared.sync(t) }
        if let link = pendingLink { pendingLink = nil; follow(link) }
      }
    }
    version += 1
  }

  // MARK: Links from the Live Activity

  /// `voucherboard://visit?key=` opens the booking; `voucherboard://extend?vrn=&dk=&end=` opens Book a visitor to
  /// extend it. Anything that doesn't look right is ignored.
  func open(link: URL) {
    if home?.phase == "ready" { follow(link) } else { pendingLink = link }
  }

  private func follow(_ url: URL) {
    let q = Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") }) { a, _ in a }
    let vrn = #/^[A-Z0-9]{1,10}$/#, dk = #/^\d{4}-\d{2}-\d{2}$/#
    switch url.host {
    case "visit":
      guard let key = q["key"], key.wholeMatch(of: #/^[A-Z0-9]{1,10}\|\d{4}-\d{2}-\d{2}\|\d{1,4}$/#) != nil else { return }
      tab = .today
      sheet = .visit(key)
    case "extend":
      guard let v = q["vrn"], v.wholeMatch(of: vrn) != nil, let d = q["dk"], d.wholeMatch(of: dk) != nil,
            let end = q["end"].flatMap(Int.init), (0...1440).contains(end) else { return }
      tab = .today
      sheet = .quick(QuickStart(view: .init(extend: .init(vrn: v, dk: d, end: end))))
    default: break
    }
  }

  // MARK: Calls

  func view<T: Decodable>(_ name: String, _ args: [String: Any] = [:], as type: T.Type = T.self) async -> T? {
    do { return try await engine.call(name, args, as: Optional<T>.self) } catch {
      #if DEBUG
      print("engine view \(name) failed: \(error)")
      #endif
      return nil
    }
  }

  /// Runs an action and shows what it says: its message (with Undo), or its error. With `progress`, a busy toast
  /// shows until it finishes.
  @discardableResult
  func act(_ name: String, _ args: [String: Any] = [:], progress: String? = nil) async -> ActionResult {
    if let p = progress { show(Toast(text: p, busy: true)) }
    let r: ActionResult
    do { r = try await engine.call(name, args, as: Optional<ActionResult>.self) ?? ActionResult() } catch {
      r = ActionResult(err: error.localizedDescription)
    }
    if r.err?.isEmpty ?? true, var t = toast, t.busy, t.progress != nil {
      // Let the pie fill before the tick replaces it.
      t.progress = 1; toast = t
      try? await Task.sleep(nanoseconds: 350_000_000)
    }
    if let err = r.err, !err.isEmpty { show(Toast(text: err, error: true)) }
    else if let text = r.toast, !text.isEmpty { show(Toast(text: text, undo: r.undo)) }
    else if progress != nil, toast?.busy == true { toast = nil }
    return r
  }

  func undo(_ id: Int) {
    toast = nil
    Task { await act("undo", ["id": id]) }
  }

  func show(_ t: Toast) {
    toast = t
    toastTask?.cancel()
    if t.busy { return }
    toastTask = Task { @MainActor [id = t.id] in
      try? await Task.sleep(nanoseconds: t.undo != nil ? 6_000_000_000 : 4_000_000_000)
      if self.toast?.id == id { self.toast = nil }
    }
  }

  // MARK: Shortcuts used by several screens

  func book(_ seed: QuickView.Seed = .init()) { sheet = .quick(QuickStart(view: seed)) }

  func scanToBook(_ source: String) { sheet = .quick(QuickStart(scan: source)) }

  func open(_ row: Row) {
    if row.kind == "visit", let key = row.key { sheet = .visit(key) } else if let id = row.id { sheet = .entry(id) }
  }

  func open(_ block: Block) {
    if block.kind == "visit", let key = block.key { sheet = .visit(key) } else if let id = block.id { sheet = .entry(id) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
    try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed))
  }
}
