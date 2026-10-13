import UIKit
import AVFoundation
import PhotosUI
import UniformTypeIdentifiers
import VisionKit

/// `plate.scan` (apps/mobile/BRIDGE.md, "Number plate scanning"): the photo picker, or the live camera scanner with a
/// still-photo fallback. Only text comes back; pictures stay in memory and are dropped once read.
@MainActor
final class PlateScanner: NSObject, UIAdaptivePresentationControllerDelegate, UIImagePickerControllerDelegate,
                          UINavigationControllerDelegate, PHPickerViewControllerDelegate, DataScannerViewControllerDelegate {
  typealias Done = (_ value: [String: Any]?, _ error: String?) -> Void

  weak var presenter: UIViewController?
  private var done: Done?
  private var liveItems: [RecognizedItem] = []
  private weak var highlights: PlateHighlights?
  private var closing = false

  init(presenter: UIViewController) {
    self.presenter = presenter
  }

  func scan(source: String, done: @escaping Done) {
    guard self.done == nil, let presenter = presenter else { return done(["cancelled": true], nil) } // one at a time
    self.done = done
    source == "camera" ? camera(presenter.topPresenter) : photos(presenter.topPresenter)
  }

  private func finish(_ value: [String: Any]?, _ error: String? = nil) {
    let d = done
    done = nil
    closing = false
    liveItems = []
    d?(value, error)
  }

  private func finish(lines: [PlateText.Line]?, tapped: String? = nil) {
    var value: [String: Any] = ["lines": (lines ?? []).map(\.json)]
    if let tapped = tapped { value["tapped"] = tapped }
    finish(value)
  }

  private func cancel() { finish(["cancelled": true]) }

  // MARK: Photos

  private func photos(_ from: UIViewController) {
    var config = PHPickerConfiguration() // no photo library: no permission needed
    config.filter = .images
    config.selectionLimit = 1
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = self
    picker.presentationController?.delegate = self
    from.present(picker, animated: true)
  }

  nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    let provider = results.first?.itemProvider
    Task { @MainActor in
      picker.dismiss(animated: true)
      guard let provider = provider else { return self.cancel() }
      guard provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else { return self.finish(lines: nil) }
      // In memory, unlike loadFileRepresentation, which copies the file into the app's tmp folder.
      provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
        let lines = data.flatMap(PlateText.lines(data:)) // on the provider's background queue
        Task { @MainActor in self.finish(lines: lines) }
      }
    }
  }

  // MARK: Camera

  private func camera(_ from: UIViewController) {
    guard UIImagePickerController.isSourceTypeAvailable(.camera), AVCaptureDevice.default(for: .video) != nil else {
      return finish(nil, "unavailable")
    }
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: presentCamera(from)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        Task { @MainActor in granted ? self.presentCamera(from) : self.finish(nil, "camera-denied") }
      }
    case .denied, .restricted: finish(nil, "camera-denied")
    @unknown default: finish(nil, "camera-denied")
    }
  }

  private func presentCamera(_ from: UIViewController) {
    guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else { return presentStill(from) }
    let scanner = DataScannerViewController(recognizedDataTypes: [.text()], qualityLevel: .accurate,
                                            recognizesMultipleItems: true, isHighFrameRateTrackingEnabled: true,
                                            isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: false)
    scanner.delegate = self
    // Our controls sit in a screen of our own, above the scanner's view rather than in its overlay, where taps on
    // buttons weren't reliably delivered.
    let host = UIViewController()
    host.view.backgroundColor = .black
    host.modalPresentationStyle = .fullScreen
    host.addChild(scanner)
    scanner.view.frame = host.view.bounds
    scanner.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.view.addSubview(scanner.view)
    scanner.didMove(toParent: host)
    addControls(to: host.view, scanner: scanner)
    from.present(host, animated: true) {
      do { try scanner.startScanning() } catch {
        host.dismiss(animated: true) { self.presentStill(from) }
      }
    }
  }

  /// Stops the scanner and closes its screen, then reports.
  private func close(_ scanner: DataScannerViewController, then report: @escaping () -> Void) {
    guard !closing else { return } // a second tap while the screen closes
    closing = true
    scanner.stopScanning()
    guard let host = scanner.parent, host.presentingViewController != nil else { return report() }
    host.dismiss(animated: true, completion: report)
  }

  private func addControls(to overlay: UIView, scanner: DataScannerViewController) {
    let marks = PlateHighlights(frame: overlay.bounds)
    marks.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    marks.onTap = { [weak self, weak scanner] item in
      guard let self = self, let scanner = scanner else { return }
      self.use(item, in: scanner)
    }
    overlay.addSubview(marks)
    highlights = marks
    let cancel = Self.button("Cancel", filled: false, action: UIAction { [weak self, weak scanner] _ in
      guard let self = self, let scanner = scanner else { return }
      self.close(scanner) { self.cancel() }
    })
    let use = Self.button("Use these", filled: true, action: UIAction { [weak self, weak scanner] _ in
      guard let self = self, let scanner = scanner else { return }
      let lines = self.liveLines()
      self.close(scanner) { self.finish(lines: lines) }
    })
    let hint = Self.label("Tap the number plate, or choose Use these.", .subheadline)
    hint.textAlignment = .center
    let warning = Self.label("Some text is hidden because there's a lot in view. Zoom in on just the plate you want to scan.", .footnote)
    if let d = warning.font.fontDescriptor.withSymbolicTraits(.traitBold) { warning.font = UIFont(descriptor: d, size: 0) }
    warning.textColor = UIColor(hex: 0xffd479)
    warning.isHidden = true
    let legend = UIStackView(arrangedSubviews: [Self.legendRow(plate: true), Self.legendRow(plate: false)])
    legend.axis = .vertical
    legend.spacing = 6
    let stack = UIStackView(arrangedSubviews: [warning, legend, hint])
    stack.axis = .vertical
    stack.spacing = 10
    stack.translatesAutoresizingMaskIntoConstraints = false
    let panel = UIView()
    panel.backgroundColor = UIColor.black.withAlphaComponent(0.6)
    panel.layer.cornerRadius = 16
    panel.layer.cornerCurve = .continuous
    panel.addSubview(stack)
    for v in [cancel, use, panel] as [UIView] {
      v.translatesAutoresizingMaskIntoConstraints = false
      overlay.addSubview(v)
    }
    marks.keepClear = [panel, use]
    // Shown at once, hidden only after a moment clear, so it doesn't flicker as the camera moves.
    var seen = 0
    marks.onCrowded = { on in
      seen += 1
      let n = seen
      if on { UIView.animate(withDuration: 0.2) { warning.isHidden = false } } else {
        after(1.5) { if n == seen { UIView.animate(withDuration: 0.2) { warning.isHidden = true } } }
      }
    }
    let safe = overlay.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      cancel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
      cancel.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
      use.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
      use.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -20),
      use.widthAnchor.constraint(greaterThanOrEqualToConstant: 180),
      panel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
      panel.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
      panel.bottomAnchor.constraint(equalTo: use.topAnchor, constant: -12),
      stack.topAnchor.constraint(equalTo: panel.topAnchor, constant: 12),
      stack.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -12),
      stack.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 14),
      stack.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -14)
    ])
  }

  private static func label(_ text: String, _ style: UIFont.TextStyle) -> UILabel {
    let l = UILabel()
    l.text = text
    l.font = .preferredFont(forTextStyle: style)
    l.adjustsFontForContentSizeCategory = true
    l.textColor = .white
    l.numberOfLines = 0
    return l
  }

  /// The legend: what a solid ring and a dashed outline mean.
  private static func legendRow(plate: Bool) -> UIView {
    let text = label(plate ? "Solid ring: looks like a number plate" : "Dashed outline: other text", .footnote)
    let row = UIStackView(arrangedSubviews: [PlateHighlights.swatch(plate: plate), text])
    row.spacing = 10
    row.alignment = .center
    return row
  }

  private static func button(_ title: String, filled: Bool, action: UIAction) -> UIButton {
    var config: UIButton.Configuration = filled ? .filled() : .gray()
    config.title = title
    config.cornerStyle = .capsule
    config.buttonSize = .large
    if !filled { config.baseForegroundColor = .white; config.baseBackgroundColor = UIColor.black.withAlphaComponent(0.5) }
    return UIButton(configuration: config, primaryAction: action)
  }

  /// Every text item on screen, top to bottom, one line each. The live scanner gives no confidence.
  private func liveLines() -> [PlateText.Line] {
    let texts = liveItems.compactMap { item -> (CGPoint, String)? in
      guard case .text(let t) = item else { return nil }
      return (item.bounds.topLeft, t.transcript)
    }
    .sorted { abs($0.0.y - $1.0.y) > 8 ? $0.0.y < $1.0.y : $0.0.x < $1.0.x }
    return texts.flatMap { $0.1.components(separatedBy: .newlines) }
      .map { String($0.prefix(PlateText.maxLength)).trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
      .prefix(PlateText.maxLines)
      .map { PlateText.Line(text: $0, confidence: nil) }
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
    use(item, in: dataScanner)
  }

  private func use(_ item: RecognizedItem, in dataScanner: DataScannerViewController) {
    guard done != nil, case .text(let t) = item else { return }
    let tapped = t.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    if !liveItems.contains(where: { $0.id == item.id }) { liveItems.append(item) }
    let lines = liveLines()
    close(dataScanner) { self.finish(lines: lines, tapped: String(tapped.prefix(PlateText.maxLength))) }
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    liveItems = allItems
    highlights?.update(allItems)
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    liveItems = allItems
    highlights?.update(allItems)
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didRemove removedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    liveItems = allItems
    highlights?.update(allItems)
  }

  func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
    guard done != nil else { return }
    close(dataScanner) {
      if case .cameraRestricted = error { self.finish(nil, "camera-denied") } else { self.finish(nil, "unavailable") }
    }
  }

  // MARK: Still photo (no live scanner on this device)

  private func presentStill(_ from: UIViewController) {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.mediaTypes = [UTType.image.identifier]
    picker.cameraCaptureMode = .photo
    picker.delegate = self
    picker.modalPresentationStyle = .fullScreen
    from.present(picker, animated: true)
  }

  nonisolated func imagePickerController(_ picker: UIImagePickerController,
                                         didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    let image = info[.originalImage] as? UIImage
    Task { @MainActor in
      picker.dismiss(animated: true)
      guard let image = image else { return self.finish(lines: nil) }
      PlateText.read(image) { self.finish(lines: $0) }
    }
  }

  nonisolated func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    Task { @MainActor in
      picker.dismiss(animated: true)
      self.cancel()
    }
  }

  // MARK: UIAdaptivePresentationControllerDelegate

  /// The photo picker swiped away.
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    if presentationController.presentedViewController is PHPickerViewController { cancel() }
  }
}
