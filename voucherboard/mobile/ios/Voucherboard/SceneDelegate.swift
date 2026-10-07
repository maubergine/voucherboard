import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var main: MainViewController? { window?.rootViewController as? MainViewController }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.backgroundColor = MainViewController.background
    window.rootViewController = MainViewController()
    window.makeKeyAndVisible()
    self.window = window
    if connectionOptions.urlContexts.contains(where: { Self.isScan($0.url) }) { main?.takeSharedScan() }
    connectionOptions.urlContexts.map(\.url).filter(Self.isLive).forEach { main?.openLink($0) }
  }

  /// Only voucherboard://scan, from the share extension. Anything else is ignored.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    if URLContexts.contains(where: { Self.isScan($0.url) }) { main?.takeSharedScan() }
    URLContexts.map(\.url).filter(Self.isLive).forEach { main?.openLink($0) }
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    main?.appState(active: true)
    main?.takeSharedScan() // also when the extension couldn't open the app and the user opened it
  }

  func sceneDidEnterBackground(_ scene: UIScene) { main?.appState(active: false) }

  /// voucherboard://visit and voucherboard://extend, from the Live Activity. The model checks their contents.
  private static func isLive(_ url: URL) -> Bool {
    url.scheme?.lowercased() == "voucherboard" && ["visit", "extend"].contains(url.host?.lowercased() ?? "")
  }

  private static func isScan(_ url: URL) -> Bool {
    url.scheme?.lowercased() == "voucherboard" && url.host?.lowercased() == "scan" && (url.path.isEmpty || url.path == "/")
  }
}
