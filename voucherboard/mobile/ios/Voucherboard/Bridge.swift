import UIKit
import WebKit

/// The "vb" message handler: every command in mobile/BRIDGE.md. Replies with a JSON value, or an error string that
/// rejects the UI's Promise. Arguments come from a web page, so each one is checked before use.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
  weak var host: MainViewController?

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                             replyHandler: @escaping (Any?, String?) -> Void) {
    guard let host = host, let ui = host.uiWebView, message.webView === ui, message.frameInfo.isMainFrame,
          message.frameInfo.securityOrigin.`protocol` == "file",
          let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
      return replyHandler(nil, "bad message")
    }
    let args = body["args"] as? [String: Any] ?? [:]
    let ok: (Any?) -> Void = { replyHandler($0 ?? NSNull(), nil) }
    let fail: (String) -> Void = { replyHandler(nil, $0) }

    switch cmd {
    case "hello":
      let info = Bundle.main.infoDictionary ?? [:]
      ok(["platform": "ios", "version": info["CFBundleShortVersionString"] as? String ?? "", "build": info["CFBundleVersion"] as? String ?? ""])
      // After the reply, so queued notification taps arrive once hello has resolved.
      Task { @MainActor in host.uiDidSayHello() }

    case "engine.event":
      guard let type = Self.string(args["type"], max: 40), !type.isEmpty else { return fail("bad event") }
      host.engineEvent(type, args["data"] as? [String: Any] ?? [:])
      ok(nil)

    case "council.fetch":
      let method = (args["method"] as? String ?? "GET").uppercased()
      guard ["GET", "POST"].contains(method), let path = args["path"] as? String, Council.url(path) != nil,
            let headers = Self.headers(args["headers"]) else { return fail("bad request") }
      let raw = args["body"]
      let reqBody: String?
      if raw == nil || raw is NSNull { reqBody = nil }
      else if let s = raw as? String, s.utf8.count <= 2_000_000 { reqBody = s }
      else { return fail("bad request") }
      host.council.fetch(.init(method: method, path: path, headers: headers, body: reqBody)) { value, error in
        if let error = error { fail(error) } else { ok(value) }
      }

    case "council.show":
      guard let reason = args["reason"] as? String, ["signin", "buy", "browse"].contains(reason),
            let path = args["path"] as? String, let url = Council.url(path) else { return fail("bad request") }
      var intent: [String: Any]?
      if reason == "buy" {
        guard let i = Self.buyIntent(args["buy"]) else { return fail("bad request") }
        intent = i
      }
      host.council.show(reason: reason, url: url, buy: intent)
      ok(nil)

    case "council.signOut":
      host.council.signOut { ok(nil) }

    case "store.get":
      guard let key = Self.key(args) else { return fail("bad key") }
      ok(Store.shared.get(key))

    case "store.set":
      guard let key = Self.key(args) else { return fail("bad key") }
      let value = args["value"] ?? NSNull()
      guard JSONSerialization.isValidJSONObject([value]) else { return fail("bad value") }
      Store.shared.set(key, value) ? ok(nil) : fail("storage")

    case "store.remove":
      guard let key = Self.key(args) else { return fail("bad key") }
      Store.shared.set(key, nil) ? ok(nil) : fail("storage")

    case "notify.permission":
      Notifications.shared.permission { ok(["granted": $0]) }

    case "notify.schedule":
      guard let raw = args["items"] as? [Any], raw.count <= 500 else { return fail("bad request") }
      var items: [Notifications.Item] = []
      for r in raw {
        guard let o = r as? [String: Any], let id = Self.string(o["id"], max: 200), !id.isEmpty,
              let at = (o["at"] as? String).flatMap(Self.date), let title = Self.string(o["title"], max: 500),
              let text = Self.string(o["body"], max: 4000) else { return fail("bad item") }
        let extend = (o["actions"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }.first { $0["id"] as? String == "extend" }
        items.append(.init(id: id, at: at, title: title, body: text,
                           extendTitle: extend.flatMap { Self.string($0["title"], max: 100) },
                           data: Self.json(o["data"])))
      }
      Notifications.shared.schedule(items) { ok(nil) }

    case "orientation.set":
      guard let mode = args["mode"] as? String, ["landscape", "portrait", "auto"].contains(mode) else { return fail("bad mode") }
      host.setOrientation(mode)
      ok(nil)

    case "run.begin", "run.end":
      host.setRunning(cmd == "run.begin")
      ok(nil)

    case "share":
      guard let title = Self.string(args["title"] ?? "", max: 500), let text = Self.string(args["text"], max: 20_000) else { return fail("bad request") }
      host.share(title: title, text: text)
      ok(nil)

    case "haptic":
      guard let kind = args["kind"] as? String, host.haptic(kind) else { return fail("bad kind") }
      ok(nil)

    case "openExternal":
      guard let s = Self.string(args["url"], max: 4096), let url = URL(string: s), url.scheme?.lowercased() == "https",
            let h = url.host, !h.isEmpty else { return fail("bad url") }
      UIApplication.shared.open(url, options: [:], completionHandler: nil)
      ok(nil)

    case "plate.scan":
      guard let source = args["source"] as? String, ["photos", "camera"].contains(source) else { return fail("bad source") }
      host.plates.scan(source: source) { value, error in
        if let error = error { fail(error) } else { ok(value) }
      }

    default:
      fail("unknown command")
    }
  }

  // MARK: Argument checks

  private static func string(_ v: Any?, max: Int) -> String? {
    guard let s = v as? String, s.count <= max else { return nil }
    return s
  }

  private static func key(_ args: [String: Any]) -> String? {
    guard let k = string(args["key"], max: 512), !k.isEmpty else { return nil }
    return k
  }

  /// Header names must be HTTP tokens and values single-line; fetch() itself drops the forbidden ones.
  private static func headers(_ v: Any?) -> [String: String]? {
    if v == nil || v is NSNull { return [:] }
    guard let d = v as? [String: Any], d.count <= 20 else { return nil }
    let token = CharacterSet(charactersIn: "!#$%&'*+-.^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
    var out: [String: String] = [:]
    for (k, raw) in d {
      guard let value = raw as? String, !k.isEmpty, k.unicodeScalars.allSatisfy({ token.contains($0) }), value.count <= 1000,
            !value.contains(where: { $0 == "\r" || $0 == "\n" }) else { return nil }
      out[k] = value
    }
    return out
  }

  /// `{ permitId, periodPriceId, count, label }`. The ids go to buyfill.js as strings, since it compares attributes.
  private static func buyIntent(_ v: Any?) -> [String: Any]? {
    guard let d = v as? [String: Any], let permitId = id(d["permitId"]), let periodPriceId = id(d["periodPriceId"]),
          let count = d["count"] as? Int, (1...1000).contains(count), let label = string(d["label"], max: 200) else { return nil }
    return ["permitId": permitId, "periodPriceId": periodPriceId, "count": count, "label": label]
  }

  private static func id(_ v: Any?) -> String? {
    if let s = v as? String, !s.isEmpty, s.count <= 64 { return s }
    if let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { return n.stringValue }
    return nil
  }

  /// An ISO time. toISOString() gives fractional seconds and Z; a local time without a zone is also accepted.
  private static func date(_ s: String) -> Date? {
    let iso = ISO8601DateFormatter()
    for options in [[.withInternetDateTime, .withFractionalSeconds], [.withInternetDateTime]] as [ISO8601DateFormatter.Options] {
      iso.formatOptions = options
      if let d = iso.date(from: s) { return d }
    }
    let local = DateFormatter()
    local.locale = Locale(identifier: "en_US_POSIX")
    local.timeZone = .current
    for format in ["yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
      local.dateFormat = format
      if let d = local.date(from: s) { return d }
    }
    return nil
  }

  /// A notification's `data` object as JSON text, or "{}" if it isn't a small JSON object.
  private static func json(_ v: Any?) -> String {
    guard let d = v as? [String: Any], JSONSerialization.isValidJSONObject(d),
          let data = try? JSONSerialization.data(withJSONObject: d), data.count <= 4096,
          let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
  }
}
