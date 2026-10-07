import SwiftUI

/// The board: vehicles down the side and days across, for a week, four weeks or one day. A phone turned sideways shows
/// it full screen; on iPad it opens from Calendar. Select mode picks several blocks to cancel or remove together.
struct BoardScreen: View {
  @Bindable var model: AppModel
  let standalone: Bool
  @State private var zoom = "week"
  @State private var cursor: String?
  @State private var board: Board?
  @State private var selecting = false

  var body: some View {
    if standalone { NavigationStack { content } } else { content }
  }

  private var content: some View {
    VStack(spacing: 0) {
      if let b = board { BoardGrid(board: b, selection: selecting ? model.boardSelection : [], tap: tap) } else { Spacer() }
    }
    .background(Color(.systemBackground))
    .navigationTitle(board?.label ?? "Board")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarLeading) {
        Picker("Show", selection: $zoom) {
          Text("4 weeks").tag("cal")
          Text("Week").tag("week")
          Text("Day").tag("day")
        }
        .pickerStyle(.segmented)
        .fixedSize()
      }
      ToolbarItemGroup(placement: .topBarTrailing) {
        if zoom != "cal" {
          Button { cursor = board?.prev } label: { Label("Earlier", systemImage: "chevron.left") }
          Button { cursor = board?.next } label: { Label("Later", systemImage: "chevron.right") }
        }
        if selecting {
          Button("Manage \(model.boardSelection.count)") { model.sheet = .bulk(Array(model.boardSelection).sorted()) }
            .disabled(model.boardSelection.isEmpty)
          Button("Done") { selecting = false; model.boardSelection = [] }
        } else {
          Button("Select") { selecting = true }
        }
      }
    }
    .onChange(of: zoom) { cursor = nil }
    .task(id: "\(model.version)|\(zoom)|\(cursor ?? "")") {
      var args: [String: Any] = ["zoom": zoom]
      if let c = cursor { args["dk"] = c }
      board = await model.view("board", args)
    }
  }

  private func tap(_ b: Block) {
    guard selecting else { return model.open(b) }
    // Only planned items and upcoming bookings can be managed together, as on the web UI.
    guard b.status == "plan" || b.status == "up" else { return }
    if model.boardSelection.contains(b.sel) { model.boardSelection.remove(b.sel) } else { model.boardSelection.insert(b.sel) }
  }
}

struct BoardGrid: View {
  let board: Board
  let selection: Set<String>
  let tap: (Block) -> Void
  /// A tap on an empty part of a lane: its vehicle, day and time (to the quarter hour).
  var tapEmpty: ((String, String, Int) -> Void)?
  private let labelWidth: CGFloat = 104
  private let rowHeight: CGFloat = 46

  var body: some View {
    GeometryReader { geo in
      let n = CGFloat(board.days.count)
      let dayWidth = (geo.size.width - labelWidth) / max(1, n)
      let span = CGFloat(max(1, board.to - board.from))
      let x = { (m: Int) in CGFloat(m - board.from) / span * dayWidth }
      VStack(spacing: 0) {
        header(dayWidth: dayWidth, x: x)
        Divider()
        ScrollView {
          LazyVStack(spacing: 0) {
            if board.lanes.isEmpty {
              Text("Nothing booked or planned here.").font(.subheadline).foregroundStyle(.secondary).padding(24)
            }
            ForEach(board.lanes) { lane in
              HStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                  PlateBadge(plate: lane.plate, size: 11)
                  if lane.name != lane.plate { Text(lane.name).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                .frame(width: labelWidth, alignment: .leading)
                .padding(.leading, 8)
                ZStack(alignment: .topLeading) {
                  ForEach(Array(board.days.enumerated()), id: \.offset) { i, d in
                    dayBackground(d, width: dayWidth, x: x).offset(x: CGFloat(i) * dayWidth)
                      .onTapGesture { p in
                        guard d.bookable, let f = tapEmpty else { return }
                        f(lane.vrn, d.dk, board.from + Int(p.x / dayWidth * span) / 15 * 15)
                      }
                  }
                  ForEach(lane.blocks, id: \.sel) { b in
                    let w = max(6, x(b.t) - x(b.f))
                    BlockView(block: b, compact: board.zoom != "day" || w < 60, selected: selection.contains(b.sel))
                      .frame(width: w, height: rowHeight - 14)
                      .offset(x: CGFloat(b.dayIndex) * dayWidth + x(b.f), y: 7)
                      .onTapGesture { tap(b) }
                  }
                  if let now = board.now {
                    Rectangle().fill(Color.vbBad).frame(width: 2, height: rowHeight)
                      .offset(x: CGFloat(now.dayIndex) * dayWidth + x(now.min) - 1).allowsHitTesting(false)
                  }
                }
                .frame(width: dayWidth * n, height: rowHeight, alignment: .topLeading)
                .clipped()
              }
              .padding(.trailing, 0)
              Divider()
            }
          }
        }
      }
    }
  }

  @ViewBuilder private func header(dayWidth: CGFloat, x: @escaping (Int) -> CGFloat) -> some View {
    HStack(spacing: 0) {
      Color.clear.frame(width: labelWidth + 8, height: board.zoom == "day" ? 22 : 30)
      if board.zoom == "day" {
        ZStack(alignment: .leading) {
          ForEach(board.hours, id: \.min) { h in
            Text(h.short).font(.caption2).monospacedDigit().foregroundStyle(.secondary).offset(x: x(h.min) - 6)
          }
        }
        .frame(width: dayWidth, alignment: .leading)
      } else {
        ForEach(board.days) { d in
          Text(d.label)
            .font(.caption.weight(d.today ? .bold : .regular))
            .foregroundStyle(d.today ? Color.vbAccent : d.off ? .secondary : .primary)
            .frame(width: dayWidth)
        }
      }
    }
    .padding(.vertical, 4)
  }

  private func dayBackground(_ d: Board.Day, width: CGFloat, x: @escaping (Int) -> CGFloat) -> some View {
    ZStack(alignment: .topLeading) {
      Rectangle().fill(d.off ? Color(.tertiarySystemFill) : d.today ? Color.vbAccent.opacity(0.04) : .clear)
      ForEach(d.controls, id: \.self) { c in
        Rectangle().fill(Color.vbAccent.opacity(0.08)).frame(width: max(0, x(c.t) - x(c.f)), height: rowHeight).offset(x: x(c.f))
      }
      Rectangle().fill(Color(.separator)).frame(width: 0.5, height: rowHeight)
    }
    .frame(width: width, height: rowHeight)
  }
}
