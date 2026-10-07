import SwiftUI

/// Book a visitor: vehicle (typed, picked or scanned), when, how long. Add to plan, or Book now after a check step.
/// The form (`q`) lives in the engine's shape; every change goes through the engine, which returns the new view.
struct QuickBookSheet: View {
  let model: AppModel
  let start: QuickStart
  @State private var view: QuickView?
  @State private var typed = ""
  @State private var sugg: Suggestions?
  @State private var scan = ScanState()
  @State private var newVehicle: NewVehicle?
  @State private var confirming = false
  @FocusState private var focus: Field?
  enum Field { case search, plate, nick }
  @Environment(\.dismiss) private var dismiss

  struct ScanState { var busy = false; var cands: [ActionResult.Candidate] = []; var err: String? }
  struct NewVehicle { var plate: String; var save = false; var nick = ""; var scanned = false; var error: String?; var checking = false }

  var body: some View {
    NavigationStack {
      Form {
        if let v = view {
          vehicleSection(v)
          whenSection(v)
          lengthSection(v)
          Section {
            Text(v.preview.text).font(.subheadline.weight(.semibold)).foregroundStyle(v.preview.bad ? Color.vbBad : .primary)
            ForEach(v.preview.notes, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
          }
        } else {
          ProgressView().frame(maxWidth: .infinity)
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .navigationTitle("Book a visitor")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
      .safeAreaInset(edge: .bottom) {
        if let v = view, focus == nil {
          HStack(spacing: 12) {
            Button {
              Task {
                let r = await model.act("addToPlan", ["q": v.q.json])
                if r.err == nil { model.sheet = nil }
              }
            } label: { Text("Add to plan").frame(maxWidth: .infinity) }
            .secondaryAction().disabled(!v.preview.canAdd)
            Button { confirming = true } label: { Text("Book now").frame(maxWidth: .infinity) }
              .primaryAction().disabled(!v.preview.canBook)
          }
          .controlSize(.large)
          .padding(.horizontal, 20).padding(.vertical, 10)
        }
      }
      .navigationDestination(isPresented: $confirming) {
        if let v = view { ConfirmStep(model: model, q: v.q) }
      }
    }
    .presentationDetents([.large])
    .task { await begin() }
    .task(id: typed) {
      let exclude = view?.q.vrns ?? []
      sugg = await model.view("suggest", ["text": typed, "exclude": exclude])
    }
  }

  private func begin() async {
    guard view == nil else { return }
    let s = start.view
    if let form = s.form { view = await model.view("quickView", ["q": form.json]) }
    else if let x = s.extend { view = await model.view("quickExtend", ["vrn": x.vrn, "dk": x.dk, "end": x.end]) }
    else {
      var opts: [String: Any] = ["vrns": s.vrns]
      if let d = s.days { opts["days"] = d }
      if let f = s.from { opts["from"] = f }
      if let t = s.to { opts["to"] = t }
      view = await model.view("quickInit", ["opts": opts])
      if s.days == [] { model.show(Toast(text: "Pick the days, then add them to your plan.")) }
    }
    scan.cands = start.cands
    scan.err = start.err
    if let source = start.scan { await runScan(source) }
  }

  private func update(_ name: String, _ args: [String: Any] = [:]) {
    guard let q = view?.q else { return }
    Task { if let v: QuickView = await model.view(name, args.merging(["q": q.json]) { a, _ in a }) { view = v } }
  }

  private func setVehicles(_ vrns: [String]) {
    guard var q = view?.q else { return }
    q.vrns = vrns
    Task { if let v: QuickView = await model.view("quickView", ["q": q.json]) { view = v } }
  }

  private func add(_ vrn: String) {
    guard let v = view else { return }
    if !v.q.vrns.contains(vrn) { setVehicles(v.q.vrns + [vrn]) }
    typed = ""
    newVehicle = nil
    focus = nil
  }

  private func runScan(_ source: String) async {
    scan = ScanState(busy: true)
    let r = await model.engine.callScan(source)
    scan.busy = false
    if r.cancelled == true { return }
    scan.cands = r.cands ?? []
    scan.err = r.err
  }

  // MARK: Sections

  @ViewBuilder private func vehicleSection(_ v: QuickView) -> some View {
    Section {
      if !v.vehicles.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(v.vehicles) { veh in
              Button { setVehicles(v.q.vrns.filter { $0 != veh.vrn }) } label: {
                HStack(spacing: 6) {
                  Text(veh.name).font(.subheadline.weight(.semibold))
                  Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Color.vbSoft, in: Capsule())
              }
              .buttonStyle(.plain)
              .accessibilityLabel(Text("Remove \(veh.name)"))
            }
          }
        }
      }
      HStack {
        TextField(v.q.vrns.isEmpty ? "Name or plate, or a new plate" : "Add another vehicle", text: $typed)
          .textInputAutocapitalization(.characters).autocorrectionDisabled()
          .focused($focus, equals: .search)
        Menu {
          Button { Task { await runScan("camera") } } label: { Label("Use camera", systemImage: "camera") }
          Button { Task { await runScan("photos") } } label: { Label("Choose a photo", systemImage: "photo") }
        } label: { Label("Scan", systemImage: "camera.viewfinder") }
        .accessibilityLabel("Scan a number plate")
      }
      scanResults
      if let s = sugg {
        if typed.trimmingCharacters(in: .whitespaces).isEmpty {
          if v.q.vrns.isEmpty && !s.matches.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
              HStack(spacing: 8) {
                ForEach(s.matches) { m in
                  Button(m.nick) { add(m.vrn) }.secondaryAction().controlSize(.small)
                }
              }
            }
          }
        } else {
          ForEach(s.matches) { m in
            Button { add(m.vrn) } label: {
              HStack { if m.name != m.plate { Text(m.name).foregroundStyle(.primary) }; Spacer(); PlateBadge(plate: m.plate, size: 12) }
            }
          }
          if let vrn = s.newVrn, let plate = s.newPlate {
            Button { newVehicle = NewVehicle(plate: plate); typed = ""; focus = nil } label: {
              HStack { Text("New vehicle").fontWeight(.semibold).foregroundStyle(.primary); Spacer(); PlateBadge(plate: plate, size: 12) }
            }
            .accessibilityLabel(Text("New vehicle \(vrn)"))
          }
          if s.matches.isEmpty && s.newVrn == nil { Text("No vehicle matches.").foregroundStyle(.secondary) }
        }
      }
    } header: { Text("Vehicle") }
    if newVehicle != nil { newVehicleSection }
  }

  @ViewBuilder private var scanResults: some View {
    if scan.busy {
      HStack(spacing: 8) { ProgressView(); Text("Reading the number plate…").foregroundStyle(.secondary) }
    } else if let err = scan.err {
      Text(err).font(.footnote).foregroundStyle(Color.vbBad)
    } else if !scan.cands.isEmpty {
      VStack(alignment: .leading, spacing: 8) {
        Text(scan.cands.count > 1 ? "Plates found. Tap the right one" : "Plate found. Tap to use it").font(.footnote.weight(.semibold))
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(scan.cands) { c in
              Button {
                scan = ScanState()
                if c.name != nil { add(c.vrn) } else { newVehicle = NewVehicle(plate: c.plate, scanned: true) }
              } label: {
                HStack(spacing: 6) { PlateBadge(plate: c.plate, size: 13); if let n = c.name { Text(n).font(.subheadline) } }
              }
              .buttonStyle(.plain)
            }
          }
        }
        Text("Check it matches the car before you book.").font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private var newVehicleSection: some View {
    let nv = Binding(get: { newVehicle ?? NewVehicle(plate: "") }, set: { newVehicle = $0 })
    return Section {
      TextField("Number plate", text: nv.plate)
        .textInputAutocapitalization(.characters).autocorrectionDisabled()
        .font(.title3.weight(.bold).width(.condensed))
        .focused($focus, equals: .plate)
      Toggle(isOn: nv.save) {
        VStack(alignment: .leading) { Text("Save as favourite"); Text("Saved to your council account with the first booking").font(.footnote).foregroundStyle(.secondary) }
      }
      if nv.wrappedValue.save { TextField("Nickname", text: nv.nick).textInputAutocapitalization(.words).focused($focus, equals: .nick) }
      if let e = nv.wrappedValue.error { Text(e).font(.footnote).foregroundStyle(Color.vbBad) }
      HStack {
        Button(nv.wrappedValue.checking ? "Checking…" : "Add vehicle") {
          guard let n = newVehicle else { return }
          focus = nil
          newVehicle?.checking = true
          newVehicle?.error = nil
          Task {
            let r = await model.act("addVehicle", ["vrn": n.plate, "save": n.save, "nick": n.nick])
            newVehicle?.checking = false
            if let err = r.err { newVehicle?.error = err } else if let vrn = r.vrn { add(vrn) }
          }
        }
        .primaryAction().disabled(nv.wrappedValue.checking)
        Spacer()
        Button("Cancel") { newVehicle = nil }
      }
      .buttonStyle(.borderless)
    } header: {
      Text(nv.wrappedValue.scanned ? "New vehicle (check it matches the car)" : "New vehicle")
    }
  }

  @ViewBuilder private func whenSection(_ v: QuickView) -> some View {
    Section("When") {
      Picker("When", selection: Binding(get: { v.when }, set: { update("quickWhen", ["when": $0]) })) {
        Text("Now").tag("now")
        Text("Today").tag("today")
        Text("Pick days").tag("days")
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      if let d = v.days {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(d.choices) { c in Button(c.label) { update("quickPickDays", ["id": c.id]) }.secondaryAction().controlSize(.small) }
          }
        }
        DayPicker(days: d.days) { update("quickToggleDay", ["dk": $0]) }
        Text(d.count > 0 ? (d.count == 1 ? "1 day chosen" : "\(d.count) days chosen") : "No days chosen").font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private func lengthSection(_ v: QuickView) -> some View {
    Section {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(v.presets) { p in
            Button(p.label) { update("quickPreset", ["preset": p.id]) }
              .controlSize(.small)
              .modifier(Chosen(on: p.on))
          }
        }
      }
      let r = timeRanges(v.limits, earliest: v.fromEditable ? 0 : v.from)
      HStack(spacing: 12) {
        TimeMenu(label: "From", value: v.from, range: r.from, enabled: v.fromEditable) { update("quickTime", ["which": "from", "min": $0]) }
        TimeMenu(label: "Until", value: v.to, range: r.until) { update("quickTime", ["which": "to", "min": $0]) }
      }
      Text(v.note).font(.footnote).foregroundStyle(.secondary)
    } header: { Text("How long") }
  }
}

