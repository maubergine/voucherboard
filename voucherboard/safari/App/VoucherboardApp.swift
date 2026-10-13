import AppKit
import SafariServices
import SwiftUI

// The containing app: says how to turn the extension on in Safari, and opens Safari's settings for it.
@main
struct VoucherboardApp: App {
    @NSApplicationDelegateAdaptor private var delegate: AppDelegate

    var body: some Scene {
        Window("Voucherboard", id: "main") {
            SetupView()
        }
        .windowResizability(.contentSize)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

// The extension's bundle id, from Info.plist (VBExtensionBundleID, set in project.yml).
let extensionID = Bundle.main.object(forInfoDictionaryKey: "VBExtensionBundleID") as? String ?? ""

struct SetupView: View {
    enum Status { case unknown, on, off }
    @State private var state = Status.unknown
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 64, height: 64)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Voucherboard").font(.title2).bold()
                    Text("A clearer planner for Lewisham visitor parking vouchers.").foregroundStyle(.secondary)
                }
            }
            status
            VStack(alignment: .leading, spacing: 10) {
                Text("To set it up").font(.headline)
                step(1, "Open Safari's extension settings with the button below.")
                step(2, "Tick Voucherboard to turn it on.")
                step(3, "Select Voucherboard, choose Edit Websites, and set parkingpermits.lewisham.gov.uk to Allow.")
                step(4, "Go to parkingpermits.lewisham.gov.uk and sign in. Voucherboard's button appears at the bottom right of the page.")
            }
            Text("Voucherboard only runs on the council's permit site. It doesn't run on payment or account pages, and it sends nothing anywhere else.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Open Safari extension settings", action: openSettings)
                    .keyboardShortcut(.defaultAction)
                    .controlSize(.large)
            }
            if failed {
                Text("Safari's settings didn't open. In Safari, choose Safari > Settings, then Extensions.")
                    .font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(28)
        .frame(width: 520)
        .onAppear(perform: refresh)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in refresh() }
    }

    @ViewBuilder private var status: some View {
        switch state {
        case .on:
            Label("Voucherboard is on in Safari.", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case .off:
            Label("Voucherboard is off in Safari.", systemImage: "exclamationmark.circle.fill").foregroundStyle(.orange)
        case .unknown:
            Label("Checking whether Voucherboard is on in Safari.", systemImage: "questionmark.circle").foregroundStyle(.secondary)
        }
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(n).").monospacedDigit().foregroundStyle(.secondary)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionID) { s, error in
            DispatchQueue.main.async { state = error != nil || s == nil ? .unknown : (s!.isEnabled ? .on : .off) }
        }
    }

    private func openSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionID) { error in
            DispatchQueue.main.async { failed = error != nil }
        }
    }
}
