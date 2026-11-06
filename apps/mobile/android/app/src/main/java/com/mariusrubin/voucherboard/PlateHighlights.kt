package com.mariusrubin.voucherboard

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.TypedValue
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import com.google.mlkit.vision.text.Text
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * The live scanner's highlights, as PlateHighlights.swift on iOS. Plate-like text gets a ring in the app's blues
 * (light line, navy outline, so it shows on white, yellow and black), a dimmed surround, and a chip with what was read,
 * above it or, if that would cover other text, below. Other text gets a thin dashed outline, hidden under a chip when
 * the view is too crowded to place the chip clear of it (`onCrowded`). Only the chips and plate rings take touches;
 * other touches fall through to the preview underneath (pinch to zoom).
 */
class PlateHighlights(ctx: Context) : View(ctx) {
    companion object {
        /** The app accent's dark- and light-mode values (Components.kt `vb.accent`). */
        const val LINE = 0xff8fb0e0.toInt()
        const val OUTLINE = 0xff2b4972.toInt()
        /** How long a lost mark stays, and how far a corner may jump (dp) before the mark snaps rather than glides. */
        private const val HOLD_MS = 1200L
        private const val SNAP_DP = 80f

        /** UK formats and other short letter-and-digit runs (visitors' foreign plates). plates.js makes the final choice. */
        fun isPlateLike(text: String): Boolean {
            val t = text.uppercase().trim()
            val parts = t.split(' ', '-').filter { it.isNotEmpty() }
            val bare = parts.joinToString("")
            if (parts.size > 3 || bare.length !in 4..8 || !bare.all { it in 'A'..'Z' || it in '0'..'9' }) return false
            return bare.any { it in 'A'..'Z' } && bare.any { it in '0'..'9' }
        }

        /**
         * What the chip shows: a current UK plate (AB12 CDE) with OCR mix-ups fixed by position, as extension/src/plates.js reads
         * it (KR21 FLB from KR2I FLB), so the chip matches what a tap gives. Anything else is shown as read.
         */
        fun display(text: String): String {
            val raw = text.uppercase().trim()
            val bare = raw.filter { it in 'A'..'Z' || it in '0'..'9' }
            if (bare.length != 7) return raw
            val toL = mapOf('0' to 'O', '1' to 'I', '2' to 'Z', '4' to 'A', '5' to 'S', '6' to 'G', '8' to 'B')
            val toD = mapOf('O' to '0', 'Q' to '0', 'D' to '0', 'U' to '0', 'I' to '1', 'L' to '1', 'T' to '1', 'Z' to '2',
                'A' to '4', 'S' to '5', 'G' to '6', 'B' to '8')
            val out = StringBuilder()
            var fixed = 0
            for ((i, c) in bare.withIndex()) {
                val digit = i == 2 || i == 3
                if ((c in 'A'..'Z') != digit) { out.append(c); continue }
                val x = (if (digit) toD[c] else toL[c]) ?: return raw
                out.append(x); fixed++
            }
            // As plates.js: at most two fixes, no I, Q or Z in the area code, and no I or Q in the last three.
            if (fixed > 2 || out.substring(0, 2).any { it in "IQZ" } || out.substring(4).any { it in "IQ" }) return raw
            return out.substring(0, 4) + " " + out.substring(4)
        }

        fun styleOther(outline: Paint, line: Paint, density: Float) {
            outline.color = Color.argb(140, 0, 0, 0)
            outline.strokeWidth = 4 * density
            line.color = LINE
            line.strokeWidth = 1.5f * density
            line.pathEffect = DashPathEffect(floatArrayOf(4 * density, 4 * density), 0f)
        }

        private fun norm(s: String) = s.uppercase().filterNot { it.isWhitespace() }

        private fun bounds(q: FloatArray): RectF {
            if (q.isEmpty()) return RectF()
            val r = RectF(q[0], q[1], q[0], q[1])
            for (i in q.indices step 2) r.union(q[i], q[i + 1])
            return r
        }

        /** Overlap as a share of the smaller box. */
        private fun overlap(a: RectF, b: RectF): Float {
            val i = RectF()
            if (!i.setIntersect(a, b)) return 0f
            return (i.width() * i.height()) / max(min(a.width() * a.height(), b.width() * b.height()), 1f)
        }

        private fun path(q: FloatArray, into: Path = Path()): Path {
            into.moveTo(q[0], q[1])
            for (i in 2 until q.size step 2) into.lineTo(q[i], q[i + 1])
            into.close()
            return into
        }
    }

