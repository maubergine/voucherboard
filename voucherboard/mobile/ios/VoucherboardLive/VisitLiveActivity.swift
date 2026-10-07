import ActivityKit
import SwiftUI
import WidgetKit

@main
struct VoucherboardLiveBundle: WidgetBundle {
  var body: some Widget { VisitLiveActivity() }
}

private let accent = Color(red: 0x2b / 255, green: 0x49 / 255, blue: 0x72 / 255)
private let ok = Color(red: 0x4c / 255, green: 0xb8 / 255, blue: 0x62 / 255)

/// A visitor parked now: time left counting down, how far through, and Extend. The countdown and the bar run on their
/// own, so the app doesn't need to update them; after the end time the activity is stale and says so.
struct VisitLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VisitActivity.self) { context in
      LockScreen(context: context)
        .activityBackgroundTint(accent.opacity(0.92))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(context.attributes.visitURL)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 4) {
            LivePlate(plate: context.attributes.plate, size: 14)
            if context.attributes.name != context.attributes.plate { Text(context.attributes.name).font(.caption).lineLimit(1).foregroundStyle(.secondary) }
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 2) {
            Countdown(state: context.state, stale: context.isStale).font(.title3.weight(.semibold))
            Text(context.state.ends).font(.caption).foregroundStyle(.secondary)
          }
          .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            Bar(state: context.state)
            if let url = context.state.extendURL, !context.isStale { ExtendLink(url: url) }
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Text(context.attributes.plate.split(separator: " ").first.map(String.init) ?? context.attributes.plate)
          .font(.caption.weight(.heavy)).foregroundStyle(ok)
      } compactTrailing: {
        Countdown(state: context.state, stale: context.isStale).font(.caption.weight(.semibold)).frame(maxWidth: 52)
      } minimal: {
        Image(systemName: "car.fill").foregroundStyle(ok)
      }
      .widgetURL(context.attributes.visitURL)
      .keylineTint(ok)
    }
  }
}

private struct LockScreen: View {
  let context: ActivityViewContext<VisitActivity>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 5) {
          LivePlate(plate: context.attributes.plate, size: 17)
          if context.attributes.name != context.attributes.plate { Text(context.attributes.name).font(.subheadline.weight(.semibold)).lineLimit(1) }
          Text([context.attributes.zone.isEmpty ? nil : "Zone \(context.attributes.zone)", context.state.ends].compactMap { $0 }.joined(separator: " · "))
            .font(.caption).opacity(0.8)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 0) {
          Countdown(state: context.state, stale: context.isStale).font(.system(size: 30, weight: .semibold))
          Text(context.isStale ? " " : "left").font(.caption).opacity(0.8)
        }
      }
      Bar(state: context.state)
      if let url = context.state.extendURL, !context.isStale { ExtendLink(url: url) }
    }
    .foregroundStyle(.white)
    .padding(16)
  }
}

private struct Countdown: View {
  let state: VisitActivity.ContentState
  let stale: Bool

  var body: some View {
    if stale || state.end <= Date() {
      Text("Ended")
    } else {
      Text(timerInterval: max(state.start, Date())...state.end, countsDown: true)
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
    }
  }
}

private struct Bar: View {
  let state: VisitActivity.ContentState

  var body: some View {
    ProgressView(timerInterval: state.start...max(state.start.addingTimeInterval(60), state.end), countsDown: false) {
      EmptyView()
    } currentValueLabel: {
      EmptyView()
    }
    .tint(ok)
  }
}

private struct ExtendLink: View {
  let url: URL

  var body: some View {
    Link(destination: url) {
      Label("Extend", systemImage: "clock.arrow.circlepath")
        .font(.subheadline.weight(.semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(.white.opacity(0.18), in: Capsule())
    }
    .foregroundStyle(.white)
  }
}

/// A number plate, as in the app.
private struct LivePlate: View {
  let plate: String
  let size: CGFloat

  var body: some View {
    HStack(spacing: size * 0.35) {
      Rectangle().fill(accent).frame(width: size * 0.4)
      Text(plate)
        .font(.system(size: size, weight: .bold).width(.condensed))
        .tracking(size * 0.05)
        .foregroundStyle(Color(red: 0.07, green: 0.07, blue: 0.07))
        .lineLimit(1)
        .padding(.trailing, size * 0.45)
        .padding(.vertical, size * 0.08)
    }
    .background(Color(red: 0.97, green: 0.97, blue: 0.945))
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color(red: 0.106, green: 0.145, blue: 0.251), lineWidth: max(1.5, size / 9)))
    .fixedSize()
  }
}
