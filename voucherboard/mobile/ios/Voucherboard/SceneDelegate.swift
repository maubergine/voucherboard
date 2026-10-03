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
  }

  func sceneDidBecomeActive(_ scene: UIScene) { main?.appState(active: true) }
  func sceneDidEnterBackground(_ scene: UIScene) { main?.appState(active: false) }
}
