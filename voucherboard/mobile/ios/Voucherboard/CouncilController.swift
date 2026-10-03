import UIKit
import WebKit

/// Facts about the council site, shared by the bridge and the council view.
enum Council {
  static let host = "parkingpermits.lewisham.gov.uk"

  static func isCouncil(_ url: URL?) -> Bool {
    url?.scheme?.lowercased() == "https" && url?.host?.lowercased() == host
  }

  /// A full council URL for a site-relative path, or nil if the path could point anywhere else.
  static func url(_ path: String) -> URL? {
    guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("\\"), path.utf8.count <= 4096,
          path.unicodeScalars.allSatisfy({ $0.value > 0x20 && $0.value != 0x7f }),
          let url = URL(string: "https://" + host + path), isCouncil(url) else { return nil }
    return url
  }

  // Same rules as council.js and BRIDGE.md.
  static func isBlockedPath(_ path: String) -> Bool { matches(path, #"/(PermitPayment|VoucherBuyAgain|Payment|Account)(/|$)"#) }
  static func isAccountPath(_ path: String) -> Bool { matches(path, #"^/Account(/|$)"#) }
  static func isLoginPath(_ path: String) -> Bool { matches(path, #"^/Account/Login(/|$)"#) }
  static func isPermitsPath(_ path: String) -> Bool { matches(path, #"^/Home/ApplicantPermits(/|$)"#) }

  /// Website data records are grouped by registrable domain, so the council's cookies sit under lewisham.gov.uk.
  static func ownsRecord(_ displayName: String) -> Bool {
    let name = displayName.lowercased()
    return name == host || name == "lewisham.gov.uk"
  }

  private static func matches(_ s: String, _ pattern: String) -> Bool {
    s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
  }
}

/// The council view: hidden behind the UI while it carries `council.fetch`, shown under a native header for
/// sign-in, buying and browsing (mobile/BRIDGE.md, "The council view").
@MainActor
final class CouncilController: NSObject, WKNavigationDelegate, WKUIDelegate {
  struct FetchRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: String?
  }
  typealias FetchDone = (_ value: [String: Any]?, _ error: String?) -> Void
  private enum Readiness { case ready, signedOut(String), failed }

  let container = UIView()
  let webView: WKWebView
  weak var presenter: UIViewController?
  var onClosed: ((_ reason: String, _ signedIn: Bool) -> Void)?
  var onShownChange: ((Bool) -> Void)?
  private(set) var isShown = false

  private let world: WKContentWorld
  private let header = UIView()
  private let titleLabel = UILabel()
  private let textLabel = UILabel()
  private var reason = ""
  private var pendingBuy: [String: Any]?
  private var signedIn = false
  private var loadWaiters: [UUID: (Bool) -> Void] = [:]
  private var jobs: [(FetchRequest, FetchDone)] = []
  private var fetching = false

  init(presenter: UIViewController) {
    let world = WKContentWorld.world(name: "voucherboard")
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    // WKUserScript has no URL filter, so each script is wrapped to run on the council host's top frame only.
    for name in ["buyfill", "council"] {
      guard let url = Bundle.main.resourceURL?.appendingPathComponent("council/\(name).js"),
            let source = try? String(contentsOf: url, encoding: .utf8) else {
        assertionFailure("council/\(name).js is missing from the bundle")
        continue
      }
      let guarded = "if (window.top === window && location.protocol === 'https:' && location.hostname === '\(Council.host)') {\n\(source)\n}"
      config.userContentController.addUserScript(WKUserScript(source: guarded, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: world))
    }
    self.world = world
    self.presenter = presenter
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    #if DEBUG
    if #available(iOS 16.4, *) { webView.isInspectable = true }
    #endif
    buildViews()
    setShown(false)
  }

  private func buildViews() {
    let blue = UIColor(red: 43 / 255, green: 73 / 255, blue: 114 / 255, alpha: 1)
    container.backgroundColor = .systemBackground
    header.backgroundColor = blue
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.textColor = .white
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.numberOfLines = 0
    titleLabel.accessibilityTraits = .header
    textLabel.font = .preferredFont(forTextStyle: .subheadline)
    textLabel.textColor = UIColor(white: 1, alpha: 0.9)
    textLabel.adjustsFontForContentSizeCategory = true
    textLabel.numberOfLines = 0

    var style = UIButton.Configuration.filled()
    style.title = "Back to Voucherboard"
    style.baseBackgroundColor = .white
    style.baseForegroundColor = blue
    style.cornerStyle = .medium
    let back = UIButton(configuration: style, primaryAction: UIAction { [weak self] _ in self?.close() })

    let stack = UIStackView(arrangedSubviews: [titleLabel, textLabel, back])
    stack.axis = .vertical
    stack.alignment = .leading
    stack.spacing = 4
    stack.setCustomSpacing(10, after: textLabel)

    for v in [header, webView, stack] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
    container.addSubview(webView)
    container.addSubview(header)
    header.addSubview(stack)
    let safe = header.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: container.topAnchor),
      header.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      header.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      stack.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
      stack.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
      stack.bottomAnchor.constraint(equalTo: header.bottomAnchor, constant: -12),
      webView.topAnchor.constraint(equalTo: header.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
  }

  // MARK: Shown and hidden

  /// "Hidden" means behind the UI view rather than isHidden, so WebKit keeps treating the page as visible and doesn't throttle it.
  private func setShown(_ shown: Bool) {
    isShown = shown
    container.isUserInteractionEnabled = shown
    container.accessibilityElementsHidden = !shown
    onShownChange?(shown)
    if shown { UIAccessibility.post(notification: .screenChanged, argument: titleLabel) }
  }

  func show(reason: String, url: URL, buy: [String: Any]?) {
    self.reason = reason
    pendingBuy = reason == "buy" ? buy : nil
    switch reason {
    case "signin":
      titleLabel.text = "Council sign-in"
      textLabel.text = "This is Lewisham's own sign-in page. Voucherboard never sees or stores your password."
    case "buy":
      titleLabel.text = "Council site"
      textLabel.text = "You buy and pay on the council's own pages. Voucherboard is off on the payment page."
    default:
      titleLabel.text = "Council site"
      textLabel.text = "This is the council's own site."
    }
    setShown(true)
    webView.load(URLRequest(url: url))
  }

  func close() {
    guard isShown else { return }
    let closedReason = reason
    pendingBuy = nil
    setShown(false)
    // Nothing from another host (a card or 3-D Secure page) keeps running out of sight.
    if !Council.isCouncil(webView.url) { webView.loadHTMLString("", baseURL: nil) }
    onClosed?(closedReason, signedIn)
  }

  func signOut(_ done: @escaping () -> Void) {
    let store = webView.configuration.websiteDataStore
    let types = WKWebsiteDataStore.allWebsiteDataTypes()
    store.fetchDataRecords(ofTypes: types) { records in
      store.removeData(ofTypes: types, for: records.filter { Council.ownsRecord($0.displayName) }) { [weak self] in
        if let self {
          self.signedIn = false
          self.close()
          self.webView.loadHTMLString("", baseURL: nil)
        }
        done()
      }
    }
  }

  // MARK: council.fetch

  /// Queues a request; they run one at a time, in order.
  func fetch(_ request: FetchRequest, done: @escaping FetchDone) {
    jobs.append((request, done))
    pump()
  }

  private func pump() {
    guard !fetching, !jobs.isEmpty else { return }
    fetching = true
    let (request, done) = jobs.removeFirst()
    var finished = false
    let finish: FetchDone = { [weak self] value, error in
      guard !finished else { return }
      finished = true
      done(value, error)
      self?.fetching = false
      self?.pump()
    }
    after(90) { finish(nil, "network") }
    whenReady { [weak self] state in
      guard let self, !finished else { return }
      switch state {
      case .failed:
        finish(nil, "network")
      case .signedOut(let url):
        // What a fetch would have seen: the council sends signed-out requests to its sign-in page. portal.js checks the URL.
        finish(["status": 200, "url": url, "body": ""], nil)
      case .ready:
        let req: [String: Any] = ["method": request.method, "path": request.path, "headers": request.headers, "body": request.body ?? NSNull()]
        self.webView.callAsyncJavaScript("return await __vbCouncil.fetch(req)", arguments: ["req": req], in: nil, in: self.world) { result in
          guard case .success(let value) = result, let o = value as? [String: Any], let status = o["status"] as? Int else {
            return finish(nil, "network")
          }
          finish(["status": status, "url": o["url"] as? String ?? "", "body": o["body"] as? String ?? ""], nil)
        }
      }
    }
  }

  /// Waits for a loaded, unblocked council page. While hidden, loads the permits page once if needed; while shown, never
  /// navigates away from what the user is looking at.
  private func whenReady(step: Int = 0, loadedHome: Bool = false, _ done: @escaping (Readiness) -> Void) {
    guard step < 4 else { return done(.failed) }
    if webView.isLoading {
      return waitForLoad { [weak self] _ in self?.whenReady(step: step + 1, loadedHome: loadedHome, done) }
    }
    checkReady { [weak self] ready in
      guard let self else { return }
      if ready { return done(.ready) }
      if loadedHome || self.isShown {
        if let url = self.webView.url, Council.isCouncil(url), Council.isLoginPath(url.path) { return done(.signedOut(url.absoluteString)) }
        return done(.failed)
      }
      guard let home = Council.url("/Home/ApplicantPermits") else { return done(.failed) }
      self.webView.load(URLRequest(url: home))
      self.waitForLoad { [weak self] _ in self?.whenReady(step: step + 1, loadedHome: true, done) }
    }
  }

  private func checkReady(_ done: @escaping (Bool) -> Void) {
    guard let url = webView.url, Council.isCouncil(url), !Council.isBlockedPath(url.path) else { return done(false) }
    // council.js also refuses pages with card or password fields, which only the page can tell.
    webView.callAsyncJavaScript("return typeof __vbCouncil === 'object' && __vbCouncil.ready() === true", arguments: [:], in: nil, in: world) { result in
      if case .success(let value) = result { done((value as? Bool) ?? false) } else { done(false) }
    }
  }

  private func waitForLoad(_ done: @escaping (Bool) -> Void) {
    let id = UUID()
    loadWaiters[id] = done
    after(30) { [weak self] in self?.loadWaiters.removeValue(forKey: id)?(false) }
  }

  private func resolveWaiters(_ ok: Bool) {
    let waiters = loadWaiters
    loadWaiters = [:]
    waiters.values.forEach { $0(ok) }
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let url = navigationAction.request.url
    let scheme = url?.scheme?.lowercased() ?? ""
    // Shown, it may leave the council host for card payment and 3-D Secure; hidden, it may not.
    let allowed = Council.isCouncil(url) || scheme == "about" || (isShown && ["https", "data", "blob"].contains(scheme))
    decisionHandler(allowed ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let url = webView.url, Council.isCouncil(url) {
      let onAccount = Council.isAccountPath(url.path)
      signedIn = !onAccount
      if isShown, reason == "signin", !onAccount {
        close()
      } else if isShown, let intent = pendingBuy, Council.isPermitsPath(url.path) {
        pendingBuy = nil
        webView.callAsyncJavaScript("return await __vbCouncil.buy(intent)", arguments: ["intent": intent], in: nil, in: world, completionHandler: nil)
      }
    }
    resolveWaiters(true)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }

  private func navigationFailed(_ error: Error) {
    // A navigation replaced by a newer one reports "cancelled"; keep waiting for the newer one.
    if (error as NSError).code == NSURLErrorCancelled, webView.isLoading { return }
    resolveWaiters(false)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    resolveWaiters(false)
    if isShown { webView.reload() }
  }

  // MARK: WKUIDelegate

  /// target=_blank links open in the same view.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
               windowFeatures: WKWindowFeatures) -> WKWebView? {
    if isShown, navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping () -> Void) {
    guard isShown, let presenter = presenter else { return completionHandler() }
    presenter.presentDialog(message, confirm: false) { _ in completionHandler() }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping (Bool) -> Void) {
    guard isShown, let presenter = presenter else { return completionHandler(false) }
    presenter.presentDialog(message, confirm: true, done: completionHandler)
  }
}
