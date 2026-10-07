import SwiftUI

// Colours, the plate badge, pills, and Liquid Glass with fallbacks for iOS 17 and 18.

extension Color {
  private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
    Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
  }
  static let vbAccent = dynamic(0x2b4972, 0x8fb0e0)
  static let vbOk = dynamic(0x2f6b3a, 0x7cc489)
  static let vbOkSoft = dynamic(0xe1f1e3, 0x1f3a24)
  static let vbBad = dynamic(0xb3261e, 0xff8a80)
  static let vbWarnSoft = dynamic(0xfff4e0, 0x3a2e14)
  static let vbSoft = dynamic(0xe3e9f2, 0x26324a)
  static let vbPast = dynamic(0x98a8b4, 0x5d6880)
  static let vbSel = Color(UIColor(hex: 0xd06b00))
}

extension UIColor {
  convenience init(hex: UInt32) {
    self.init(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
  }
}

/// A number plate: a light badge with a blue band, in a narrow bold face, as on the web UI.
struct PlateBadge: View {
  let plate: String
  var size: CGFloat = 15

  var body: some View {
    HStack(spacing: size * 0.4) {
      Rectangle().fill(Color.vbAccent).frame(width: size * 0.42)
      Text(plate)
        .font(.system(size: size, weight: .bold, design: .default).width(.condensed))
        .tracking(size * 0.06)
        .foregroundStyle(Color(UIColor(hex: 0x111111)))
        .lineLimit(1)
        .fixedSize()
        .padding(.trailing, size * 0.5)
        .padding(.vertical, size * 0.1)
    }
    .background(Color(UIColor(hex: 0xf7f7f1)))
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color(UIColor(hex: 0x1b2540)), lineWidth: max(1.5, size / 8)))
    .accessibilityLabel(Text("Plate \(plate)"))
  }
}

struct PillView: View {
  let pill: Pill

  var body: some View {
    let (fg, bg): (Color, Color) = switch pill.tone {
    case "live": (.vbOk, .vbOkSoft)
    case "past": (.secondary, Color(.tertiarySystemFill))
    case "change": (.vbBad, Color.vbBad.opacity(0.12))
    default: (.vbAccent, .vbSoft)
    }
    Text(pill.text)
      .font(.caption.weight(.heavy))
      .padding(.horizontal, 8).padding(.vertical, 2)
      .foregroundStyle(fg)
      .background {
        if pill.tone == "plan" {
          Capsule().strokeBorder(Color.vbAccent, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        } else {
          Capsule().fill(bg)
        }
      }
  }
}

/// A booking or planned entry in a list.
struct RowView: View {
  let row: Row
  var showDay = true

  var body: some View {
    HStack(spacing: 12) {
      if showDay {
        VStack(spacing: 0) {
          Text(row.day).font(.caption.weight(.bold)).foregroundStyle(row.day == "Today" ? Color.vbAccent : .secondary)
          Text(row.date).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(width: 48)
      }
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          PlateBadge(plate: row.plate, size: 13)
          if row.name != row.plate { Text(row.name).font(.subheadline).lineLimit(1) }
        }
        Text(row.time).font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      PillView(pill: row.pill)
    }
    .contentShape(Rectangle())
  }
}

// MARK: Liquid Glass

extension View {
  /// The main action on a screen: prominent glass on iOS 26, a filled button before.
  @ViewBuilder func primaryAction() -> some View {
    if #available(iOS 26, *) { buttonStyle(.glassProminent) } else { buttonStyle(.borderedProminent) }
  }

  @ViewBuilder func secondaryAction() -> some View {
    if #available(iOS 26, *) { buttonStyle(.glass) } else { buttonStyle(.bordered) }
  }

  /// A floating control (the toast, the plan tray): glass on iOS 26, a material before.
  @ViewBuilder func floatingGlass(cornerRadius: CGFloat = 22, tint: Color? = nil) -> some View {
    if #available(iOS 26, *) {
      glassEffect(tint.map { .regular.tint($0).interactive() } ?? .regular.interactive(), in: .rect(cornerRadius: cornerRadius))
    } else {
      background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
        .shadow(color: .black.opacity(0.12), radius: 10, y: 3)
    }
  }
}

/// The message after an action, with Undo when it can be undone.
struct ToastView: View {
  let toast: Toast
  let undo: (Int) -> Void

