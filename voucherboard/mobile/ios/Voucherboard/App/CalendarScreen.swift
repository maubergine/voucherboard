import SwiftUI

struct CalendarScreen: View {
  let model: AppModel
  @State private var cal: CalendarView?
  @State private var selected: String?
  @State private var cancelling: Row?

  var body: some View {
    NavigationStack {
      List {
        SignedOutBanner(model: model)
        if let cal = cal {
          Section { MonthGrid(cal: cal) { selected = $0 } }
          let a = cal.selected
          Section {
            if a.items.isEmpty { Text("Nothing booked or planned.").foregroundStyle(.secondary) }
            ForEach(a.items, id: \.rowID) { row in
              Button { model.open(row) } label: { RowView(row: row, showDay: false) }.buttonStyle(.plain)
                .rowSwipe(model: model, row: row, cancelling: $cancelling)
            }
            NavigationLink(value: a.dk) { Label("Day timeline", systemImage: "calendar.day.timeline.left") }
            if a.bookable {
              Button { model.book(.init(days: [a.dk])) } label: { Label("Book on this day", systemImage: "plus") }
            }
          } header: {
            VStack(alignment: .leading, spacing: 2) {
              Text(a.title).font(.headline).foregroundStyle(.primary).textCase(nil)
              Text(a.ctl).font(.footnote).textCase(nil)
            }
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("Calendar")
      .navigationDestination(for: String.self) { DayScreen(model: model, dk: $0) }
      .cancelAlert(model: model, cancelling: $cancelling)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink { BoardScreen(model: model, standalone: false) } label: { Label("Board", systemImage: "rectangle.split.3x1") }
        }
      }
      .task(id: "\(model.version)|\(selected ?? "")") {
        cal = await model.view("calendar", selected.map { ["dk": $0] } ?? [:])
      }
    }
  }
}

/// The booking window as weeks, with dots for booked and planned days.
private struct MonthGrid: View {
  let cal: CalendarView
  let pick: (String) -> Void
  private let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

  var body: some View {
    LazyVGrid(columns: cols, spacing: 6) {
      ForEach(Array(cal.weekdays.enumerated()), id: \.offset) { Text($0.element).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
      ForEach(cal.days) { d in
        Button { pick(d.dk) } label: {
          VStack(spacing: 3) {
            Text("\(d.date)")
              .font(.body.weight(d.today ? .bold : .regular)).monospacedDigit()
              .foregroundStyle(d.selected ? Color.white : d.off || !d.enabled ? Color.secondary : d.today ? Color.vbAccent : Color.primary)
              .frame(width: 34, height: 34)
              .background(Circle().fill(d.selected ? Color.vbAccent : .clear))
            HStack(spacing: 3) {
              if d.booked { Circle().fill(Color.vbAccent).frame(width: 5, height: 5) }
              if d.planned { Circle().strokeBorder(Color.vbAccent, lineWidth: 1).frame(width: 5, height: 5) }
            }
            .frame(height: 5)
          }
          .frame(maxWidth: .infinity)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!d.enabled)
        .accessibilityLabel(Text([d.label, d.booked ? "booked" : nil, d.planned ? "planned" : nil, d.off ? "no controls" : nil].compactMap { $0 }.joined(separator: ", ")))
        .accessibilityAddTraits(d.selected ? .isSelected : [])
      }
    }
    .padding(.vertical, 6)
  }
}

/// One day: vehicles down the side, time across, as on the board. Tap a block to open it, or an empty slot to book.
struct DayScreen: View {
  let model: AppModel
  @State var dk: String
  @State private var day: DayTimeline?
  @State private var board: Board?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let d = day {
        Text(d.ctl).font(.footnote).foregroundStyle(.secondary).padding(.horizontal)
        if d.lanes.isEmpty {
          Text(d.bookable ? "Nothing booked. Book a visitor to add one." : "Nothing booked.").font(.subheadline).foregroundStyle(.secondary).padding(.horizontal)
        }
      }
      if let b = board {
        BoardGrid(board: b, selection: [], tap: { model.open($0) }, tapEmpty: { vrn, dk, m in
          model.book(.init(vrns: [vrn], days: [dk], from: m, to: m + 60))
        })
      }
    }
    .padding(.top, 8)
    .background(Color(.systemBackground))
    .navigationTitle(day?.title ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button { if let p = day?.prev { dk = p } } label: { Label("Previous day", systemImage: "chevron.left") }
        Button { if let n = day?.next { dk = n } } label: { Label("Next day", systemImage: "chevron.right") }
      }
    }
    .task(id: "\(model.version)|\(dk)") {
      day = await model.view("day", ["dk": dk])
      board = await model.view("board", ["zoom": "day", "dk": dk])
    }
  }
}

/// A booking or a planned entry on a timeline.
struct BlockView: View {
  let block: Block
  var compact: Bool
  var selected = false

  var body: some View {
    let plan = block.status == "plan"
    let fill: Color = plan ? Color.vbAccent.opacity(0.08) : block.status == "past" ? .vbPast : .vbAccent
    RoundedRectangle(cornerRadius: compact ? 4 : 6)
      .fill(fill)
      .overlay {
        if plan { RoundedRectangle(cornerRadius: compact ? 4 : 6).strokeBorder(Color.vbAccent, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) }
      }
      .overlay {
        if block.status == "live" { RoundedRectangle(cornerRadius: compact ? 4 : 6).strokeBorder(Color.vbOk, lineWidth: 2.5) }
        if selected { RoundedRectangle(cornerRadius: compact ? 4 : 6).strokeBorder(Color.vbSel, lineWidth: 3) }
      }
      .overlay(alignment: .topLeading) {
        if !compact {
          Text(block.label).font(.caption2.weight(.bold)).monospacedDigit()
            .foregroundStyle(plan ? Color.vbAccent : .white).padding(4).lineLimit(1).minimumScaleFactor(0.7)
        }
      }
      .opacity(block.changing ? 0.45 : 1)
      .contentShape(Rectangle())
      .accessibilityElement()
      .accessibilityLabel(Text("\(block.label), \(plan ? "planned" : block.status == "live" ? "on now" : block.status == "past" ? "finished" : "booked")"))
      .accessibilityAddTraits(.isButton)
  }
}
