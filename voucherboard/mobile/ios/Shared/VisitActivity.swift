import ActivityKit
import Foundation

/// A visitor parked now, as a Live Activity on the Lock Screen and in the Dynamic Island. The app starts, updates and
/// ends it (LiveVisits.swift); the VoucherboardLive extension draws it. It's local only: no push token is asked for.
struct VisitActivity: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var start: Date
    var end: Date
    /// "Ends 12:00"
    var ends: String
    /// voucherboard://extend?..., when the controls run on past the booking; nil otherwise.
    var extendURL: URL?
  }

  /// The booking's key (`VW55XYZ|2026-09-30|600`).
  var key: String
  var plate: String
  var name: String
  var zone: String

  /// Opens the booking in the app.
  var visitURL: URL? { VisitActivity.url("visit", ["key": key]) }

  static func url(_ host: String, _ query: [String: String]) -> URL? {
    var c = URLComponents()
    c.scheme = "voucherboard"
    c.host = host
    c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
    return c.url
  }
}
