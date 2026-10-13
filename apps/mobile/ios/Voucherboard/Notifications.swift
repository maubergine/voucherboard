import UIKit
import UserNotifications

private let idPrefix = "vb."

/// Local reminders (`notify.*`) and taps on them, which become `notification` events once the UI has said hello.
@MainActor
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notifications()

  struct Item {
    let id: String
    let at: Date
    let title: String
    let body: String
    let extendTitle: String?
    let data: String // JSON text: userInfo must be a property list, and JSON null isn't one
  }

  private var pending: [[String: Any]] = []
  private var deliver: (([String: Any]) -> Void)?
  private var scheduling: Task<Void, Never>?

  func attach(_ deliver: @escaping ([String: Any]) -> Void) {
    self.deliver = deliver
    let queued = pending
    pending = []
    queued.forEach(deliver)
  }

  func detach() { deliver = nil }

  func permission(_ done: @escaping (Bool) -> Void) {
    Task { @MainActor in
      let center = UNUserNotificationCenter.current()
      let status = await center.notificationSettings().authorizationStatus
      switch status {
      case .notDetermined: done((try? await center.requestAuthorization(options: [.alert, .sound])) ?? false)
      case .denied: done(false)
      default: done(true)
      }
    }
  }

  /// Replaces every pending notification. Runs one at a time, so two quick calls can't interleave removes and adds.
  func schedule(_ items: [Item], done: @escaping () -> Void) {
    let previous = scheduling
    scheduling = Task { @MainActor in
      _ = await previous?.value
      let center = UNUserNotificationCenter.current()
      center.removeAllPendingNotificationRequests()
      let now = Date()
      var categories: [String: UNNotificationCategory] = [:] // by action title
      var requests: [UNNotificationRequest] = []
      // iOS keeps only the 64 soonest.
      for item in items.filter({ $0.at > now }).sorted(by: { $0.at < $1.at }).prefix(64) {
        let content = UNMutableNotificationContent()
        content.title = item.title
        content.body = item.body
        content.sound = .default
        content.userInfo = ["vbData": item.data]
        if let title = item.extendTitle {
          let category = categories[title] ?? UNNotificationCategory(
            identifier: "vb.extend.\(categories.count)",
            actions: [UNNotificationAction(identifier: "extend", title: title, options: [.foreground])],
            intentIdentifiers: [], options: [])
          categories[title] = category
          content.categoryIdentifier = category.identifier
        }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.at.timeIntervalSinceNow), repeats: false)
        requests.append(UNNotificationRequest(identifier: idPrefix + item.id, content: content, trigger: trigger))
      }
      center.setNotificationCategories(Set(categories.values))
      for request in requests { try? await center.add(request) }
      done()
    }
  }

  private func enqueue(action: String, json: String) {
    let data = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    let payload: [String: Any] = ["action": action, "data": data]
    if let d = deliver { d(payload) } else { pending.append(payload) }
  }

  // UNUserNotificationCenterDelegate. Nonisolated because iOS doesn't promise the main thread.

  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                          withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }

  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                          withCompletionHandler completionHandler: @escaping () -> Void) {
    let request = response.notification.request
    let action: String?
    switch response.actionIdentifier {
    case UNNotificationDefaultActionIdentifier: action = "open"
    case "extend": action = "extend"
    default: action = nil
    }
    if let action, request.identifier.hasPrefix(idPrefix) {
      let json = request.content.userInfo["vbData"] as? String ?? "{}"
      Task { @MainActor in self.enqueue(action: action, json: json) }
    }
    completionHandler()
  }
}
