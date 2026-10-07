import SwiftUI

/// Every booking and planned item. Select to tick several, then change their times or cancel and remove them together.
struct ListScreen: View {
  @Bindable var model: AppModel
  @State private var list: ListView?
  /// Vehicles to show only, as chips above the list like the extension's "Show only". Kept here rather than as search
  /// tokens, which iOS clears when search closes.
  @State private var shown: [VehicleToken] = []
  @State private var query = ""
  @State private var sort = "date"
  @State private var past = false
  @State private var cancelling: Row?
  @State private var bulk: BulkView?

  private var keys: [String] { Array(model.listSelection).sorted() }

  var body: some View {
    NavigationStack {
      List(selection: $model.listSelection) {
        SignedOutBanner(model: model)
        if !shown.isEmpty { Section { chips } }
        if let l = list {
          Section {
            if l.rows.isEmpty { Text(l.empty).foregroundStyle(.secondary) }
            ForEach(l.rows) { it in
              Group {
                if model.listSelecting {
                  // Tapping ticks the row here, so it isn't a button.
                  RowView(row: it.row).opacity(it.pick ? 1 : 0.45).accessibilityHint(Text(it.why ?? ""))
                } else {
                  Button { model.open(it.row) } label: { RowView(row: it.row) }.buttonStyle(.plain)
                    .rowSwipe(model: model, row: it.row, cancelling: $cancelling)
                }
              }
              .tag(it.sel)
              .selectionDisabled(!it.pick)
            }
          } footer: { Text(l.summary) }
        }
      }
      .listStyle(.insetGrouped)
      .environment(\.editMode, .constant(model.listSelecting ? .active : .inactive))
      .navigationTitle("List")
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { sortMenu }
        ToolbarItem(placement: .topBarTrailing) {
          Button(model.listSelecting ? "Done" : "Select") { let on = !model.listSelecting; model.endListSelect(); model.listSelecting = on }
        }
      }
      .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: shown.isEmpty ? "Show only a name or plate" : "Add another name or plate")
      .searchSuggestions {
        ForEach(matches) { v in
          Button { shown.append(VehicleToken(v)); query = "" } label: {
            HStack { if v.name != v.plate { Text(v.name).foregroundStyle(.primary) }; Spacer(); PlateBadge(plate: v.plate, size: 12) }
          }
        }
      }
      .onSubmit(of: .search) { if let v = matches.first { shown.append(VehicleToken(v)); query = "" } }
      .safeAreaInset(edge: .bottom) { if model.listSelecting { actionBar } }
      .cancelAlert(model: model, cancelling: $cancelling)
      .confirmationDialog("\(bulk?.action ?? "")?", isPresented: Binding(get: { bulk != nil }, set: { if !$0 { bulk = nil } }),
                          titleVisibility: .visible, presenting: bulk) { b in
        Button(b.cancels ? "Yes, cancel" : "Yes, remove", role: .destructive) {
          let k = keys
          Task {
            await model.act("bulkApply", ["keys": k], progress: b.cancels ? "Cancelling…" : nil)
            model.endListSelect()
          }
        }
        Button("Keep", role: .cancel) { }
      } message: { b in
        if b.cancels { Text("Cancelling goes to the council site straight away. Cancelled vouchers go back to your unused vouchers.") }
      }
      .refreshable { await model.act("load", ["keepPermits": true]) }
      .task(id: "\(model.version)|\(shown.map(\.vrn))|\(sort)|\(past)") {
        list = await model.view("list", ["vrns": shown.map(\.vrn), "sort": sort, "past": past])
        if let l = list { model.listSelection.formIntersection(l.rows.filter(\.pick).map(\.sel)) }
      }
    }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(shown) { t in
          Button { shown.removeAll { $0.vrn == t.vrn } } label: {
            HStack(spacing: 6) {
              if let name = t.name { Text(name).font(.subheadline.weight(.semibold)) }
              PlateBadge(plate: t.plate, size: 11)
              Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color.vbSoft, in: Capsule())
          }
          .buttonStyle(.plain)
          .accessibilityLabel(Text("Stop showing only \(t.name ?? t.plate)"))
        }
        if shown.count > 1 { Button("Clear") { shown = [] }.font(.subheadline) }
      }
      .padding(.vertical, 2)
    }
    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
  }

  /// Vehicles in the list that match what's typed, by name or plate, and aren't chips already.
  private var matches: [ListView.Vehicle] {
    let q = query.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty, let vs = list?.vehicles else { return [] }
    let plateQ = q.replacingOccurrences(of: " ", with: "").uppercased()
    return vs.filter { v in !shown.contains { $0.vrn == v.vrn } && (v.name.localizedCaseInsensitiveContains(q) || v.vrn.contains(plateQ)) }
  }

  private var sortMenu: some View {
    Menu {
      Picker("Sort", selection: $sort) {
        Label("Sort by date", systemImage: "calendar").tag("date")
        Label("Sort by name", systemImage: "person").tag("name")
      }
      .pickerStyle(.inline)
      Toggle("Show finished", isOn: $past)
    } label: {
      Label("Sort", systemImage: sort == "date" && !past ? "arrow.up.arrow.down.circle" : "arrow.up.arrow.down.circle.fill")
    }
  }

  private var actionBar: some View {
    let n = model.listSelection.count, books = model.listSelection.contains { $0.hasPrefix("b:") }
    return HStack(spacing: 10) {
      Text("\(n) selected").font(.subheadline.weight(.semibold)).monospacedDigit()
      Spacer(minLength: 0)
      Button("Change time") { model.sheet = .bulkTime(keys) }.secondaryAction().disabled(n == 0)
      Button(books ? "Cancel" : "Remove") {
        let k = keys
        Task { bulk = await model.view("bulk", ["keys": k]) }
      }
      .secondaryAction().tint(Color.vbBad).disabled(n == 0)
    }
    .padding(.horizontal, 16).padding(.vertical, 10)
    .floatingGlass()
    .padding(.horizontal, 16).padding(.bottom, 8)
  }
}

