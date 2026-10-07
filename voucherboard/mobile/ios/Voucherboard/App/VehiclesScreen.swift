import SwiftUI

struct VehiclesScreen: View {
  let model: AppModel
  @State private var list: VehiclesView?
  @State private var query = ""

  var body: some View {
    NavigationStack {
      List {
        SignedOutBanner(model: model)
        if let l = list {
          if !l.favourites.isEmpty { Section("Favourites") { ForEach(l.favourites) { row($0) } } }
          if !l.others.isEmpty { Section("Other vehicles") { ForEach(l.others) { row($0) } } }
          if l.favourites.isEmpty && l.others.isEmpty {
            Text(query.isEmpty ? "No vehicles yet. Book a visitor to add one." : "No vehicle matches.").foregroundStyle(.secondary)
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Vehicles")
      .navigationDestination(for: String.self) { VehicleScreen(model: model, vrn: $0) }
      .searchable(text: $query, prompt: "Nickname or plate")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button { model.book() } label: { Label("Book a visitor", systemImage: "car") }
            Button { model.sheet = .newFavourite } label: { Label("New favourite", systemImage: "star") }
          } label: { Label("Add", systemImage: "plus") }
        }
      }
      .task(id: "\(model.version)|\(query)") { list = await model.view("vehicles", ["q": query]) }
    }
  }

  private func row(_ v: VehiclesView.Item) -> some View {
    NavigationLink(value: v.vrn) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          PlateBadge(plate: v.plate, size: 13)
          if v.name != v.plate { Text(v.name).font(.body.weight(.medium)).lineLimit(1) }
        }
        Text(v.status.text).font(.footnote).foregroundStyle(v.status.tone == "live" ? Color.vbOk : .secondary)
      }
      .padding(.vertical, 2)
    }
  }
}

/// One vehicle: what's booked and planned, Book, and its favourite.
struct VehicleScreen: View {
  let model: AppModel
  let vrn: String
  @State private var v: VehicleView?
  @State private var nick = ""
  @State private var confirmDelete = false
  @State private var saving = false
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    List {
      if let v = v {
        Section {
          VStack(alignment: .leading, spacing: 8) {
            PlateBadge(plate: v.plate, size: 24)
            Text(v.subtitle).font(.subheadline).foregroundStyle(.secondary)
          }
          .padding(.vertical, 4)
          Button { model.book(.init(vrns: [v.vrn])) } label: { Text(v.bookLabel).frame(maxWidth: .infinity) }
            .primaryAction().controlSize(.large).listRowSeparator(.hidden)
        }
        Section("Booked and planned") {
          if v.items.isEmpty { Text("Nothing booked or planned.").foregroundStyle(.secondary) }
          ForEach(v.items, id: \.rowID) { row in
            Button { model.open(row) } label: { RowView(row: row) }.buttonStyle(.plain)
          }
        }
        if !v.fav {
          Section {
            TextField("Nickname", text: $nick).textInputAutocapitalization(.words)
            Button(saving ? "Saving…" : "Save as a favourite") {
              saving = true
              Task {
                await model.act("saveFavourite", ["vrn": v.vrn, "nick": nick, "isNew": false])
                saving = false
              }
            }
            .disabled(nick.trimmingCharacters(in: .whitespaces).isEmpty || saving)
          } header: { Text("Favourite") } footer: {
            Text("Favourites are saved on the council site, so they show on its own pages too.")
          }
        }
        if v.canDelete {
          Section {
            Button("Delete favourite", role: .destructive) { confirmDelete = true }
          }
        }
      }
    }
    .listStyle(.insetGrouped)
    .navigationTitle(v?.title ?? "")
    .confirmationDialog("Delete this favourite?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete favourite", role: .destructive) {
        Task {
          let r = await model.act("deleteFavourite", ["vrn": vrn])
          if r.err == nil { dismiss() }
        }
      }
    } message: {
      Text("It's removed from your favourites on the council site. Bookings stay as they are.")
    }
    .task(id: model.version) {
      v = await model.view("vehicle", ["vrn": vrn])
      if nick.isEmpty, let n = v?.nick { nick = n }
    }
  }
}
