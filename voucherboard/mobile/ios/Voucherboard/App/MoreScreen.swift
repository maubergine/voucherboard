import SwiftUI

struct MoreScreen: View {
  let model: AppModel
  @State private var more: MoreView?
  @State private var confirmSignOut = false

  var body: some View {
    NavigationStack {
      List {
        if let m = more {
          SignedOutBanner(model: model)
          if m.demo == true {
            Section {
              Button("Leave the demo") { Task { await model.act("leaveDemo") } }
            } header: { Text("Demo") } footer: {
              Text("You're trying Voucherboard with a made-up permit. Nothing is sent anywhere, and nothing is kept when you leave.")
            }
          }
          if !m.permits.isEmpty || !m.subzones.isEmpty {
            Section {
              if !m.permits.isEmpty {
                Picker("Permit", selection: Binding(get: { m.permits.first { $0.selected }?.id ?? "" },
                                                    set: { v in Task { await model.act("setPermit", ["id": v]) } })) {
                  ForEach(m.permits) { Text($0.label).tag($0.id) }
                }
              }
              if !m.subzones.isEmpty {
                Picker("Parking in", selection: Binding(get: { m.subzones.first { $0.selected }?.code ?? "" },
                                                        set: { v in Task { await model.act("setSubzone", ["code": v]) } })) {
                  if !m.subzones.contains(where: \.selected) { Text("Choose…").tag("") }
                  ForEach(m.subzones) { Text($0.label).tag($0.code) }
                }
              }
            }
          }
          Section("Settings") {
            toggle("Test mode", "Checks bookings with the council site without booking or using vouchers", "testMode", m.settings.testMode)
            toggle("Experimental: end bookings early", "Adds End early to bookings in progress", "betaLive", m.settings.betaLive)
            toggle("Email confirmations", "The council emails you for each voucher booked", "emailAll", m.settings.emailAll)
            toggle("Reminders", "On this phone, before a voucher ends", "reminders", m.settings.reminders)
            toggle("Live Activity", "On the Lock Screen while a visitor is parked", "liveActivity", m.settings.liveActivity)
            if m.settings.reminders {
              Picker("Remind me", selection: Binding(get: { m.settings.lead }, set: { v in Task { await model.act("setSetting", ["key": "lead", "value": v]) } })) {
                ForEach(m.leads, id: \.self) { Text("\($0) min before").tag($0) }
              }
            }
          }
          Section {
            Button("Show council site") { Task { await model.act("openCouncil") } }
            NavigationLink("Terms") { TermsText(model: model, accept: false).navigationTitle("Terms") }
            if let url = URL(string: m.supportUrl) { Link("Help and support", destination: url) }
            if let url = URL(string: m.privacyUrl) { Link("Privacy policy", destination: url) }
            if let url = URL(string: m.issuesUrl) { Link("Report issue", destination: url) }
            if m.hasReport {
              Button { Task { await model.act("shareReport") } } label: {
                VStack(alignment: .leading) { Text("Share last error details"); Text("Tokens are removed").font(.footnote).foregroundStyle(.secondary) }
              }
            }
            if m.demo != true { Button("Sign out of council site", role: .destructive) { confirmSignOut = true } }
          }
          Section { } footer: { Text(m.footer) }
        }
      }
      .listStyle(.insetGrouped)
      .navigationTitle("More")
      .confirmationDialog("Sign out of the council site?", isPresented: $confirmSignOut, titleVisibility: .visible) {
        Button("Sign out", role: .destructive) { Task { await model.act("signOut") } }
        Button("Keep", role: .cancel) { }
      } message: {
        Text("Your plan stays on this phone.")
      }
      .task(id: model.version) { more = await model.view("more") }
    }
  }

  private func toggle(_ label: String, _ sub: String, _ key: String, _ on: Bool) -> some View {
    Toggle(isOn: Binding(get: { on }, set: { v in Task { await model.act("setSetting", ["key": key, "value": v]) } })) {
      VStack(alignment: .leading, spacing: 2) { Text(label); Text(sub).font(.footnote).foregroundStyle(.secondary) }
    }
  }
}