/// New times for the ticked items: all to one time, or each moved by some minutes. Bookings go into the plan as changes.
struct BulkTimeSheet: View {
  let model: AppModel
  let keys: [String]
  @State private var mode = "set"
  @State private var from = -1
  @State private var to = -1
  @State private var shift = 15
  @State private var v: BulkTimesView?
  @Environment(\.dismiss) private var dismiss

  private var args: [String: Any] { ["keys": keys, "mode": mode, "from": from, "to": to, "shift": shift] }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("How", selection: $mode) { Text("One time for all").tag("set"); Text("Move each").tag("shift") }
            .pickerStyle(.segmented)
          if mode == "set" {
            let r = timeRanges(v?.limits)
            HStack(spacing: 12) {
              TimeMenu(label: "From", value: max(from, 0), range: r.from) { from = $0; if to <= $0 { to = min($0 + 60, r.until.upperBound) } }
              TimeMenu(label: "Until", value: max(to, 0), range: r.until) { to = $0 }
            }
          } else {
            Stepper(value: $shift, in: -720...720, step: 5) { Text(shiftText).monospacedDigit() }
          }
        } footer: { Text("Nothing is sent until you review your plan.") }
        if let v = v {
          Section {
            Text(v.text).font(.subheadline)
            ForEach(v.bad, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
          }
        }
      }
      .navigationTitle("Change \(keys.count == 1 ? "1 time" : "\(keys.count) times")")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(v?.apply ?? "Apply") {
            let a = args
            Task {
              let r = await model.act("bulkMove", a)
              if r.err == nil { model.endListSelect(); model.sheet = nil }
            }
          }
          .disabled((v?.ok ?? 0) == 0)
        }
      }
      .task(id: "\(mode)|\(from)|\(to)|\(shift)") {
        v = await model.view("bulkTimes", args)
        if from < 0, let v = v { from = v.from; to = v.to }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private var shiftText: String {
    if shift == 0 { return "No change" }
    let m = abs(shift), h = m / 60, r = m % 60
    let amount = h == 0 ? "\(r) min" : r == 0 ? "\(h) h" : "\(h) h \(r) min"
    return "\(amount) \(shift > 0 ? "later" : "earlier")"
  }
}

/// A vehicle the List tab shows only.
struct VehicleToken: Identifiable, Hashable {
  let vrn: String, plate: String, name: String?
  var id: String { vrn }
  init(_ v: ListView.Vehicle) { vrn = v.vrn; plate = v.plate; name = v.name == v.plate ? nil : v.name }
}
