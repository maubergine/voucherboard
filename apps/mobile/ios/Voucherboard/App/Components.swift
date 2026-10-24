import SwiftUI

// Colours, the plate badge, pills, and Liquid Glass with fallbacks for iOS 17 and 18.

extension Color {
  /// Light and dark values, with stronger ones when Increase Contrast is on.
  private static func dynamic(_ light: UInt32, _ dark: UInt32, _ hiLight: UInt32? = nil, _ hiDark: UInt32? = nil) -> Color {
    Color(UIColor { t in
      let hi = t.accessibilityContrast == .high
      return UIColor(hex: t.userInterfaceStyle == .dark ? (hi ? hiDark ?? dark : dark) : (hi ? hiLight ?? light : light))
    })
  }
  static let vbAccent = dynamic(0x2b4972, 0x8fb0e0, 0x172b48, 0xbcd2f2)
  static let vbOk = dynamic(0x2f6b3a, 0x7cc489, 0x1b4a25, 0xa6e0b0)
  static let vbOkSoft = dynamic(0xe1f1e3, 0x1f3a24)
  static let vbBad = dynamic(0xb3261e, 0xff8a80, 0x861a13, 0xffb4ac)
  static let vbWarnSoft = dynamic(0xfff4e0, 0x3a2e14)
  static let vbSoft = dynamic(0xe3e9f2, 0x26324a, 0xd0d9e8, 0x1a2336)
  static let vbPast = dynamic(0x5f6b78, 0x5d6880)
  /// Vouchers in a booking that aren't running: white text on it is at least 4.5:1.
  static let vbUpcoming = dynamic(0x3f6aa0, 0x3d5a85)
  /// Grey for text that carries information (times, notes), at least 4.5:1 where the system grey isn't.
  static let vbText2 = dynamic(0x515a68, 0xb4bccb, 0x2c323d, 0xdce2ea)
  /// Text on an accent fill: white in light mode, navy on dark mode's light blue.
  static let vbOnAccent = dynamic(0xffffff, 0x14213a)
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
  /// How far the badge grows with the text size, so a plate still fits on one line.
  var maxScale: CGFloat = 2.2
  @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

