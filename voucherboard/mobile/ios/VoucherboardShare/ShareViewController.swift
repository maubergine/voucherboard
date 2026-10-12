import UIKit
import UniformTypeIdentifiers

/// The share extension (mobile/BRIDGE.md, "Sharing an image in"): reads the text in one shared picture and leaves the
/// text in the App Group for the app, which picks it up when it next becomes active. Extensions can't open their app
/// through public API, so the user opens it. No storyboard, no WebView, no network. The picture
/// is read in memory and dropped.
final class ShareViewController: UIViewController {
  private let label = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private var started = false
  private var completed = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.3)

    label.text = "Reading the picture…"
    label.font = .preferredFont(forTextStyle: .body)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = .label
    label.textAlignment = .center
    label.numberOfLines = 0
    spinner.hidesWhenStopped = true

    let stack = UIStackView(arrangedSubviews: [spinner, label])
    stack.axis = .vertical
    stack.spacing = 12
    stack.alignment = .center
    let card = UIView()
    card.backgroundColor = .systemBackground
    card.layer.cornerRadius = 14
    for v in [card, stack] as [UIView] { v.translatesAutoresizingMaskIntoConstraints = false }
    view.addSubview(card)
    card.addSubview(stack)
    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
      card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
      stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20)
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    spinner.startAnimating()
    readSharedImage { [weak self] lines in self?.read(lines) }
  }

  private func read(_ lines: [PlateText.Line]?) {
    spinner.stopAnimating()
    guard let lines = lines, SharedScan.write(lines) else {
      label.text = "Couldn't read this picture."
      return finish(after: 2)
    }
    label.text = "Plate text read. Open Voucherboard within 10 minutes to choose the plate."
    finish(after: 3)
  }

  private func finish(after seconds: Double) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
      guard let self = self, !self.completed else { return }
      self.completed = true
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  /// The first image attachment, as a URL, file data or UIImage, read on the provider's queue. Calls back on main
  /// with nil if there's no picture to read.
  private func readSharedImage(_ done: @escaping ([PlateText.Line]?) -> Void) {
    let type = UTType.image.identifier
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    guard let provider = items.flatMap({ $0.attachments ?? [] }).first(where: { $0.hasItemConformingToTypeIdentifier(type) }) else {
      return done(nil)
    }
    provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
      var lines: [PlateText.Line]?
      if let url = item as? URL {
        lines = PlateText.lines(url: url) ?? (try? Data(contentsOf: url)).flatMap(PlateText.lines(data:))
      } else if let data = item as? Data {
        lines = PlateText.lines(data: data)
      } else if let image = item as? UIImage {
        lines = PlateText.lines(image: image)
      }
      DispatchQueue.main.async { done(lines) }
    }
  }

}