  var body: some View {
    HStack(spacing: 12) {
      Group {
        if toast.busy, let p = toast.progress {
          ProgressPie(value: p)
        } else if toast.busy {
          ProgressView().controlSize(.small)
        } else {
          Image(systemName: toast.error ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            .foregroundStyle(toast.error ? Color.vbBad : Color.vbOk)
            .symbolEffect(.bounce, value: toast.id)
            .transition(.scale.combined(with: .opacity))
        }
      }
      .frame(width: 20, height: 20)
      Text(toast.text).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
      if let id = toast.undo {
        Button("Undo") { undo(id) }.font(.subheadline.weight(.semibold))
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 12)
    .floatingGlass()
    .padding(.horizontal, 16)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.updatesFrequently)
  }
}

/// A message across the top of a list: signed out, test mode, an error.
struct Banner: View {
  let title: String
  var text: String = ""
  var tone: Color = .vbWarnSoft
  var action: (label: String, run: () -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.subheadline.weight(.semibold))
      if !text.isEmpty { Text(text).font(.footnote).foregroundStyle(.secondary) }
      if let action = action { Button(action.label, action: action.run).primaryAction().controlSize(.small).padding(.top, 2) }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(tone, in: RoundedRectangle(cornerRadius: 12))
  }
}

/// Minutes after midnight as 24-hour time.
func hm(_ m: Int) -> String { String(format: "%02d:%02d", (m / 60) % 24, m % 60) }

/// What the From and Until pickers offer: the controlled hours, since hours outside them need no voucher. Until
/// starts after `earliest` (now, for a booking that starts now).
func timeRanges(_ limits: Span?, earliest: Int = 0) -> (from: ClosedRange<Int>, until: ClosedRange<Int>) {
  let f = limits?.f ?? 0, t = limits?.t ?? (23 * 60 + 45)
  let lo = min(max(f + 15, (earliest + 15 + 14) / 15 * 15), t)
  return (f...max(f, t - 15), lo...t)
}

/// A time chooser in quarter hours, which is how the council books.
struct TimeMenu: View {
  let label: String
  let value: Int
  var range: ClosedRange<Int> = 0...(23 * 60 + 45)
  var enabled = true
  let pick: (Int) -> Void

  var body: some View {
    Menu {
      ForEach(Array(stride(from: range.lowerBound - range.lowerBound % 15, through: range.upperBound, by: 15)), id: \.self) { m in
        Button(hm(m)) { pick(m) }
      }
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(label).font(.caption).foregroundStyle(.secondary)
        Text(hm(value)).font(.title2.weight(.semibold)).monospacedDigit()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 14).padding(.vertical, 10)
      .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
    }
    .disabled(!enabled)
    .accessibilityLabel(Text("\(label) \(hm(value))"))
  }
}

extension View {
  /// Swipe on a booking or planned row: remove a planned item, or cancel a booking after `cancelAlert` asks.
  /// No destructive role: it removes the row at once, before the engine's reply, and the list update then fails.
  func rowSwipe(model: AppModel, row: Row, cancelling: Binding<Row?>) -> some View {
    swipeActions(edge: .trailing, allowsFullSwipe: row.kind == "entry") {
      if row.kind == "entry", let id = row.id {
        Button(row.pill.tone == "plan" && row.time.hasPrefix("Change") ? "Drop" : "Remove") {
          Task { await model.act("removeEntry", ["id": id]) }
        }
        .tint(Color.vbBad)
      } else if row.canCancel == true {
        // Cancelling goes to the council site straight away, so it asks first.
        Button("Cancel") { cancelling.wrappedValue = row }.tint(Color.vbBad)
      }
    }
  }

  func cancelAlert(model: AppModel, cancelling: Binding<Row?>) -> some View {
    alert("Cancel this booking?", isPresented: Binding(get: { cancelling.wrappedValue != nil }, set: { if !$0 { cancelling.wrappedValue = nil } }),
          presenting: cancelling.wrappedValue) { row in
      Button("Cancel booking", role: .destructive) { if let key = row.key { Task { await model.act("cancelVisit", ["key": key], progress: "Cancelling…") } } }
      Button("Keep it", role: .cancel) { }
    } message: { row in
      Text("\(row.plate), \(row.day) \(row.date), \(row.time). \(row.cancelText ?? "") This goes to the council site straight away.")
    }
  }
}

/// A pie that fills as a cancel goes through its vouchers; the result's tick replaces it.
struct ProgressPie: View {
  let value: Double

  var body: some View {
    ZStack {
      Circle().strokeBorder(Color.vbAccent.opacity(0.35), lineWidth: 1.5)
      PieSlice(fraction: value).fill(Color.vbAccent).padding(3.5)
    }
    .animation(.easeInOut(duration: 0.3), value: value)
    .accessibilityLabel(Text("\(Int((value * 100).rounded())) percent done"))
  }
}

private struct PieSlice: Shape {
  var fraction: Double
  var animatableData: Double { get { fraction } set { fraction = newValue } }

  func path(in rect: CGRect) -> Path {
    var p = Path()
    let c = CGPoint(x: rect.midX, y: rect.midY)
    p.move(to: c)
    p.addArc(center: c, radius: min(rect.width, rect.height) / 2, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * min(max(fraction, 0), 1)), clockwise: false)
    p.closeSubpath()
    return p
  }
}
