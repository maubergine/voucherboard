import UIKit
import VisionKit

/// The live scanner's highlights, drawn instead of VisionKit's pale boxes, which vanish on a white plate. Plate-like
/// text gets a ring in the app's blues (light line, navy outline, so it shows on white, yellow and black), a dimmed
/// surround, and a chip with what was read, above it or, if that would cover other text, below. Other text gets a
/// thin dashed outline, hidden under a chip when the view is too crowded to place the chip clear of it (`onCrowded`).
/// Only the chips and plate rings take touches.
@MainActor
final class PlateHighlights: UIView {
  /// The app accent's dark- and light-mode values (Components.swift `vbAccent`).
  static let line = UIColor(hex: 0x8fb0e0)
  static let outline = UIColor(hex: 0x2b4972)

  var onTap: (RecognizedItem) -> Void = { _ in }
  /// Whether some outlines are hidden under chips.
  var onCrowded: (Bool) -> Void = { _ in }
  /// Views over the camera (the legend and buttons) that chips must stay clear of.
  var keepClear: [UIView] = []
  private let scrim = CAShapeLayer()
  private let rings = CALayer() // below the chips, which are subviews
  private var crowded = false
  private var marks: [UUID: Mark] = [:]
  private var buzzed = false

  /// A highlight. VisionKit gives text a new id each time it reads it again, so a mark follows its text across ids
  /// (same words, or overlapping), and stays a moment after the text is lost, so it can still be tapped.
  private final class Mark {
    var plate: Bool
    let layer = CALayer()
    let outline = CAShapeLayer()
    let line = CAShapeLayer()
    var chip: UIButton?
    var item: RecognizedItem
    var text: String
    var quad: [CGPoint] = []
    var lost: Date?
    var above: Bool?
    init(item: RecognizedItem, text: String, plate: Bool) { self.item = item; self.text = text; self.plate = plate }
  }

