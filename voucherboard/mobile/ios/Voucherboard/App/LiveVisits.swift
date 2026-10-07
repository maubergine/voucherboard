import ActivityKit
import Foundation

/// Keeps one Live Activity per visitor parked now, from the Today view the app fetches on every engine change. It can
/// only start one while the app is open; once started, the countdown runs on its own and the activity goes stale at
/// the end time. Opening the app again ends the ones that are over.
@MainActor
final class LiveVisits {
  static let shared = LiveVisits()
  private let most = 3

  func sync(_ today: TodayView) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let wanted = today.liveActivity ? Array(today.live.prefix(most)) : []
    let current = Activity<VisitActivity>.activities

    for a in current where !wanted.contains(where: { $0.key == a.attributes.key }) {
      Task { await a.end(nil, dismissalPolicy: .immediate) }
    }
    for v in wanted {
      let state = VisitActivity.ContentState(
        start: Date(timeIntervalSinceNow: v.startIn / 1000), end: Date(timeIntervalSinceNow: v.endIn / 1000), ends: v.ends,
        extendURL: v.extend.flatMap { VisitActivity.url("extend", ["vrn": $0.vrn, "dk": $0.dk, "end": String($0.end)]) })
      let content = ActivityContent(state: state, staleDate: state.end)
      if let a = current.first(where: { $0.attributes.key == v.key }) {
        let old = a.content.state
        // Times are re-derived on every sync, so they wobble by a little: only a real change is worth an update.
        if abs(old.end.timeIntervalSince(state.end)) > 30 || old.ends != state.ends || old.extendURL != state.extendURL {
          Task { await a.update(content) }
        }
      } else {
        let attributes = VisitActivity(key: v.key, plate: v.plate, name: v.name, zone: today.zone)
        _ = try? Activity.request(attributes: attributes, content: content, pushType: nil)
      }
    }
  }
}