/// Shown until the current terms are accepted.
struct TermsScreen: View {
  let model: AppModel
  @State private var declined = false

  var body: some View {
    if declined {
      GateView(icon: "doc.text", title: "Voucherboard needs the terms accepted",
               text: "Nothing has been read from the council site. You can accept the terms whenever you're ready.",
               button: "Read the terms again") { declined = false }
    } else {
      NavigationStack {
        TermsText(model: model, accept: true, decline: { declined = true }).navigationTitle("Voucherboard")
      }
    }
  }
}

/// The terms (src/terms.js), turned from HTML into text.
struct TermsText: View {
  let model: AppModel
  let accept: Bool
  var decline: () -> Void = {}
  @State private var text: [Paragraph]?
  @State private var privacy: URL?
  @State private var accepting = false
  @State private var agreed = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        if accept {
          Text("Before you start, read and accept the terms. Nothing is read from the council site until you do.").font(.subheadline.weight(.semibold))
        }
        if let t = text {
          VStack(alignment: .leading, spacing: 10) {
            ForEach(t) { p in Text(p.text).padding(.top, p.heading ? 8 : 0).accessibilityAddTraits(p.heading ? .isHeader : []) }
          }
          .textSelection(.enabled)
          if let u = privacy { Link("Privacy policy", destination: u) }
        } else { ProgressView().frame(maxWidth: .infinity) }
        if accept && text != nil {
          Toggle(isOn: $agreed) {
            Text("I have read and accept these terms, and I understand that I use Voucherboard entirely at my own risk.").font(.subheadline)
          }
          .toggleStyle(CheckboxStyle())
          .accessibilityIdentifier("agree")
        }
      }
      .padding(20)
    }
    .safeAreaInset(edge: .bottom) {
      if accept {
        VStack(spacing: 10) {
          Button { accepting = true; Task { await model.act("acceptTerms") } } label: {
            Text(accepting ? "Starting…" : "Accept and continue").frame(maxWidth: .infinity)
          }
          .primaryAction().disabled(accepting || !agreed)
          Button { decline() } label: { Text("Don't accept").frame(maxWidth: .infinity) }.secondaryAction()
        }
        .controlSize(.large)
        .padding(.horizontal, 20).padding(.vertical, 12)
        .background(.bar)
      }
    }
    .task {
      guard text == nil, let t = await model.view("terms", as: TermsView.self) else { return }
      text = Self.render(t.html)
      privacy = t.privacyUrl.flatMap(URL.init(string:))
    }
  }

  struct Paragraph: Identifiable { let id: Int; let text: AttributedString; let heading: Bool }

  /// The terms are plain headings, paragraphs and lists. Fonts are reset so they follow Dynamic Type. Each paragraph
  /// is its own Text, since Text ignores paragraph spacing.
  static func render(_ html: String) -> [Paragraph] {
    let styled = "<style>body{font:-apple-system-body}</style>" + html
    guard let data = styled.data(using: .utf8),
          let ns = try? NSMutableAttributedString(data: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil)
    else { return [Paragraph(id: 0, text: AttributedString(html), heading: false)] }
    let all = NSRange(location: 0, length: ns.length)
    ns.addAttribute(.foregroundColor, value: UIColor.label, range: all)
    var out: [Paragraph] = []
    (ns.string as NSString).enumerateSubstrings(in: all, options: .byParagraphs) { s, range, _, _ in
      guard let s = s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return }
      let part = ns.attributedSubstring(from: range)
      let bold = (part.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)?.fontDescriptor.symbolicTraits.contains(.traitBold) == true
      out.append(Paragraph(id: out.count, text: (try? AttributedString(part, including: \.uiKit)) ?? AttributedString(s), heading: bold && s.count < 80))
    }
    return out
  }
}

/// A tick box, for agreeing to the terms.
private struct CheckboxStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button { configuration.isOn.toggle() } label: {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
          .font(.title2).foregroundStyle(configuration.isOn ? Color.vbAccent : .secondary)
        configuration.label.multilineTextAlignment(.leading)
      }
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
  }
}