  /// How long a lost mark stays, and how far a corner may jump before the mark snaps rather than glides.
  private static let hold: TimeInterval = 1.2
  private static let snap: CGFloat = 80
  private var items: [RecognizedItem] = []
  private var pruning = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    scrim.fillRule = .evenOdd
    scrim.fillColor = UIColor.black.withAlphaComponent(0.35).cgColor
    scrim.opacity = 0
    layer.addSublayer(scrim)
    layer.addSublayer(rings)
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    guard hit === self else { return hit }
    return ring(at: point) == nil ? nil : self // taps elsewhere reach the scanner, which reports taps on text
  }

  /// The plate whose ring, or the space inside it, is at `point`, with some slack for the ring's width.
  private func ring(at point: CGPoint) -> Mark? {
    marks.values.filter { $0.plate && !$0.quad.isEmpty }
      .first { Self.path($0.quad).cgPath.copy(strokingWithWidth: 24, lineCap: .round, lineJoin: .round, miterLimit: 1).contains(point)
        || Self.path($0.quad).contains(point) }
  }

  @objc private func tapped(_ g: UITapGestureRecognizer) {
    if let m = ring(at: g.location(in: self)) { onTap(m.item) }
  }

  /// UK formats and other short letter-and-digit runs (visitors' foreign plates). plates.js makes the final choice.
  static func isPlateLike(_ text: String) -> Bool {
    let t = text.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
    let parts = t.split(whereSeparator: { $0 == " " || $0 == "-" })
    let bare = parts.joined()
    guard parts.count <= 3, (4...8).contains(bare.count),
          bare.allSatisfy({ ("A"..."Z").contains($0) || ("0"..."9").contains($0) }) else { return false }
    return bare.contains(where: \.isLetter) && bare.contains(where: \.isNumber)
  }

  func update(_ items: [RecognizedItem]) {
    self.items = items
    let now = Date()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    var free = marks, next: [UUID: Mark] = [:]
    for item in items {
      guard case .text(let t) = item else { continue }
      let text = Self.norm(t.transcript), box = Self.path(Self.quad(item, plate: false)).bounds
      func match() -> Mark? {
        if let m = free.removeValue(forKey: item.id) { return m }
        if let k = free.first(where: { $0.value.text == text })?.key { return free.removeValue(forKey: k) }
        if let best = free.max(by: { Self.overlap($0.value.layer.frame, box) < Self.overlap($1.value.layer.frame, box) }),
           Self.overlap(best.value.layer.frame, box) > 0.3 { return free.removeValue(forKey: best.key) }
        return nil
      }
      if let m = match() {
        m.item = item; m.lost = nil; m.layer.opacity = 1
        if m.text != text { m.text = text; if let c = m.chip { Self.label(c, Self.display(t.transcript)) } }
        if !m.plate && Self.isPlateLike(t.transcript) { makePlate(m) } // never back: a plate stays a plate while seen
        next[item.id] = m
        place(m)
      } else {
        next[item.id] = add(item, text: text, plate: Self.isPlateLike(t.transcript))
      }
    }
    for (id, m) in free {
      if m.lost == nil { m.lost = now }
      if now.timeIntervalSince(m.lost!) < Self.hold { m.layer.opacity = 0.55; next[id] = m }
      else { m.layer.removeFromSuperlayer(); m.chip?.removeFromSuperview() }
    }
    marks = next
    layoutChips()
    let holes = UIBezierPath(rect: bounds)
    marks.values.filter(\.plate).forEach { holes.append(Self.path($0.quad)) }
    scrim.frame = bounds
    scrim.path = holes.cgPath
    CATransaction.commit()
    let dim: Float = marks.values.contains(where: \.plate) ? 1 : 0
    if scrim.opacity != dim { scrim.opacity = dim } // implicit fade
    // VisionKit only calls back when something changes, so lost marks are aged out here.
    if marks.values.contains(where: { $0.lost != nil }) && !pruning {
      pruning = true
      after(0.25) { self.pruning = false; self.update(self.items) }
    }
  }

  private func add(_ item: RecognizedItem, text: String, plate: Bool) -> Mark {
    let m = Mark(item: item, text: text, plate: false)
    for s in [m.outline, m.line] { s.fillColor = nil; s.lineJoin = .round; m.layer.addSublayer(s) }
    Self.styleOther(outline: m.outline, line: m.line)
    rings.addSublayer(m.layer)
    if plate { makePlate(m) } else { place(m) }
    return m
  }

  private func makePlate(_ m: Mark) {
    m.plate = true
    m.quad = []
    m.outline.strokeColor = Self.outline.withAlphaComponent(0.92).cgColor
    m.outline.lineWidth = 9
    m.line.strokeColor = Self.line.cgColor
    m.line.lineWidth = 3
    m.line.lineDashPattern = nil
    m.line.shadowColor = Self.line.cgColor
    m.line.shadowOffset = .zero
    m.line.shadowOpacity = 0.7
    m.line.shadowRadius = 8
    m.chip = chip(m)
    place(m)
    arrive(m)
  }

  /// Glides toward the new position (half way each update), or snaps after a big jump.
  private func place(_ m: Mark) {
    let target = Self.quad(m.item, plate: m.plate)
    let jump = zip(m.quad, target).map { hypot($0.x - $1.x, $0.y - $1.y) }.max() ?? .infinity
    m.quad = jump > Self.snap ? target : zip(m.quad, target).map { CGPoint(x: ($0.x + $1.x) / 2, y: ($0.y + $1.y) / 2) }
    let box = Self.path(m.quad).bounds
    m.layer.frame = box
    let local = Self.path(m.quad.map { CGPoint(x: $0.x - box.minX, y: $0.y - box.minY) }).cgPath
    m.outline.path = local
    m.line.path = local
  }

  private static func norm(_ s: String) -> String {
    s.uppercased().filter { !$0.isWhitespace }
  }

  private static func shown(_ s: String) -> String {
    s.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// What the chip shows: a current UK plate (AB12 CDE) with OCR mix-ups fixed by position, as src/plates.js reads it
  /// (KR21 FLB from KR2I FLB), so the chip matches what a tap gives. Anything else is shown as read.
  static func display(_ text: String) -> String {
    let raw = shown(text), bare = Array(raw.filter { ("A"..."Z").contains($0) || ("0"..."9").contains($0) })
    guard bare.count == 7 else { return raw }
    let toL: [Character: Character] = ["0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "8": "B"]
    let toD: [Character: Character] = ["O": "0", "Q": "0", "D": "0", "U": "0", "I": "1", "L": "1", "T": "1", "Z": "2",
                                       "A": "4", "S": "5", "G": "6", "B": "8"]
    var out: [Character] = [], fixed = 0
    for (i, c) in bare.enumerated() {
      let digit = i == 2 || i == 3
      if c.isLetter != digit { out.append(c); continue }
      guard let x = digit ? toD[c] : toL[c] else { return raw }
      out.append(x); fixed += 1
    }
    // As plates.js: at most two fixes, no I, Q or Z in the area code, and no I or Q in the last three.
    guard fixed <= 2, !out[0..<2].contains(where: "IQZ".contains), !out[4...].contains(where: "IQ".contains) else { return raw }
    return String(out[0..<4]) + " " + String(out[4...])
  }

  /// Overlap as a share of the smaller box.
  private static func overlap(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let i = a.intersection(b)
    return i.isNull ? 0 : (i.width * i.height) / max(min(a.width * a.height, b.width * b.height), 1)
  }

  static func styleOther(outline: CAShapeLayer, line: CAShapeLayer) {
    outline.strokeColor = UIColor.black.withAlphaComponent(0.55).cgColor
    outline.lineWidth = 4
    line.strokeColor = Self.line.cgColor
    line.lineWidth = 1.5
    line.lineDashPattern = [4, 4]
  }

  /// Each chip goes above its plate, or below if above would cover other text or another chip or run off the free
  /// area. If neither fits, it goes below anyway, opaque, and the outlines it covers are hidden.
  private func layoutChips() {
    let top = safeAreaInsets.top + 60 // clear of Cancel
    let bottom = keepClear.map { convert($0.frame, from: $0.superview).minY }.min().map { $0 - 8 } ?? bounds.maxY - safeAreaInsets.bottom
    var taken: [CGRect] = []
    let plates = marks.values.filter { $0.chip != nil }.sorted { $0.layer.frame.minY < $1.layer.frame.minY }
    for m in plates {
      guard let chip = m.chip else { continue }
      let box = m.layer.frame, size = chip.sizeThatFits(CGSize(width: bounds.width - 32, height: 60))
      let x = min(max(box.midX - size.width / 2, 16), bounds.width - 16 - size.width)
      let above = CGRect(x: x, y: box.minY - size.height - 8, width: size.width, height: size.height)
      let below = CGRect(x: x, y: box.maxY + 8, width: size.width, height: size.height)
      let others = marks.values.filter { $0 !== m }.map(\.layer.frame)
      func clear(_ r: CGRect) -> Bool {
        r.minY >= top && r.maxY <= bottom && !others.contains(where: r.intersects) && !taken.contains(where: r.intersects)
      }
      // Keep the side it had while that side is still clear, so it doesn't flip as the camera moves.
      let kept = m.above.map { $0 ? above : below }
      var r = kept.map(clear) == true ? kept! : clear(above) ? above : clear(below) ? below : below.maxY <= bottom ? below : above
      m.above = r == above
      r.origin.y = min(max(r.minY, top), bottom - r.height)
      chip.frame = r
      taken.append(r)
    }
    var hid = false
    for m in marks.values where m.chip == nil {
      let covered = taken.contains { $0.intersects(m.layer.frame) }
      m.layer.isHidden = covered
      hid = hid || covered
    }
    if hid != crowded { crowded = hid; onCrowded(hid) }
  }

  /// A short sample of a ring, for the legend.
  static func swatch(plate: Bool) -> UIView {
    let v = UIView(frame: CGRect(x: 0, y: 0, width: 34, height: 18))
    let path = UIBezierPath(roundedRect: v.bounds.insetBy(dx: 4, dy: 4), cornerRadius: 2).cgPath
    let outline = CAShapeLayer(), line = CAShapeLayer()
    for s in [outline, line] { s.path = path; s.fillColor = nil; v.layer.addSublayer(s) }
    if plate {
      outline.strokeColor = Self.outline.cgColor; outline.lineWidth = 6
      line.strokeColor = Self.line.cgColor; line.lineWidth = 2.5
    } else {
      styleOther(outline: outline, line: line)
    }
    v.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([v.widthAnchor.constraint(equalToConstant: 34), v.heightAnchor.constraint(equalToConstant: 18)])
    v.isAccessibilityElement = false
    return v
  }

  /// Snaps in from larger, glows while in view, and buzzes once per scan.
  private func arrive(_ m: Mark) {
    let reduce = UIAccessibility.isReduceMotionEnabled
    if !reduce {
      let snap = CASpringAnimation(keyPath: "transform.scale")
      snap.fromValue = 1.35; snap.toValue = 1; snap.damping = 14; snap.initialVelocity = 2
      snap.duration = snap.settlingDuration
      m.layer.add(snap, forKey: "snap")
      let glow = CABasicAnimation(keyPath: "shadowRadius")
      glow.fromValue = 6; glow.toValue = 16; glow.duration = 0.8
      glow.autoreverses = true; glow.repeatCount = .infinity
      glow.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      m.line.add(glow, forKey: "glow")
    }
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0; fade.toValue = 1; fade.duration = reduce ? 0.15 : 0.25
    m.layer.add(fade, forKey: "fade")
    m.chip?.alpha = 0
    UIView.animate(withDuration: 0.25, delay: reduce ? 0 : 0.2) { m.chip?.alpha = 1 }
    if !buzzed { buzzed = true; UIImpactFeedbackGenerator(style: .light).impactOccurred() }
  }

  private func chip(_ m: Mark) -> UIButton {
    var config = UIButton.Configuration.filled()
    config.cornerStyle = .capsule
    config.baseBackgroundColor = UIColor(white: 0.05, alpha: 1) // opaque: it may sit over other outlines
    config.background.strokeColor = Self.line
    config.background.strokeWidth = 1.5
    config.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
    let b = UIButton(configuration: config, primaryAction: UIAction { [weak self, weak m] _ in
      guard let self = self, let m = m else { return }
      self.onTap(m.item)
    })
    if case .text(let t) = m.item { Self.label(b, Self.display(t.transcript)) }
    addSubview(b)
    return b
  }

  private static func label(_ b: UIButton, _ text: String) {
    // Both parts follow the text size setting.
    let mono = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont.monospacedSystemFont(ofSize: 15, weight: .bold), maximumPointSize: 30)
    let plate = AttributedString(text, attributes: AttributeContainer([.font: mono, .foregroundColor: Self.line]))
    let tail = AttributedString("  Tap to use", attributes: AttributeContainer([.font: UIFont.preferredFont(forTextStyle: .footnote).withWeight(.semibold), .foregroundColor: UIColor.white]))
    b.configuration?.attributedTitle = plate + tail
    b.accessibilityLabel = "Use \(text)"
  }

  /// The item's corners, padded along its own edges so the ring clears the letters even when the text is tilted.
  private static func quad(_ item: RecognizedItem, plate: Bool) -> [CGPoint] {
    let b = item.bounds, (px, py): (CGFloat, CGFloat) = plate ? (16, 12) : (4, 3)
    func unit(_ a: CGPoint, _ z: CGPoint) -> CGPoint { let d = max(hypot(z.x - a.x, z.y - a.y), 1); return CGPoint(x: (z.x - a.x) / d, y: (z.y - a.y) / d) }
    let u = unit(b.topLeft, b.topRight), v = unit(b.topLeft, b.bottomLeft)
    func move(_ p: CGPoint, _ su: CGFloat, _ sv: CGFloat) -> CGPoint {
      CGPoint(x: p.x + u.x * px * su + v.x * py * sv, y: p.y + u.y * px * su + v.y * py * sv)
    }
    return [move(b.topLeft, -1, -1), move(b.topRight, 1, -1), move(b.bottomRight, 1, 1), move(b.bottomLeft, -1, 1)]
  }

  private static func path(_ q: [CGPoint]) -> UIBezierPath {
    let p = UIBezierPath()
    p.move(to: q[0]); q.dropFirst().forEach { p.addLine(to: $0) }
    p.close()
    return p
  }
}

private extension UIFont {
  func withWeight(_ w: UIFont.Weight) -> UIFont {
    UIFont(descriptor: fontDescriptor.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: w]]), size: 0)
  }
}
