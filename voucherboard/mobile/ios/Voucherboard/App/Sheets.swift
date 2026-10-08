import SwiftUI

/// Your plan: what will be booked or cancelled, buying advice, and Review.
struct PlanSheet: View {
  let model: AppModel
  @State private var plan: PlanView?
  @State private var confirmClear = false
  @State private var buying: String?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        if let p = plan {
          if p.empty { Text("Your plan is empty.").foregroundStyle(.secondary) }
          ForEach(p.items) { it in
            Button { model.sheet = .entry(it.id) } label: {
              HStack(spacing: 12) {
                VStack(spacing: 0) {
                  Text(it.day).font(.caption.weight(.bold)).foregroundStyle(.secondary)
                  Text(it.date).font(.caption2).foregroundStyle(.secondary)
                }
                .frame(width: 48)
                VStack(alignment: .leading, spacing: 3) {
                  HStack { PlateBadge(plate: it.plate, size: 13); if it.change { PillView(pill: Pill(text: "Change", tone: "change")) } }
                  Text([it.time, it.need].filter { !$0.isEmpty }.joined(separator: " · ")).font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                  if let bad = it.bad { Text(bad).font(.footnote).foregroundStyle(Color.vbBad) }
                }
              }
            }
            .buttonStyle(.plain)
            .swipeActions {
              // No destructive role: see rowSwipe.
              Button(it.change ? "Drop" : "Remove") { Task { await model.act("removeEntry", ["id": it.id]) } }.tint(Color.vbBad)
            }
          }
          if let a = p.advice {
            Section {
              VStack(alignment: .leading, spacing: 8) {
                Text(a.title).font(.subheadline.weight(.semibold))
                Text(a.text).font(.footnote).foregroundStyle(.secondary)
                ForEach(a.buys) { b in
                  Button(buying == b.kind ? "Checking…" : b.label) {
                    buying = b.kind
                    Task {
                      let r = await model.act("buy", ["kind": b.kind, "n": b.n])
                      buying = nil
                      if r.err == nil { model.sheet = nil }
                    }
                  }
                  .primaryAction().controlSize(.small).disabled(buying != nil)
                }
              }
              .listRowBackground(a.tone == "warn" ? Color.vbWarnSoft : Color.vbSoft)
            }
          }
          if let cost = p.cost { Section { Text(cost).font(.subheadline.weight(.semibold)) } }
          if !p.empty {
            Section { Button("Clear plan", role: .destructive) { confirmClear = true } }
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Your plan")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .safeAreaInset(edge: .top) {
        if let p = plan { Text(p.subtitle).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.horizontal) }
      }
      .safeAreaInset(edge: .bottom) {
        if let p = plan {
          Button { Task { await model.act("review") } } label: { Text(p.reviewLabel).frame(maxWidth: .infinity) }
            .primaryAction().controlSize(.large).disabled(!p.ready)
            .padding(.horizontal, 20).padding(.vertical, 10)
        }
      }
      .confirmationDialog("Clear the whole plan?", isPresented: $confirmClear, titleVisibility: .visible) {
        Button("Clear plan", role: .destructive) { model.sheet = nil; Task { await model.act("clearPlan") } }
      }
      .task(id: model.version) { plan = await model.view("plan") }
    }
  }
}

/// A planned booking or change: its time, what it uses, and Remove.
struct EntrySheet: View {
  let model: AppModel
  let id: Int
  @State private var e: EntryView?
  @State private var gone = false
  @State private var from = 0
  @State private var to = 0
  @State private var err: String?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        if let e = e {
          Section {
            VStack(alignment: .leading, spacing: 8) {
              PlateBadge(plate: e.plate, size: 24)
              if e.name != e.plate { Text(e.name).font(.headline) }
            }
            .padding(.vertical, 4)
          } footer: { Text("Nothing is sent until you review your plan.") }
          Section {
            LabeledContent(e.dayText, value: e.ctl)
            let r = timeRanges(e.limits)
            HStack(spacing: 12) {
              TimeMenu(label: "From", value: from, range: r.from) { from = $0; if to <= $0 { to = min($0 + 60, r.until.upperBound) } }
              TimeMenu(label: "Until", value: to, range: r.until) { to = $0 }
            }
            if let err = err { Text(err).font(.footnote).foregroundStyle(Color.vbBad) }
          }
          if let cost = e.cost {
            Section {
              Text(cost).font(.subheadline.weight(.semibold))
              ForEach(e.notes, id: \.self) { n in Text(n.text).font(.footnote).foregroundStyle(n.tone == "bad" ? Color.vbBad : .secondary) }
            }
          }
          Section {
            Button(e.removeLabel, role: .destructive) { model.sheet = nil; Task { await model.act("removeEntry", ["id": id]) } }
          }
        } else if gone {
          Text("This is no longer in your plan.").foregroundStyle(.secondary)
        }
      }
      .navigationTitle(e?.title ?? "Planned booking")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save time") {
            Task {
              let r = await model.act("setEntryTime", ["id": id, "from": from, "to": to])
              if let x = r.err { err = x } else { model.sheet = nil }
            }
          }
          .disabled(e == nil || (from == e?.from && to == e?.to))
        }
      }
      .task(id: model.version) {
        let fresh: EntryView? = await model.view("entry", ["id": id])
        if e == nil, let f = fresh { from = f.from; to = f.to }
        e = fresh
        gone = fresh == nil
      }
    }
    .presentationDetents([.medium, .large])
  }
}

