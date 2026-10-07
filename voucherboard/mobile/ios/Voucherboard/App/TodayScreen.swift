import SwiftUI

struct TodayScreen: View {
  let model: AppModel
  @State private var today: TodayView?
  @State private var cancelling: Row?

  var body: some View {
    NavigationStack {
      List {
        Text("Today").font(.largeTitle.weight(.bold)).accessibilityAddTraits(.isHeader)
          .listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 0))
        if let home = model.home {
          Section {
            StatusHeader(home: home)
            HStack(spacing: 10) {
              Button { model.book() } label: { Text("Book a visitor").fontWeight(.semibold) }.primaryAction()
              ScanMenu(model: model).secondaryAction()
              Spacer(minLength: 0)
              if home.testMode { TestTag() }
            }
            .listRowSeparator(.hidden)
          } footer: {
            if !home.updated.isEmpty { Text(home.updated.prefix(1).uppercased() + home.updated.dropFirst()) }
          }
          if home.signedOut == true { Section { SignedOutBanner(model: model) } }
        }
        if let t = today {
          if !t.live.isEmpty {
            Section("On now") { ForEach(t.live) { LiveCard(model: model, live: $0) } }
          }
          Section {
            if t.next.isEmpty {
              Text("Nothing booked or planned for the next 7 days.").foregroundStyle(.secondary)
            }
            ForEach(t.next, id: \.rowID) { row in
              Button { model.open(row) } label: { RowView(row: row) }.buttonStyle(.plain)
                .rowSwipe(model: model, row: row, cancelling: $cancelling)
            }
            if t.more > 0 {
              Button("\(t.more) more in Calendar") { model.tab = .calendar }
            }
          } header: { Text("Next 7 days") }
          if !t.favourites.isEmpty {
            Section("Favourites") {
              ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                  ForEach(t.favourites) { f in
                    Button { model.book(.init(vrns: [f.vrn])) } label: {
                      VStack(alignment: .leading, spacing: 6) {
                        PlateBadge(plate: f.plate, size: 13)
                        Text(f.nick).font(.subheadline.weight(.medium)).lineLimit(1)
                      }
                      .padding(10)
                      .frame(minWidth: 110, alignment: .leading)
                      .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Book \(f.nick)"))
                  }
                }
                .padding(.vertical, 2)
              }
              .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
          }
        }
      }
      .listStyle(.insetGrouped)
      .contentMargins(.top, 4, for: .scrollContent)
      // No navigation bar: its row would be empty here, so the heading is part of the list.
      .toolbar(.hidden, for: .navigationBar)
      .cancelAlert(model: model, cancelling: $cancelling)
      .refreshable { await model.act("load", ["keepPermits": true]) }
      .task(id: model.version) { today = await model.view("today") }
    }
  }
}

struct TestTag: View {
  var body: some View {
    Text("TEST MODE").font(.caption2.weight(.heavy)).tracking(0.8)
      .padding(.horizontal, 8).padding(.vertical, 3)
      .background(Color(UIColor(hex: 0xf2c94c)), in: RoundedRectangle(cornerRadius: 5))
      .foregroundStyle(Color(UIColor(hex: 0x1b2540)))
      .accessibilityLabel("Test mode is on")
  }
}

/// Scan a plate with the camera or from a photo, then book it.
struct ScanMenu: View {
  let model: AppModel

  var body: some View {
    Menu {
      Button { model.scanToBook("camera") } label: { Label("Scan with camera", systemImage: "camera") }
      Button { model.scanToBook("photos") } label: { Label("Choose a photo", systemImage: "photo") }
    } label: {
      Label("Scan", systemImage: "camera.viewfinder")
    }
    .accessibilityLabel("Scan a plate")
  }
}

/// A visit in progress: how far through it is, and Extend.
struct LiveCard: View {
  let model: AppModel
  let live: TodayView.Live

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        PlateBadge(plate: live.plate, size: 17)
        if live.name != live.plate { Text(live.name).font(.headline).lineLimit(1) }
        Spacer()
        PillView(pill: Pill(text: "On now", tone: "live"))
      }
      ProgressView(value: Double(live.pct), total: 100).tint(.vbOk)
      HStack {
        Text(live.time).monospacedDigit()
        Text("·").foregroundStyle(.secondary)
        Text(live.vouchers).foregroundStyle(.secondary)
        Spacer()
        Text(live.ends).font(.subheadline.weight(.semibold))
      }
      .font(.subheadline)
      Text(live.note).font(.footnote).foregroundStyle(.secondary)
      HStack(spacing: 10) {
        if live.canExtend, let x = live.extend {
          Button { model.book(.init(extend: x)) } label: { Label("Extend", systemImage: "clock.arrow.circlepath") }.primaryAction()
        }
        Button("Details") { model.sheet = .visit(live.key) }.secondaryAction()
      }
      .controlSize(.regular)
    }
    .padding(.vertical, 4)
  }
}
