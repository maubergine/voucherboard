import SwiftUI

/// Review and run: what will be sent, then each step as it goes to the council site, then the result.
struct RunSheet: View {
  let model: AppModel
  @State private var run: RunView?

  var body: some View {
    NavigationStack {
      List {
        if let r = run {
          if r.phase == "running" {
            Section {
              VStack(alignment: .leading, spacing: 8) {
                ProgressView(value: Double(r.progress), total: 100)
                Text(r.label).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
              }
            }
          }
          if r.phase == "done" {
            Section {
              VStack(spacing: 10) {
                Image(systemName: r.failed ? "xmark.circle.fill" : "checkmark.circle.fill")
                  .font(.system(size: 52)).foregroundStyle(r.failed ? Color.vbBad : Color.vbOk)
                  .symbolEffect(.bounce, value: r.phase)
                Text(r.note).multilineTextAlignment(.center)
              }
              .frame(maxWidth: .infinity)
              .padding(.vertical, 8)
              .accessibilityElement(children: .combine)
              if let rem = r.reminder {
                VStack(alignment: .leading, spacing: 2) { Text(rem).font(.subheadline.weight(.semibold)); Text("Change this in More.").font(.footnote).foregroundStyle(.secondary) }
              }
            }
          }
          if r.phase == "review" {
            Section { LabeledContent("Unused", value: r.balance) }
          }
          Section {
            ForEach(r.ops) { op in
              HStack(spacing: 10) {
                PillView(pill: Pill(text: op.tag, tone: op.kind == "cancel" ? "change" : "booked"))
                PlateBadge(plate: op.plate, size: 12)
                Text(op.text).font(.footnote).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 2) {
                  status(op)
                  if let e = op.err { Text(e).font(.caption2).foregroundStyle(Color.vbBad).multilineTextAlignment(.trailing) }
                }
              }
            }
          } header: { if r.phase == "review" { Text(r.heading).font(.headline).foregroundStyle(.primary).textCase(nil) } }
          if r.phase == "review" {
            Section {
              Text(r.info).font(.footnote)
            } footer: { Text(r.modeNote) }
          }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle(run?.title ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          if let r = run {
            Text(r.tag.uppercased()).font(.caption2.weight(.heavy)).tracking(0.8)
              .padding(.horizontal, 8).padding(.vertical, 3)
              .background(r.tag == "Live" ? Color.vbSoft : Color(UIColor(hex: 0xf2c94c)), in: RoundedRectangle(cornerRadius: 5))
              .foregroundStyle(r.tag == "Live" ? Color.vbAccent : Color(UIColor(hex: 0x1b2540)))
          }
        }
      }
      .safeAreaInset(edge: .bottom) { if let r = run { footer(r).padding(.horizontal, 20).padding(.vertical, 10) } }
      .task(id: model.version) { run = await model.view("run") }
    }
    .interactiveDismissDisabled(true)
  }

  @ViewBuilder private func status(_ op: RunView.Op) -> some View {
    switch op.status {
    case "run": HStack(spacing: 4) { ProgressView().controlSize(.mini); Text(op.statusText) }.font(.caption.weight(.semibold))
    case "done", "test": Text(op.statusText).font(.caption.weight(.semibold)).foregroundStyle(Color.vbOk)
    case "fail": Text(op.statusText).font(.caption.weight(.semibold)).foregroundStyle(Color.vbBad)
    default: Text(op.statusText).font(.caption).foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private func footer(_ r: RunView) -> some View {
    VStack(spacing: 10) {
      switch r.phase {
      case "review":
        Button { Task { await model.act("runGo") } } label: { Text(r.goLabel).frame(maxWidth: .infinity) }.primaryAction()
        Button { Task { await model.act("closeRun") } } label: { Text("Back").frame(maxWidth: .infinity) }.secondaryAction()
      case "running":
        Button { Task { await model.act("stopRun") } } label: { Text(r.stopping ? "Stopping…" : "Stop after this step").frame(maxWidth: .infinity) }
          .secondaryAction().disabled(r.stopping)
      default:
        if r.hasReport {
          Button { Task { await model.act("shareReport") } } label: { Text("Share error details").frame(maxWidth: .infinity) }.secondaryAction()
        }
        if r.canResume {
          Button { Task { await model.act("review") } } label: { Text("Resume").frame(maxWidth: .infinity) }.primaryAction()
          Button { Task { await model.act("closeRun") } } label: { Text("Later").frame(maxWidth: .infinity) }.secondaryAction()
        } else {
          Button { Task { await model.act("closeRun") } } label: { Text("Done").frame(maxWidth: .infinity) }.primaryAction()
        }
      }
    }
    .controlSize(.large)
  }
}
