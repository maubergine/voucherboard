import Foundation

/// The UI's key-value store (`store.*`): one JSON file in Application Support, excluded from backup, never synced.
final class Store {
  static let shared = Store()
  private let queue = DispatchQueue(label: (Bundle.main.bundleIdentifier ?? "Voucherboard") + ".store")
  private let file: URL
  private var values: [String: Any] = [:]

  private init() {
    let fm = FileManager.default
    var dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Voucherboard", isDirectory: true)
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    // On the folder, not the file: atomic writes replace the file and would drop the flag.
    var rv = URLResourceValues()
    rv.isExcludedFromBackup = true
    try? dir.setResourceValues(rv)
    file = dir.appendingPathComponent("store.json")
    if let data = try? Data(contentsOf: file), let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
      values = obj
    }
  }

  func get(_ key: String) -> Any? {
    queue.sync { values[key] }
  }

  /// Sets (or, with nil, removes) a value and writes the file. Returns false, and keeps the old value, if the write fails.
  @discardableResult
  func set(_ key: String, _ value: Any?) -> Bool {
    queue.sync { () -> Bool in
      let old = values[key]
      values[key] = value
      if persist() { return true }
      values[key] = old
      return false
    }
  }

  private func persist() -> Bool {
    guard JSONSerialization.isValidJSONObject(values), let data = try? JSONSerialization.data(withJSONObject: values) else { return false }
    // Readable after the first unlock, so a notification-launched app can load plans while the phone is locked.
    return (try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])) != nil
  }
}