    var onTap: (Text.Line) -> Unit = {}
    /** Whether some outlines are hidden under chips. */
    var onCrowded: (Boolean) -> Unit = {}
    /** The top system inset: chips stay clear of it and of Cancel below it. */
    var topInset = 0f
    /** The top of the controls over the camera (the legend panel and Use these), in this view's coordinates. */
    var clearTop: () -> Float = { height.toFloat() }

    private val d = resources.displayMetrics.density
    private val reduce = Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    private val tail = "  " + ctx.getString(R.string.scan_tap_to_use)

    /** A highlight. Marks follow their text across frames (same words, or overlapping), and stay a moment after it's lost. */
    private class Mark(var line: Text.Line, var text: String) {
        var plate = false
        var quad = FloatArray(0)
        var lost: Long? = null
        var above: Boolean? = null
        var chip: RectF? = null
        var chipText = ""
        var arrived = 0L
        var hidden = false
    }

    private var marks = mutableListOf<Mark>()
    private var lines: List<Text.Line> = emptyList()
    private var crowded = false
    private var buzzed = false
    private var pruning = false
    private val prune = Runnable { pruning = false; update(lines) }
    private var stopped = false
    private var pressed: Mark? = null
    private var scrim = 0f
    private var scrimTarget = 0f
    private var scrimAnim: ValueAnimator? = null

