import SwiftUI

/// The terms and sign-in gates, then the four tabs. A phone turned sideways shows the board instead.
struct RootView: View {
  let model: AppModel
  @Environment(\.verticalSizeClass) private var vertical

  var body: some View {
    Group {
      if let home = model.home {
        switch home.phase {
        case "ready":
          if vertical == .compact { BoardScreen(model: model, standalone: true) } else { MainTabs(model: model) }
        case "terms": TermsScreen(model: model)
        case "signin":
          GateView(icon: "person.badge.key", title: "Sign in to the council site",
                   text: "Voucherboard uses your own council account. You sign in on Lewisham's own page. Voucherboard never sees or uses any of your login details.",
                   button: "Sign in", secondary: "Try the demo",
                   onSecondary: { Task { await model.act("startDemo") } }) { Task { await model.act("signIn") } }
        case "nopermit":
          GateView(icon: "ticket", title: "No active visitor permit",
                   text: "Voucherboard works with active visitor permits. Buy visitor vouchers on the council site first.",
                   button: "Open the council site") { Task { await model.act("openCouncil") } }
        case "error":
          GateView(icon: "exclamationmark.triangle", title: "Couldn't load your permits", text: home.error ?? "",
                   button: "Try again") { Task { await model.act("load", ["keepPermits": false]) } }
        default: LoadingView()
        }
      } else {
        LoadingView()
      }
    }
    .tint(.vbAccent)
    .sheet(item: Binding(get: { model.sheet }, set: { model.sheet = $0 })) { sheet in
      SheetHost(model: model, sheet: sheet)
    }
    .overlay(alignment: .bottom) {
      if let t = model.toast, model.sheet == nil {
        ToastView(toast: t) { model.undo($0) }
          .padding(.bottom, model.home?.tray != nil ? 150 : 96)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.spring(duration: 0.3), value: model.toast)
  }
}

struct LoadingView: View {
  var body: some View {
    VStack(spacing: 14) {
      ProgressView()
      Text("Loading your permits").font(.subheadline).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(.systemGroupedBackground))
  }
}

struct GateView: View {
  let icon: String
  let title: String
  let text: String
  let button: String
  var secondary: String? = nil
  var onSecondary: () -> Void = {}
  let action: () -> Void

  init(icon: String, title: String, text: String, button: String, secondary: String? = nil, onSecondary: @escaping () -> Void = {},
       action: @escaping () -> Void) {
    self.icon = icon; self.title = title; self.text = text; self.button = button
    self.secondary = secondary; self.onSecondary = onSecondary; self.action = action
  }

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: icon).font(.system(size: 44)).foregroundStyle(Color.vbAccent)
      Text(title).font(.title2.weight(.bold)).multilineTextAlignment(.center)
      Text(text).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
      Button(button, action: action).primaryAction().controlSize(.large).padding(.top, 6)
      if let s = secondary {
        Button(s, action: onSecondary).secondaryAction().controlSize(.large)
        Text("No account needed: the demo uses a made-up permit, and nothing is sent anywhere.")
          .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
      }
    }
    .padding(32)
    .frame(maxWidth: 520, maxHeight: .infinity)
    .frame(maxWidth: .infinity)
    .background(Color(.systemGroupedBackground))
  }
}

struct MainTabs: View {
  @Bindable var model: AppModel

  var body: some View {
    TabView(selection: $model.tab) {
      TodayScreen(model: model)
        .tabItem { Label("Today", systemImage: "car.fill") }.tag(AppTab.today)
      CalendarScreen(model: model)
        .tabItem { Label("Calendar", systemImage: "calendar") }.tag(AppTab.calendar)
      ListScreen(model: model)
        .tabItem { Label("List", systemImage: "checklist") }.tag(AppTab.list)
      VehiclesScreen(model: model)
        .tabItem { Label("Vehicles", systemImage: "list.bullet.rectangle") }.tag(AppTab.vehicles)
      MoreScreen(model: model)
        .tabItem { Label("More", systemImage: "ellipsis.circle") }.tag(AppTab.more)
    }
    .planTray(model: model)
    .modifier(MinimizeTabBar())
  }
}

private struct MinimizeTabBar: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26, *) { content.tabBarMinimizeBehavior(.onScrollDown) } else { content }
  }
}

/// The plan, when there is one: the tab bar's accessory on iOS 26, a floating bar above the tabs before.
private struct PlanTray: ViewModifier {
  let model: AppModel

  func body(content: Content) -> some View {
    if let tray = model.home?.tray {
      if #available(iOS 26, *) {
        content.tabViewBottomAccessory { TrayButton(model: model, tray: tray) }
      } else {
        content.safeAreaInset(edge: .bottom) {
          TrayButton(model: model, tray: tray).padding(.vertical, 10).floatingGlass().padding(.horizontal, 16).padding(.bottom, 54)
        }
      }
    } else {
      content
    }
  }
}

private struct TrayButton: View {
  let model: AppModel
  let tray: HomeView.Tray