/// A chip that's on (filled) or off.
private struct Chosen: ViewModifier {
  let on: Bool
  func body(content: Content) -> some View {
    if on { content.primaryAction().accessibilityAddTraits(.isSelected) } else { content.secondaryAction() }
  }
}

/// The days a booking can be made, as weeks.
struct DayPicker: View {
  let days: [QuickView.Days.Day]
  let toggle: (String) -> Void
  private let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

  var body: some View {
    LazyVGrid(columns: cols, spacing: 6) {
      ForEach(["M", "T", "W", "T", "F", "S", "S"].indices, id: \.self) { i in
        Text(["M", "T", "W", "T", "F", "S", "S"][i]).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      }
      ForEach(days) { d in
        Button { toggle(d.dk) } label: {
          Text("\(d.date)")
            .font(.subheadline.weight(d.today ? .bold : .regular)).monospacedDigit()
            .frame(maxWidth: .infinity, minHeight: 36)
            .foregroundStyle(d.on ? Color.white : !d.enabled || d.off ? Color.secondary : .primary)
            .background(RoundedRectangle(cornerRadius: 8).fill(d.on ? Color.vbAccent : d.off ? Color(.tertiarySystemFill) : .clear))
        }
        .buttonStyle(.plain)
        .disabled(!d.enabled)
        .accessibilityLabel(Text(d.label))
        .accessibilityAddTraits(d.on ? .isSelected : [])
      }
    }
  }
}

