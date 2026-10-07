import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    // Set before launch finishes, or a tap that launched the app is never delivered.
    UNUserNotificationCenter.current().delegate = Notifications.shared
    return true
  }

  func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
    Orientation.mask
  }
}

/// The orientations the app allows right now; `orientation.set` changes it.
@MainActor
enum Orientation {
  static var mask: UIInterfaceOrientationMask = .all
}

/// Runs `body` on the main actor after a delay.
@MainActor
func after(_ seconds: Double, _ body: @escaping @MainActor () -> Void) {
  Task { @MainActor in
    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    body()
  }
}

extension UIViewController {
  /// The view controller to present from: the topmost one already on screen.
  var topPresenter: UIViewController {
    var top: UIViewController = self
    while let p = top.presentedViewController { top = p }
    return top
  }

  /// Shows a page's alert() or confirm() natively. WebKit drops them silently otherwise.
  func presentDialog(_ message: String, confirm: Bool, done: @escaping (Bool) -> Void) {
    let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
    if confirm { alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done(false) }) }
    alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(true) })
    topPresenter.present(alert, animated: true)
  }
}