    private val scrimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; color = Color.BLACK }
    private val otherOutline = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
    private val otherLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
    private val plateOutline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND; color = OUTLINE; alpha = (0.92f * 255).toInt(); strokeWidth = 9 * d
    }
    private val plateLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND; color = LINE; strokeWidth = 3 * d }
    private val chipFill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(13, 13, 13) } // opaque: it may sit over other outlines
    private val chipStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = LINE; strokeWidth = 1.5f * d }
    private val platePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = LINE; typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); textSize = minOf(sp(15f), 30 * d) // follows the font size, up to twice
    }
    private val tailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textSize = sp(13f)
        typeface = if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 600, false) else Typeface.DEFAULT_BOLD
    }
    private val tmp = Path()

    init {
        styleOther(otherOutline, otherLine, d)
        // Shadows on paths need a software layer before Android 9.
        if (Build.VERSION.SDK_INT < 28) setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    private fun sp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, resources.displayMetrics)

    /** Stops timers and animations; the scanner is closing. */
    fun stop() {
        stopped = true
        scrimAnim?.cancel()
        removeCallbacks(prune)
    }

    fun update(lines: List<Text.Line>) {
        if (stopped) return
        this.lines = lines
        val now = SystemClock.uptimeMillis()
        val free = marks.toMutableList()
        val next = mutableListOf<Mark>()
        for (l in lines) {
            val text = norm(l.text)
            val box = bounds(quad(l, plate = false))
            val m = free.firstOrNull { it.text == text }
                ?: free.filter { it.quad.isNotEmpty() }.maxByOrNull { overlap(bounds(it.quad), box) }?.takeIf { overlap(bounds(it.quad), box) > 0.3f }
            if (m != null) {
                free.remove(m)
                m.line = l
                m.lost = null
                if (m.text != text) { m.text = text; if (m.plate) m.chipText = display(l.text) }
                if (!m.plate && isPlateLike(l.text)) makePlate(m, now) // never back: a plate stays a plate while seen
                place(m)
                next += m
            } else {
                val n = Mark(l, text)
                if (isPlateLike(l.text)) makePlate(n, now)
                place(n)
                next += n
            }
        }
        for (m in free) {
            val lost = m.lost ?: now.also { m.lost = it }
            if (now - lost < HOLD_MS) next += m
        }
        marks = next
        layoutChips()
        fadeScrim(if (marks.any { it.plate }) 1f else 0f)
        // Frames keep coming, but not when nothing is in view: lost marks are aged out here too.
        if (marks.any { it.lost != null } && !pruning) {
            pruning = true
            postDelayed(prune, 250)
        }
        invalidate()
    }

    private fun makePlate(m: Mark, now: Long) {
        m.plate = true
        m.quad = FloatArray(0)
        m.chipText = display(m.line.text)
        m.arrived = now
        if (!buzzed) { buzzed = true; performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
    }

    /** Glides toward the new position (half way each update), or snaps after a big jump. */
    private fun place(m: Mark) {
        val target = quad(m.line, m.plate)
        if (m.quad.size != target.size) { m.quad = target; return }
        var jump = 0f
        for (i in target.indices step 2) jump = max(jump, hypot(m.quad[i] - target[i], m.quad[i + 1] - target[i + 1]))
        m.quad = if (jump > SNAP_DP * d) target else FloatArray(target.size) { (m.quad[it] + target[it]) / 2 }
    }

    /** The line's corners, padded along its own edges so the ring clears the letters even when the text is tilted. */
    private fun quad(l: Text.Line, plate: Boolean): FloatArray {
        val c = l.cornerPoints
        val pts = if (c != null && c.size == 4) floatArrayOf(
            c[0].x.toFloat(), c[0].y.toFloat(), c[1].x.toFloat(), c[1].y.toFloat(), c[2].x.toFloat(), c[2].y.toFloat(), c[3].x.toFloat(), c[3].y.toFloat(),
        ) else {
            val b = l.boundingBox ?: return FloatArray(0)
            floatArrayOf(b.left.toFloat(), b.top.toFloat(), b.right.toFloat(), b.top.toFloat(), b.right.toFloat(), b.bottom.toFloat(), b.left.toFloat(), b.bottom.toFloat())
        }
        val px = (if (plate) 16f else 4f) * d
        val py = (if (plate) 12f else 3f) * d
        fun unit(ax: Float, ay: Float, zx: Float, zy: Float): Pair<Float, Float> {
            val len = max(hypot(zx - ax, zy - ay), 1f)
            return (zx - ax) / len to (zy - ay) / len
        }
        val (ux, uy) = unit(pts[0], pts[1], pts[2], pts[3])
        val (vx, vy) = unit(pts[0], pts[1], pts[6], pts[7])
        val signs = arrayOf(-1f to -1f, 1f to -1f, 1f to 1f, -1f to 1f)
        return FloatArray(8) { i ->
            val k = i / 2
            val (su, sv) = signs[k]
            if (i % 2 == 0) pts[i] + ux * px * su + vx * py * sv else pts[i] + uy * px * su + vy * py * sv
        }
    }

    private fun chipSize(text: String): Pair<Float, Float> {
        val w = platePaint.measureText(text) + tailPaint.measureText(tail) + 24 * d
        val h = max(platePaint.fontSpacing, tailPaint.fontSpacing) + 14 * d
        return w to h
    }

    /**
     * Each chip goes above its plate, or below if above would cover other text or another chip or run off the free
     * area. If neither fits, it goes below anyway, opaque, and the outlines it covers are hidden.
     */
    private fun layoutChips() {
        val top = topInset + 60 * d // clear of Cancel
        val bottom = clearTop() - 8 * d
        val taken = mutableListOf<RectF>()
        for (m in marks.filter { it.plate && it.quad.isNotEmpty() }.sortedBy { bounds(it.quad).top }) {
            val box = bounds(m.quad)
            val (w, h) = chipSize(m.chipText)
            val x = min(max(box.centerX() - w / 2, 16 * d), width - 16 * d - w)
            val above = RectF(x, box.top - h - 8 * d, x + w, box.top - 8 * d)
            val below = RectF(x, box.bottom + 8 * d, x + w, box.bottom + 8 * d + h)
            val others = marks.filter { it !== m && it.quad.isNotEmpty() }.map { bounds(it.quad) }
            fun clear(r: RectF) = r.top >= top && r.bottom <= bottom && others.none { RectF.intersects(it, r) } && taken.none { RectF.intersects(it, r) }
            // Keep the side it had while that side is still clear, so it doesn't flip as the camera moves.
            val kept = m.above?.let { if (it) above else below }
            val r = when {
                kept != null && clear(kept) -> kept
                clear(above) -> above
                clear(below) -> below
                below.bottom <= bottom -> below
                else -> above
            }
            m.above = r === above
            r.offsetTo(r.left, min(max(r.top, top), bottom - h))
            m.chip = r
            taken += r
        }
        var hid = false
        for (m in marks) {
            if (m.plate) continue
            m.chip = null
            m.hidden = m.quad.isNotEmpty() && taken.any { RectF.intersects(it, bounds(m.quad)) }
            hid = hid || m.hidden
        }
        if (hid != crowded) { crowded = hid; onCrowded(hid) }
    }

    /** Fades the dimmed surround in when a plate is in view, and out when none is. */
    private fun fadeScrim(target: Float) {
        if (target == scrimTarget) return
        scrimTarget = target
        scrimAnim?.cancel()
        scrimAnim = ValueAnimator.ofFloat(scrim, target).apply {
            duration = 250
            addUpdateListener { scrim = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        val now = SystemClock.uptimeMillis()
        var animating = false

        if (scrim > 0f) {
            tmp.reset()
            tmp.fillType = Path.FillType.EVEN_ODD
            tmp.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
            for (m in marks) if (m.plate && m.quad.isNotEmpty()) path(m.quad, tmp)
            scrimPaint.alpha = (0.35f * scrim * 255).toInt()
            canvas.drawPath(tmp, scrimPaint)
        }

        for (m in marks) {
            if (m.plate || m.hidden || m.quad.isEmpty()) continue
            val a = if (m.lost != null) 0.55f else 1f
            tmp.reset()
            path(m.quad, tmp)
            otherOutline.alpha = (a * 140).toInt()
            otherLine.alpha = (a * 255).toInt()
            canvas.drawPath(tmp, otherOutline)
            canvas.drawPath(tmp, otherLine)
        }

        for (m in marks) {
            if (!m.plate || m.quad.isEmpty()) continue
            val t = (now - m.arrived) / 1000f
            val lostA = if (m.lost != null) 0.55f else 1f
            val fade = min(1f, t / (if (reduce) 0.15f else 0.25f))
            val alpha = lostA * fade
            // Snaps in from larger and glows while in view.
            val scale = if (reduce) 1f else 1f + 0.35f * exp(-t * 9f) * cos(t * 16f)
            val glow = if (reduce) 8f else 6f + 10f * (0.5f - 0.5f * cos((2 * PI * t / 1.6).toFloat()))
            if (!reduce || fade < 1f) animating = true
            val box = bounds(m.quad)
            canvas.save()
            canvas.scale(scale, scale, box.centerX(), box.centerY())
            tmp.reset()
            path(m.quad, tmp)
            plateOutline.alpha = (0.92f * alpha * 255).toInt()
            plateLine.alpha = (alpha * 255).toInt()
            plateLine.setShadowLayer(glow * d, 0f, 0f, Color.argb((0.7f * alpha * 255).toInt(), 0x8f, 0xb0, 0xe0))
            canvas.drawPath(tmp, plateOutline)
            canvas.drawPath(tmp, plateLine)
            canvas.restore()

            val chip = m.chip ?: continue
            val ca = lostA * ((t - (if (reduce) 0f else 0.2f)) / 0.25f).coerceIn(0f, 1f)
            if (ca < 1f) animating = true
            if (ca <= 0f) continue
            val r = chip.height() / 2
            chipFill.alpha = (ca * 255).toInt()
            chipStroke.alpha = (ca * 255).toInt()
            canvas.drawRoundRect(chip, r, r, chipFill)
            canvas.drawRoundRect(chip, r, r, chipStroke)
            val base = chip.centerY() - (platePaint.descent() + platePaint.ascent()) / 2
            platePaint.alpha = (ca * 255).toInt()
            tailPaint.alpha = (ca * 255).toInt()
            val x = chip.left + 12 * d
            canvas.drawText(m.chipText, x, base, platePaint)
            canvas.drawText(tail, x + platePaint.measureText(m.chipText), base, tailPaint)
        }

        if (animating && !stopped) postInvalidateOnAnimation()
    }

    // ---------- touches ----------

    /** The plate whose chip or ring (or the space inside it) is at (x, y), with some slack for the ring's width. */
    private fun hit(x: Float, y: Float): Mark? {
        val slop = 12 * d
        marks.firstOrNull { m -> m.plate && m.chip?.let { RectF(it).apply { inset(-4 * d, -4 * d) }.contains(x, y) } == true }?.let { return it }
        return marks.firstOrNull { m -> m.plate && m.quad.isNotEmpty() && (inside(m.quad, x, y) || nearEdge(m.quad, x, y, slop)) }
    }

    private fun inside(q: FloatArray, x: Float, y: Float): Boolean {
        var c = false
        var j = q.size - 2
        for (i in q.indices step 2) {
            val xi = q[i]; val yi = q[i + 1]; val xj = q[j]; val yj = q[j + 1]
            if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c
            j = i
        }
        return c
    }

    private fun nearEdge(q: FloatArray, x: Float, y: Float, slop: Float): Boolean {
        for (i in q.indices step 2) {
            val ax = q[i]; val ay = q[i + 1]
            val bx = q[(i + 2) % q.size]; val by = q[(i + 3) % q.size]
            val dx = bx - ax; val dy = by - ay
            val len2 = dx * dx + dy * dy
            val t = if (len2 == 0f) 0f else (((x - ax) * dx + (y - ay) * dy) / len2).coerceIn(0f, 1f)
            if (hypot(x - (ax + t * dx), y - (ay + t * dy)) <= slop) return true
        }
        return false
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                pressed = hit(e.x, e.y)
                return pressed != null // anything else goes to the preview, for pinch to zoom
            }
            MotionEvent.ACTION_UP -> {
                val m = pressed
                pressed = null
                if (m != null && hit(e.x, e.y) === m) { performClick(); onTap(m.line) }
                return true
            }
            MotionEvent.ACTION_CANCEL -> pressed = null
        }
        return pressed != null
    }

    override fun performClick(): Boolean = super.performClick()
}

/** A short sample of a ring, for the legend. */
class PlateSwatch(ctx: Context, private val plate: Boolean) : View(ctx) {
    private val d = resources.displayMetrics.density
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val r = RectF()

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        if (plate) {
            outline.color = PlateHighlights.OUTLINE; outline.strokeWidth = 6 * d
            line.color = PlateHighlights.LINE; line.strokeWidth = 2.5f * d
        } else {
            PlateHighlights.styleOther(outline, line, d)
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension((34 * d).toInt(), (18 * d).toInt())

    override fun onDraw(canvas: Canvas) {
        r.set(4 * d, 4 * d, width - 4 * d, height - 4 * d)
        canvas.drawRoundRect(r, 2 * d, 2 * d, outline)
        canvas.drawRoundRect(r, 2 * d, 2 * d, line)
    }
}
