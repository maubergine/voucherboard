import SwiftUI
import UIKit
import WebKit

/// Hosts the SwiftUI screens full screen, with the engine view (www/engine.html, never seen) and the council view
/// behind them, or the council view on top when it's shown.
final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  static let background = UIColor.systemGroupedBackground

  /// The engine view: the shared engine and view models, with no UI. The bridge only answers this view.
  private(set) var uiWebView: WKWebView!
  let model = AppModel()
  private var screens: UIHostingController<RootView>!
  private(set) var council: CouncilController!
  private let bridge = Bridge()
  private let www = Bundle.main.bundleURL.appendingPathComponent("www", isDirectory: true)
  private var lastLandscape: Bool?
  private var lastState = "active"
  private var runTask: UIBackgroundTaskIdentifier = .invalid
  private(set) lazy var plates = PlateScanner(presenter: self)
  private var helloSaid = false
  private var afterHello: [(name: String, data: [String: Any])] = []

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Self.background
    bridge.host = self

    council = CouncilController(presenter: self)
    council.onClosed = { [weak self] reason, signedIn in
      self?.emit("council.closed", ["reason": reason, "signedIn": signedIn])
    }
    council.onShownChange = { [weak self] shown in self?.councilShown(shown) }

    let config = WKWebViewConfiguration()
    config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "vb")
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    let ui = WKWebView(frame: .zero, configuration: config)
    ui.navigationDelegate = self
    ui.uiDelegate = self
    ui.isUserInteractionEnabled = false
    ui.alpha = 0 // in the window, so its timers keep running, but never seen
    ui.accessibilityElementsHidden = true
    #if DEBUG
    if #available(iOS 16.4, *) { ui.isInspectable = true }
    #endif
    uiWebView = ui
    model.engine.webView = ui
    ui.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    view.addSubview(ui)

    screens = UIHostingController(rootView: RootView(model: model))
    addChild(screens)
    for v in [council.container, screens.view!] as [UIView] {
      v.frame = view.bounds
      v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      view.addSubview(v)
    }
    screens.didMove(toParent: self)
    councilShown(false)
    loadUI()
  }

  private func loadUI() {
    uiWebView.loadFileURL(www.appendingPathComponent("engine.html"), allowingReadAccessTo: www)
  }

  private func councilShown(_ shown: Bool) {
    view.bringSubviewToFront(shown ? council.container : screens.view)
    screens.view.accessibilityElementsHidden = shown
    setNeedsStatusBarAppearanceUpdate()
  }

  override var preferredStatusBarStyle: UIStatusBarStyle { council?.isShown == true ? .lightContent : .default }
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { Orientation.mask }

  // MARK: Events to the UI

  /// Calls VBNative.emit(name, data). JSONSerialization does the quoting; the array's brackets are dropped to leave two arguments.
  func emit(_ name: String, _ data: [String: Any]) {
    // isValidJSONObject first: data(withJSONObject:) raises an Objective-C exception, not a Swift error, on bad input.
    guard JSONSerialization.isValidJSONObject([name, data]), let json = try? JSONSerialization.data(withJSONObject: [name, data]), var args = String(data: json, encoding: .utf8) else { return }
    args.removeFirst()
    args.removeLast()
    uiWebView.evaluateJavaScript("window.VBNative && void VBNative.emit(\(args))", completionHandler: nil)
  }

  /// voucherboard://visit or voucherboard://extend, from a Live Activity.
  func openLink(_ url: URL) { model.open(link: url) }

  /// An engine event (`engine.event`): the SwiftUI screens fetch what changed.
  func engineEvent(_ type: String, _ data: [String: Any]) { model.event(type, data) }

  func uiDidSayHello() {
    lastLandscape = view.bounds.width > view.bounds.height
    Notifications.shared.attach { [weak self] payload in self?.emit("notification", payload) }
    helloSaid = true
    let queued = afterHello
    afterHello = []
    queued.forEach { emit($0.name, $0.data) }
  }

  /// Emits now if the UI has said hello, or queues the event until it does.
  private func emitAfterHello(_ name: String, _ data: [String: Any]) {
    if helloSaid { emit(name, data) } else { afterHello.append((name, data)) }
  }

  /// Text the share extension left in the App Group, if it's fresh: becomes `plate.shared`.
  func takeSharedScan() {
    guard let lines = SharedScan.take() else { return }
    emitAfterHello("plate.shared", ["lines": lines.map(\.json)])
  }

  func appState(active: Bool) {
    let state = active ? "active" : "background"
    guard state != lastState else { return } // becoming active after Control Centre isn't a return from the background
    lastState = state
    emit("app.state", ["state": state])
  }

  override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
    super.viewWillTransition(to: size, with: coordinator)
    coordinator.animate(alongsideTransition: nil) { [weak self] _ in
      guard let self = self else { return }
      let landscape = self.view.bounds.width > self.view.bounds.height
      guard landscape != self.lastLandscape else { return }
      self.lastLandscape = landscape
      self.emit("orientation", ["landscape": landscape])
    }
  }

  // MARK: Commands from the bridge

  func setOrientation(_ mode: String) {
    let mask: UIInterfaceOrientationMask = mode == "landscape" ? .landscape : mode == "portrait" ? .portrait : .all
    Orientation.mask = mask
    setNeedsUpdateOfSupportedInterfaceOrientations()
    if mode != "auto", let scene = view.window?.windowScene {
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
    }
  }

  func setRunning(_ running: Bool) {
    UIApplication.shared.isIdleTimerDisabled = running
    if running, runTask == .invalid {
      runTask = UIApplication.shared.beginBackgroundTask(withName: "Voucherboard run") { [weak self] in self?.endRunTask() }
    } else if !running {
      endRunTask()
    }
  }

  private func endRunTask() {
    guard runTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(runTask)
    runTask = .invalid
  }

  func share(title: String, text: String) {
    let sheet = UIActivityViewController(activityItems: [ShareItem(title: title, text: text)], applicationActivities: nil)
    if let popover = sheet.popoverPresentationController { // iPad
      popover.sourceView = view
      popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
      popover.permittedArrowDirections = []
    }
    topPresenter.present(sheet, animated: true)
  }

  func haptic(_ kind: String) -> Bool {
    switch kind {
    case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
    case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
    case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
    case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
    default: return false
    }
    return true
  }

  // MARK: UI view: WKNavigationDelegate and WKUIDelegate

  /// Only files inside the bundle's www folder. native.js sends other links to openExternal itself.
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    decisionHandler(isInsideWWW(navigationAction.request.url) ? .allow : .cancel)
  }

  private func isInsideWWW(_ url: URL?) -> Bool {
    guard let url = url, url.isFileURL else { return false }
    let root = www.standardizedFileURL.resolvingSymlinksInPath().path
    return url.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(root + "/")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    model.engine.pageLoaded()
    Task { await model.refresh() }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    model.engine.pageGone()
    Notifications.shared.detach() // queue taps again until the reloaded page says hello
    helloSaid = false
    loadUI()
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
               windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping () -> Void) {
    presentDialog(message, confirm: false) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (Bool) -> Void) {
    presentDialog(message, confirm: true, done: completionHandler)
  }
}

/// Gives the share sheet a subject (used by Mail) as well as the text.
private final class ShareItem: NSObject, UIActivityItemSource {
  let title: String
  let text: String
  init(title: String, text: String) { self.title = title; self.text = text }

  func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any { text }
  func activityViewController(_ activityViewController: UIActivityViewController, itemForActivityType activityType: UIActivity.ActivityType?) -> Any? { text }
  func activityViewController(_ activityViewController: UIActivityViewController, subjectForActivityType activityType: UIActivity.ActivityType?) -> String { title }
}