/// Check and book: what's about to be booked, the email switch, and the button.
struct ConfirmStep: View {
  let model: AppModel
  let q: QuickForm
  @State private var view: ConfirmView?
  @State private var email = false
  @State private var started = false

  var body: some View {
    Form {
      if let c = view {
        Section {
          if let plate = c.plate {
            VStack(alignment: .leading, spacing: 8) {
              PlateBadge(plate: plate, size: 24)
              if let n = c.name, n != plate { Text(n).font(.headline) }
            }
            .padding(.vertical, 4)
          } else {
            ScrollView(.horizontal, showsIndicators: false) { HStack { ForEach(c.plates, id: \.self) { PlateBadge(plate: $0, size: 15) } } }
          }
        }
        Section {
          LabeledContent(c.dayLabel, value: c.dayText)
          LabeledContent("Time", value: c.timeText).monospacedDigit()
          LabeledContent("Vouchers", value: c.vouchersText)
          Toggle("Send me a confirmation", isOn: $email)
        } footer: { Text(c.note) }
      }
    }
    .navigationTitle("Check and book")
    .safeAreaInset(edge: .bottom) {
      if let c = view {
        Button {
          started = true
          Task {
            let r = await model.act("bookNow", ["q": q.json, "email": email])
            if r.err != nil { started = false }
          }
        } label: { Text(c.goLabel).frame(maxWidth: .infinity) }
        .primaryAction().controlSize(.large).disabled(started)
        .padding(.horizontal, 20).padding(.vertical, 10)
      }
    }
    .task {
      guard view == nil else { return }
      let more: MoreView? = await model.view("more")
      email = more?.settings.emailAll ?? false
      view = await model.view("confirm", ["q": q.json, "email": email])
    }
  }
}

extension EngineClient {
  /// A scan opens the camera or photo picker, so it can take as long as the user does. Errors come back as `err`.
  func callScan(_ source: String) async -> ActionResult {
    (try? await call("scan", ["source": source], as: Optional<ActionResult>.self)) ?? ActionResult(err: "Couldn't read the picture. Try again, or type the plate.")
  }
}
