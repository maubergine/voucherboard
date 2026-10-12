import Foundation

/// `shared-scan.json` in the App Group: the share extension writes the text it read, and the app takes it once.
/// Text only, never the image.
enum SharedScan {
  static let maxAge: TimeInterval = 10 * 60

  private struct File: Codable {
    let lines: [PlateText.Line]
    let at: Date
  }

  /// From Info.plist (`VBAppGroup`, set from the APP_GROUP_ID build setting), so the id lives only in project.yml.
  static var group: String? { Bundle.main.object(forInfoDictionaryKey: "VBAppGroup") as? String }

  private static var url: URL? {
    group.flatMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }?
      .appendingPathComponent("shared-scan.json")
  }

  @discardableResult
  static func write(_ lines: [PlateText.Line]) -> Bool {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    guard let url = url, let data = try? encoder.encode(File(lines: lines, at: Date())) else { return false }
    return (try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil
  }

  /// Reads and deletes the file. Returns its lines if it was written in the last 10 minutes.
  static func take() -> [PlateText.Line]? {
    guard let url = url, let data = try? Data(contentsOf: url) else { return nil }
    try? FileManager.default.removeItem(at: url)
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard let file = try? decoder.decode(File.self, from: data) else { return nil }
    let age = -file.at.timeIntervalSinceNow
    return age > -60 && age < maxAge ? file.lines : nil // a minute's grace for a clock that moved back
  }
}