/// A booking: its vouchers, and Change time, Cancel, End early (experimental) or Book again.
struct VisitSheet: View {
  let model: AppModel
  let key: String
  @State private var v: VisitView?
  @State private var gone = false
  @State private var mode = ""
  @State private var from = 0
  @State private var to = 0
  @State private var option = 0
  @State private var busy = false
  @State private var err: String?
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        if let v = v {
          Section {
            HStack(alignment: .top) {
              VStack(alignment: .leading, spacing: 8) {
                PlateBadge(plate: v.plate, size: 24)
                if v.name != v.plate { Text(v.name).font(.headline) }
              }
              Spacer()
              PillView(pill: Pill(text: v.statusText, tone: v.status == "live" ? "live" : v.status == "past" ? "past" : "booked"))
            }
            .padding(.vertical, 4)
          }
          Section {
            LabeledContent("Day", value: v.dayText)
            LabeledContent("Time", value: v.time).monospacedDigit()
            VStack(alignment: .leading, spacing: 6) {
              LabeledContent("Vouchers", value: v.vouchersText)
              HStack(spacing: 3) {
                ForEach(Array(v.vouchers.enumerated()), id: \.offset) { _, b in
                  Text(b.label).font(.caption2.weight(.heavy)).monospacedDigit().foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 26)
                    .background(RoundedRectangle(cornerRadius: 5).fill(b.running ? Color.vbAccent : b.past ? Color.vbPast : Color.vbAccent.opacity(0.55)))
                }
              }
              Text(v.refs).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
          }
          switch mode {
          case "change": changeSection(v)
          case "cancel": cancelSection(v)
          case "end": endSection(v)
          default: actions(v)
          }
        } else if gone {
          Text("This booking is no longer on the council site.").foregroundStyle(.secondary)
        }
      }
      .navigationTitle("Booking")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .interactiveDismissDisabled(busy)
      .task(id: model.version) {
        let fresh: VisitView? = await model.view("visit", ["key": key])
        if v == nil, let f = fresh { from = f.start; to = f.end }
        v = fresh
        gone = fresh == nil
      }
    }
  }

  @ViewBuilder private func actions(_ v: VisitView) -> some View {
    Section {
      if v.canChange { Button("Change time") { mode = "change" } }
      Button("Book again") {
        model.book(.init(vrns: [v.vrn], days: [], from: v.start, to: v.end))
      }
      if v.canEndEarly { Button("End early", role: .destructive) { mode = "end" } }
      if v.canCancel { Button("Cancel booking", role: .destructive) { mode = "cancel" } }
    } footer: {
      if !v.note.isEmpty { Text(v.note) }
    }
  }

  @ViewBuilder private func changeSection(_ v: VisitView) -> some View {
    Section {
      let r = timeRanges(v.limits)
      HStack(spacing: 12) {
        TimeMenu(label: "From", value: from, range: r.from) { from = $0; if to <= $0 { to = min($0 + 60, r.until.upperBound) } }
        TimeMenu(label: "Until", value: to, range: r.until) { to = $0 }
      }
      if let err = err { Text(err).font(.footnote).foregroundStyle(Color.vbBad) }
      Button("Add change to plan") {
        Task {
          let r = await model.act("planChange", ["key": key, "from": from, "to": to])
          if let x = r.err { err = x } else { model.sheet = nil }
        }
      }
      .primaryAction()
      Button("Back") { mode = ""; err = nil }
    } header: { Text("Change time") } footer: {
      Text("The booking is cancelled and rebooked at the new time when you review your plan.")
    }
  }

  @ViewBuilder private func cancelSection(_ v: VisitView) -> some View {
    Section {
      VStack(alignment: .leading, spacing: 4) {
        Text("Cancel this booking?").font(.headline)
        Text("\(v.dayText), \(v.time)").font(.subheadline)
        Text(v.cancelText).font(.subheadline.weight(.semibold)).foregroundStyle(Color.vbBad)
      }
      Button(busy ? "Cancelling…" : "Cancel booking", role: .destructive) {
        busy = true
        Task { await model.act("cancelVisit", ["key": key]); model.sheet = nil }
      }
      .disabled(busy)
      Button("Keep it") { mode = "" }.disabled(busy)
    } footer: { Text("This goes to the council site straight away. It isn't added to your plan.") }
  }

  @ViewBuilder private func endSection(_ v: VisitView) -> some View {
    Section {
      Picker("End at", selection: $option) {
        ForEach(v.shrink) { o in
          VStack(alignment: .leading) { Text("End at \(o.end)").monospacedDigit(); Text(o.returns).font(.footnote).foregroundStyle(.secondary) }.tag(o.index)
        }
      }
      .pickerStyle(.inline)
      .labelsHidden()
      Button(busy ? "Cancelling…" : "End at \(v.shrink.first { $0.index == option }?.end ?? "")", role: .destructive) {
        busy = true
        Task { await model.act("endEarly", ["key": key, "index": option]); model.sheet = nil }
      }
      .disabled(busy || v.shrink.isEmpty)
      Button(v.keepLabel) { mode = "" }.disabled(busy)
    } header: { Text("End early (experimental)") } footer: {
      Text("The voucher running now can't be cancelled, so a booking can only end when a voucher ends.")
    }
  }
}