  var body: some View {
    Button { model.sheet = .plan } label: {
      HStack(spacing: 10) {
        Image(systemName: tray.ready ? "checklist" : "exclamationmark.circle").foregroundStyle(tray.ready ? Color.vbAccent : Color.vbBad)
        // The tab bar's accessory shrinks when the tab bar does: then only the short title fits.
        ViewThatFits(in: .horizontal) {
          VStack(alignment: .leading, spacing: 0) {
            Text(tray.title).font(.subheadline.weight(.semibold))
            Text(tray.subtitle).font(.caption).foregroundStyle(.secondary)
          }
          .fixedSize()
          Text(tray.short).font(.subheadline.weight(.semibold)).fixedSize()
          Text(tray.short).font(.footnote.weight(.semibold)).lineLimit(1)
        }
        Spacer()
        Image(systemName: "chevron.up").font(.caption.weight(.bold)).foregroundStyle(.secondary)
      }
      .padding(.horizontal, 16)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityHint("Shows your plan")
  }
}

extension View {
  func planTray(model: AppModel) -> some View { modifier(PlanTray(model: model)) }
}

/// The zone, its controls and the voucher balance, at the top of Today.
struct StatusHeader: View {
  let home: HomeView

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 12) {
        Text(home.zone.code)
          .font(.title3.weight(.black))
          .frame(width: 42, height: 42)
          .foregroundStyle(.white)
          .background(Color.vbAccent, in: RoundedRectangle(cornerRadius: 10))
        VStack(alignment: .leading, spacing: 2) {
          Marquee(text: home.zone.name, font: .headline)
          HStack(spacing: 6) {
            Circle().fill(home.zone.live ? Color.vbOk : Color.secondary).frame(width: 8, height: 8)
            Text(home.zone.text).font(.subheadline).foregroundStyle(.secondary)
          }
        }
      }
      .accessibilityElement(children: .combine)
      VStack(alignment: .leading, spacing: 4) {
        if home.vouchers?.isEmpty == false { Text("Unused vouchers").font(.caption).foregroundStyle(.secondary) }
        VoucherTiles(vouchers: home.vouchers ?? [], empty: home.balance)
      }
    }
  }
}

/// Unused vouchers as one tile per type: the count large, the type beneath.
struct VoucherTiles: View {
  let vouchers: [HomeView.Vouchers]
  let empty: String

  var body: some View {
    HStack(spacing: 8) {
      if vouchers.isEmpty {
        Text(empty).font(.subheadline).foregroundStyle(.secondary)
      }
      ForEach(vouchers) { v in
        VStack(spacing: 0) {
          Text("\(v.n)").font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(Color.vbAccent)
          Text(v.label).font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color.vbSoft, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(v.n) unused \(v.label) \(v.n == 1 ? "voucher" : "vouchers")"))
      }
    }
  }
}

/// One line of text that, when too long to fit, scrolls to its end and back every few seconds.
struct Marquee: View {
  let text: String
  let font: Font
  @State private var full: CGFloat = 0
  @State private var box: CGFloat = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let over = max(0, full - box)
    Text(text).font(font).lineLimit(1).hidden()
      .frame(maxWidth: .infinity, alignment: .leading)
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { box = $0 }
      .overlay(alignment: .leading) {
        if over > 0 && !reduceMotion {
          TimelineView(.animation) { ctx in
            let x = Self.offset(at: ctx.date, over: over)
            // Fade only the edges that hide text, so the first letter isn't dimmed at rest.
            Text(text).font(font).lineLimit(1).fixedSize().offset(x: -x)
              .frame(maxWidth: .infinity, alignment: .leading)
              .mask(LinearGradient(stops: [.init(color: x > 0 ? .clear : .black, location: 0), .init(color: .black, location: 0.04),
                                           .init(color: .black, location: 0.9), .init(color: x < over ? .clear : .black, location: 1)],
                                   startPoint: .leading, endPoint: .trailing))
          }
        } else {
          Text(text).font(font).lineLimit(1)
        }
      }
      .clipped()
      .background { Text(text).font(font).fixedSize().hidden().onGeometryChange(for: CGFloat.self) { $0.size.width } action: { full = $0 } }
      .accessibilityLabel(Text(text))
  }

  /// Rest at the start, ease to the end, rest, ease back: 30 points a second, with 2.5 s pauses.
  static func offset(at date: Date, over: CGFloat) -> CGFloat {
    let pause = 2.5, move = max(1, Double(over) / 30), cycle = 2 * (pause + move)
    let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle)
    let ease = { (x: Double) in x * x * (3 - 2 * x) }
    switch t {
    case ..<pause: return 0
    case ..<(pause + move): return over * ease((t - pause) / move)
    case ..<(2 * pause + move): return over
    default: return over * (1 - ease((t - 2 * pause - move) / move))
    }
  }
}

/// Shown on every tab when the council has signed the user out.
struct SignedOutBanner: View {
  let model: AppModel

  var body: some View {
    if model.home?.signedOut == true {
      Banner(title: "You've been signed out of the council site.", text: "Your plan is saved on this phone. Sign in again to carry on.",
             action: ("Sign in again", { Task { await model.act("signIn") } }))
    }
  }
}

/// One host for every sheet, so a new sheet replaces the one before.
struct SheetHost: View {
  let model: AppModel
  let sheet: Sheet

  var body: some View {
    Group {
      switch sheet {
      case .quick(let start): QuickBookSheet(model: model, start: start)
      case .plan: PlanSheet(model: model)
      case .entry(let id): EntrySheet(model: model, id: id)
      case .visit(let key): VisitSheet(model: model, key: key)
      case .bulk(let keys): BulkSheet(model: model, keys: keys)
      case .bulkTime(let keys): BulkTimeSheet(model: model, keys: keys)
      case .run: RunSheet(model: model)
      case .newFavourite: NewFavouriteSheet(model: model)
      }
    }
    .tint(.vbAccent)
    .overlay(alignment: .bottom) {
      if let t = model.toast {
        ToastView(toast: t) { model.undo($0) }.padding(.bottom, 24).transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.spring(duration: 0.3), value: model.toast)
  }
}