  var body: some View {
    let size = min(self.size * scale, self.size * maxScale)
    HStack(spacing: size * 0.4) {
      Rectangle().fill(Color(UIColor(hex: 0x2b4972))).frame(width: size * 0.42)
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
    .accessibilityLabel(Text("Plate " + spelt(plate)))
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

/// A plate for VoiceOver, character by character: "T U 4 4 V W X".
func spelt(_ plate: String) -> String { plate.filter { !$0.isWhitespace }.map(String.init).joined(separator: " ") }

/// Side by side, or one above the other at the accessibility text sizes.
struct AdaptiveStack<Content: View>: View {
  @Environment(\.dynamicTypeSize) private var type
  var spacing: CGFloat = 10
  @ViewBuilder let content: () -> Content

  var body: some View {
    if type.isAccessibilitySize { VStack(alignment: .leading, spacing: spacing, content: content) } else { HStack(spacing: spacing, content: content) }
  }
}

extension View {
  /// Reads `text` out with VoiceOver when it appears or changes, as for an error under a field.
  func announce(_ text: String?) -> some View {
    onChange(of: text) { _, new in
      if let t = new, !t.isEmpty { AccessibilityNotification.Announcement(t).post() }
    }
  }
}

/// A booking or planned entry in a list. At the accessibility text sizes the day goes above it.
struct RowView: View {
  let row: Row
  var showDay = true
  @Environment(\.dynamicTypeSize) private var type

  var body: some View {
    if type.isAccessibilitySize {
      VStack(alignment: .leading, spacing: 6) {
        if showDay { Text("\(row.day) \(row.date)").font(.subheadline.weight(.bold)).foregroundStyle(row.day == "Today" ? Color.vbAccent : Color.vbText2) }
        PlateBadge(plate: row.plate, size: 13)
        if row.name != row.plate { Text(row.name).font(.subheadline) }
        Text(row.time).font(.subheadline).monospacedDigit().foregroundStyle(Color.vbText2)
        PillView(pill: row.pill)
      }
      .contentShape(Rectangle())
    } else {
      regular
    }
  }

  private var regular: some View {
    HStack(spacing: 12) {
      if showDay {
        VStack(spacing: 0) {
          Text(row.day).font(.caption.weight(.bold)).foregroundStyle(row.day == "Today" ? Color.vbAccent : Color.vbText2)
          Text(row.date).font(.caption2).foregroundStyle(Color.vbText2)
        }
        .frame(width: 48)
      }
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          PlateBadge(plate: row.plate, size: 13)
          if row.name != row.plate { Text(row.name).font(.subheadline).lineLimit(1) }
        }
        Text(row.time).font(.subheadline).monospacedDigit().foregroundStyle(Color.vbText2)
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

/// The message after an action, with Undo when it can be undone, and Close when it stays until closed.
struct ToastView: View {
  let toast: Toast
  let close: () -> Void
  let undo: (Int) -> Void
  @Environment(\.dynamicTypeSize) private var type

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
      // At the accessibility text sizes, three lines at most, so it doesn't cover the screen.
      Text(toast.text).font(.subheadline).lineLimit(type.isAccessibilitySize ? 3 : nil).frame(maxWidth: .infinity, alignment: .leading)
      if let id = toast.undo {
        Button("Undo") { undo(id) }.font(.subheadline.weight(.semibold))
      }
      if toast.sticky {
        Button(action: close) { Image(systemName: "xmark").font(.subheadline.weight(.semibold)) }
          .accessibilityLabel("Close")
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 12)
    .floatingGlass()
    .padding(.horizontal, 16)
    .accessibilityElement(children: .contain)
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
/// starts 15 minutes after `earliest` (now, for a booking that starts now).
func timeRanges(_ limits: Span?, earliest: Int = 0) -> (from: ClosedRange<Int>, until: ClosedRange<Int>) {
  let f = limits?.f ?? 0, t = limits?.t ?? (23 * 60 + 55)
  let lo = min(max(f + 15, (earliest + 15 + 4) / 5 * 5), t)
  return (f...max(f, t - 15), lo...t)
}

/// A typed time as minutes after midnight: "10:30", "10.30", "1030", "930" or "10". Nil if it isn't one.
func parseTime(_ s: String) -> Int? {
  let t = s.trimmingCharacters(in: .whitespaces)
  let parts = t.split(whereSeparator: { ":.".contains($0) }).map(String.init)
  let h: Int?, m: Int?
  if parts.count == 2, parts[1].count == 2 { h = Int(parts[0]); m = Int(parts[1]) }
  else if parts.count == 1, t.allSatisfy(\.isNumber), (1...4).contains(t.count) {
    h = Int(t.count > 2 ? String(t.dropLast(2)) : t); m = t.count > 2 ? Int(t.suffix(2)) : 0
  } else { return nil }
  guard let h, let m, (0...23).contains(h), (0...59).contains(m) else { return nil }
  return h * 60 + m
}

/// A time chooser: tap for a field to type the time in, above hour and minute wheels in 5 minutes, within `range`.
struct TimePicker: View {
  let label: String
  let value: Int
  var range: ClosedRange<Int> = 0...(23 * 60 + 55)
  var enabled = true
  let pick: (Int) -> Void
  @State private var open = false

  var body: some View {
    Button { open = true } label: {
      VStack(alignment: .leading, spacing: 2) {
        Text(label).font(.caption).foregroundStyle(.secondary)
        Text(hm(value)).font(.title2.weight(.semibold)).monospacedDigit()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 14).padding(.vertical, 10)
      .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
    }
    .buttonStyle(.borderless) // two in one Form row: each takes only its own taps
    .disabled(!enabled)
    .popover(isPresented: $open) {
      VStack(spacing: 8) {
        TimeField(label: label, range: range, pick: pick) { open = false }
        TimeWheels(value: value, range: range, pick: pick).fixedSize()
      }
      .padding([.horizontal, .top])
      .presentationCompactAdaptation(.popover)
    }
    .accessibilityLabel(Text("\(label) \(hm(value))"))
  }
}

/// Type a time instead of spinning. A whole time ("10:30", "1030") is set as typed, which moves the wheels; Return sets
/// a shorter one ("930", "10") and closes. Outside `range`, it says what's allowed.
private struct TimeField: View {
  let label: String
  let range: ClosedRange<Int>
  let pick: (Int) -> Void
  let done: () -> Void
  @State private var text = ""
  @State private var bad = false
  @FocusState private var focused: Bool

  var body: some View {
    VStack(spacing: 4) {
      TextField("HH:MM", text: $text)
        .font(.title3.weight(.semibold)).monospacedDigit()
        .multilineTextAlignment(.center)
        .keyboardType(.numbersAndPunctuation)
        .submitLabel(.done)
        .focused($focused)
        .padding(.vertical, 6)
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel(Text("Type \(label.lowercased()) time"))
        .onSubmit {
          if let m = parseTime(text), range.contains(m) { bad = false; pick(m); done() } else { bad = !text.isEmpty; focused = bad }
        }
        .onChange(of: text) {
          bad = false
          let whole = text.contains(where: { ":.".contains($0) }) || text.filter(\.isNumber).count == 4
          if whole, let m = parseTime(text) { if range.contains(m) { pick(m) } else { bad = true } }
        }
      if bad {
        Text("Between \(hm(range.lowerBound)) and \(hm(range.upperBound))").font(.footnote).foregroundStyle(.red)
      }
    }
  }
}

/// UIKit's time wheels, hours beside minutes. Times outside `range` (minutes after midnight) spin back.
private struct TimeWheels: UIViewRepresentable {
  let value: Int
  let range: ClosedRange<Int>
  let pick: (Int) -> Void

  // Midnight in GMT, so no clock change falls inside the day.
  fileprivate static let day = Date(timeIntervalSinceReferenceDate: 0)
  private static func date(_ m: Int) -> Date { day.addingTimeInterval(TimeInterval(m * 60)) }

  func makeUIView(context: Context) -> UIDatePicker {
    let p = UIDatePicker()
    p.datePickerMode = .time
    p.preferredDatePickerStyle = .wheels
    p.minuteInterval = 5
    p.timeZone = TimeZone(secondsFromGMT: 0)
    p.locale = Locale(identifier: "en_GB") // 24-hour, like every other time in the app
    p.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
    return p
  }

  func updateUIView(_ p: UIDatePicker, context: Context) {
    context.coordinator.pick = pick
    p.minimumDate = Self.date(range.lowerBound)
    p.maximumDate = Self.date(range.upperBound)
    let d = Self.date(value)
    if p.date != d { p.setDate(d, animated: p.window != nil) } // spins to a typed time, not on opening
  }

  func makeCoordinator() -> Coordinator { Coordinator(pick) }

  final class Coordinator: NSObject {
    var pick: (Int) -> Void
    init(_ pick: @escaping (Int) -> Void) { self.pick = pick }
    @objc func changed(_ p: UIDatePicker) { pick(Int((p.date.timeIntervalSince(TimeWheels.day) / 60).rounded())) }
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