/// Several board items at once: cancel the bookings and remove the planned ones.
struct BulkSheet: View {
  let model: AppModel
  let keys: [String]
  @State private var b: BulkView?
  @State private var confirm = false
  @State private var busy = false
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        if let b = b {
          Section {
            ForEach(b.items, id: \.self) { it in
              HStack { PlateBadge(plate: it.plate, size: 13); Text(it.text).font(.subheadline).foregroundStyle(.secondary); Spacer(); PillView(pill: Pill(text: it.pill, tone: it.pill == "Planned" ? "plan" : "booked")) }
            }
          } footer: { if !b.note.isEmpty { Text(b.note) } }
          if let one = b.single {
            Section {
              Button("Change time") {
                model.boardSelection = []
                if one.hasPrefix("e:"), let id = Int(one.dropFirst(2)) { model.sheet = .entry(id) } else { model.sheet = .visit(String(one.dropFirst(2))) }
              }
            }
          }
          if !b.action.isEmpty {
            Section {
              Button(busy ? "Working…" : b.action, role: .destructive) { confirm = true }.disabled(busy)
            } footer: { if b.cancels { Text("Cancelling goes to the council site straight away.") } }
          }
        }
      }
      .navigationTitle(b?.title ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .confirmationDialog("\(b?.action ?? "")?", isPresented: $confirm, titleVisibility: .visible) {
        Button("Yes", role: .destructive) {
          busy = true
          Task {
            await model.act("bulkApply", ["keys": keys])
            model.boardSelection = []
            model.sheet = nil
          }
        }
        Button("Keep", role: .cancel) { }
      }
      .task(id: model.version) { b = await model.view("bulk", ["keys": keys]) }
    }
    .presentationDetents([.medium, .large])
  }
}

/// Save a new favourite: plate (typed or scanned) and nickname.
struct NewFavouriteSheet: View {
  let model: AppModel
  @State private var plate = ""
  @State private var nick = ""
  @State private var busy = false
  @State private var err: String?
  @State private var cands: [ActionResult.Candidate] = []
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        Section {
          HStack {
            TextField("Number plate", text: $plate).textInputAutocapitalization(.characters).autocorrectionDisabled()
            Menu {
              Button { scan("camera") } label: { Label("Use camera", systemImage: "camera") }
              Button { scan("photos") } label: { Label("Choose a photo", systemImage: "photo") }
            } label: { Label("Scan", systemImage: "camera.viewfinder") }
          }
          if !cands.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
              HStack { ForEach(cands) { c in Button { plate = c.plate; cands = [] } label: { PlateBadge(plate: c.plate, size: 13) }.buttonStyle(.plain) } }
            }
          }
          TextField("Nickname", text: $nick).textInputAutocapitalization(.words)
          if let err = err { Text(err).font(.footnote).foregroundStyle(Color.vbBad) }
        } footer: { Text("Saved to your council account") }
      }
      .navigationTitle("Save a new favourite")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "Saving…" : "Save") {
            busy = true
            err = nil
            Task {
              let r = await model.act("saveFavourite", ["vrn": plate, "nick": nick, "isNew": true])
              busy = false
              if let x = r.err { err = x } else { model.sheet = nil }
            }
          }
          .disabled(busy || plate.isEmpty || nick.isEmpty)
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func scan(_ source: String) {
    Task {
      let r = await model.engine.callScan(source)
      if r.cancelled == true { return }
      err = r.err
      cands = r.cands ?? []
      if cands.count == 1 { plate = cands[0].plate; cands = [] }
    }
  }
}
