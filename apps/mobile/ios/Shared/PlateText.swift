import UIKit
import ImageIO
import Vision

/// Reads the text lines in a picture with Vision, for the UI's plate finder (src/plates.js). Used by the app and the
/// share extension. Works in memory only: images are decoded, downscaled and dropped, never written anywhere.
/// The reading calls are synchronous and slow, so call them off the main thread.
enum PlateText {
  struct Line: Codable {
    let text: String
    let confidence: Double? // nil from the live scanner, which gives none; plates.js then assumes 0.8

    /// The bridge's `{ text, confidence }`.
    var json: [String: Any] { ["text": text, "confidence": confidence.map { $0 as Any } ?? NSNull()] }
  }

  static let maxEdge = 2000
  static let maxLines = 300
  static let maxLength = 200

  /// Image file data (JPEG, HEIC, PNG…). nil if it isn't an image.
  static func lines(data: Data) -> [Line]? {
    CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary).flatMap(lines(source:))
  }

  /// An image file, read without loading all of it.
  static func lines(url: URL) -> [Line]? {
    CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary).flatMap(lines(source:))
  }

  static func lines(image: UIImage) -> [Line]? {
    let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    guard px.width >= 1, px.height >= 1 else { return nil }
    let k = min(1, CGFloat(maxEdge) / max(px.width, px.height))
    let size = CGSize(width: max(1, (px.width * k).rounded(.down)), height: max(1, (px.height * k).rounded(.down)))
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    // Drawing applies the image's orientation, so Vision gets it upright.
    let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return drawn.cgImage.map { recognize($0) }
  }

  /// Runs `lines(image:)` on a background queue and calls back on the main queue.
  static func read(_ image: UIImage, done: @escaping ([Line]?) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      let result = lines(image: image)
      DispatchQueue.main.async { done(result) }
    }
  }

  /// A thumbnail decode: downscaled and turned upright by ImageIO, without decoding the full-size image first.
  private static func lines(source: CGImageSource) -> [Line]? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxEdge,
      kCGImageSourceShouldCacheImmediately: true
    ]
    guard CGImageSourceGetCount(source) > 0,
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return recognize(image)
  }

  /// Top candidate of each observation, in Vision's reading order. A failed request reads as no text.
  private static func recognize(_ image: CGImage) -> [Line] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    // en-GB if this Vision revision lists it; otherwise its default (English), rather than failing the request.
    if let supported = try? request.supportedRecognitionLanguages(), supported.contains("en-GB") {
      request.recognitionLanguages = ["en-GB"]
    }
    do {
      try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
    } catch {
      return []
    }
    return (request.results ?? []).prefix(maxLines).compactMap { observation in
      guard let top = observation.topCandidates(1).first else { return nil }
      let text = String(top.string.prefix(maxLength)).trimmingCharacters(in: .whitespacesAndNewlines)
      return text.isEmpty ? nil : Line(text: text, confidence: (Double(top.confidence) * 1000).rounded() / 1000)
    }
  }
}
