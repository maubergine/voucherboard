package com.mariusrubin.voucherboard

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.graphics.Insets
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/** Reads text from an image on the device (apps/mobile/BRIDGE.md, "Number plate scanning"). Nothing is written to disk. */
object PlateText {
    private const val MAX_EDGE = 2000
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun recognizer() = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    fun lines(text: Text): List<Text.Line> = text.textBlocks.flatMap { it.lines }.filter { it.text.isNotBlank() }

    fun json(lines: List<Text.Line>): JSONArray = JSONArray().also { a ->
        lines.forEach { l ->
            val c = l.confidence
            a.put(JSONObject().put("text", l.text.trim()).put("confidence", if (c.isNaN()) 0.0 else c.toDouble().coerceIn(0.0, 1.0)))
        }
    }

    /** Decodes [uri] off the main thread, reads it, and calls back on the main thread with the lines or "unavailable". */
    fun read(ctx: Context, uri: Uri, cb: (JSONArray?, String?) -> Unit) {
        val cr = ctx.applicationContext.contentResolver
        worker.execute {
            val decoded = try { decode(cr, uri) } catch (e: Exception) { null } catch (e: OutOfMemoryError) { null }
            main.post {
                if (decoded == null) return@post cb(null, "unavailable")
                val (bitmap, image) = decoded
                val rec = recognizer()
                rec.process(image).addOnCompleteListener { task ->
                    rec.close()
                    bitmap.recycle()
                    if (task.isSuccessful) cb(json(lines(task.result)), null) else cb(null, "unavailable")
                }
            }
        }
    }

    private fun decode(cr: ContentResolver, uri: Uri): Pair<Bitmap, InputImage> {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies the EXIF orientation itself. Software memory, so ML Kit can read the pixels.
            val bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(cr, uri)) { d, info, _ ->
                val w = info.size.width
                val h = info.size.height
                val long = maxOf(w, h)
                if (long > MAX_EDGE) {
                    val s = MAX_EDGE.toDouble() / long
                    d.setTargetSize(maxOf(1, (w * s).roundToInt()), maxOf(1, (h * s).roundToInt()))
                }
                d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
            return bmp to InputImage.fromBitmap(bmp, 0)
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        (cr.openInputStream(uri) ?: throw IOException("no stream")).use { BitmapFactory.decodeStream(it, null, bounds) }
        val long = maxOf(bounds.outWidth, bounds.outHeight)
        if (long <= 0) throw IOException("not an image")
        var sample = 1
        while (long / sample > MAX_EDGE) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = (cr.openInputStream(uri) ?: throw IOException("no stream")).use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IOException("not an image")
        val rotation = try {
            cr.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSPOSE -> 90
                    ExifInterface.ORIENTATION_ROTATE_180, ExifInterface.ORIENTATION_FLIP_VERTICAL -> 180
                    ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSVERSE -> 270
                    else -> 0
                }
            } ?: 0
        } catch (e: IOException) { 0 }
        return bmp to InputImage.fromBitmap(bmp, rotation)
    }
}

/**
 * The live scanner: a full-screen overlay in MainActivity with the camera preview, highlights over the recognised
 * text (PlateHighlights), and Cancel / Use these, laid out as on iOS. Tapping a plate's ring or chip returns every
 * current line plus that one as `tapped`. Frames go straight from the camera to ML Kit; nothing is saved.
 */
class PlateScanner(private val act: MainActivity, private val done: (JSONObject?, String?) -> Unit) {
    val view = FrameLayout(act)
    private val preview = PreviewView(act)
    private val marks = PlateHighlights(act)
    private val cancelButton = Button(act)
    private val useButton = Button(act)
    private val bottom = LinearLayout(act)
    private val panel = LinearLayout(act)
    private val warning = TextView(act)
    private val recognizer = PlateText.recognizer()
    private val controller = LifecycleCameraController(act)
    private val main = Handler(Looper.getMainLooper())
    private var lines: List<Text.Line> = emptyList()
    /** Set once the scanner starts closing, so a second tap while it closes does nothing. */
    private var finished = false
    private var seen = 0

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, act.resources.displayMetrics)

    private fun label(text: String, sp: Float) = TextView(act).apply {
        this.text = text
        setTextColor(Color.WHITE)
        textSize = sp
    }

    private fun pill(fill: Int) = GradientDrawable().apply { cornerRadius = dp(100f); setColor(fill) }

    init {
        view.setBackgroundColor(Color.BLACK)
        view.isClickable = true // nothing reaches the UI underneath
        // TextureView: composes simply under the highlights and above the other views.
        preview.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        preview.scaleType = PreviewView.ScaleType.FILL_CENTER
        view.addView(preview, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        view.addView(marks, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        marks.onTap = { line -> use(line) }
        marks.clearTop = { (bottom.top + panel.top).toFloat() }

        val pad = dp(16f).roundToInt()
        cancelButton.apply {
            text = act.getString(R.string.scan_cancel)
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = pill(0x40ffffff)
            setPadding(pad, 0, pad, 0)
            setOnClickListener { cancel() }
        }
        view.addView(cancelButton, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.TOP or Gravity.START))

        warning.apply {
            text = act.getString(R.string.scan_crowded)
            setTextColor(0xffffd479.toInt())
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            visibility = View.GONE
        }
        fun legendRow(plate: Boolean) = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(PlateSwatch(act, plate))
            addView(label(act.getString(if (plate) R.string.scan_legend_plate else R.string.scan_legend_other), 13f),
                LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = dp(10f).roundToInt() })
        }
        val hint = label(act.getString(R.string.scan_hint), 15f).apply { gravity = Gravity.CENTER }
        panel.apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply { cornerRadius = dp(16f); setColor(0x99000000.toInt()) }
            setPadding(dp(14f).roundToInt(), dp(12f).roundToInt(), dp(14f).roundToInt(), dp(12f).roundToInt())
            isClickable = true
            val gap = dp(10f).roundToInt()
            addView(warning, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = gap })
            addView(legendRow(true), LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(6f).roundToInt() })
            addView(legendRow(false), LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = gap })
            addView(hint, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        useButton.apply {
            text = act.getString(R.string.scan_use)
            isAllCaps = false
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            background = pill(PlateHighlights.OUTLINE)
            minWidth = dp(180f).roundToInt()
            minimumWidth = dp(180f).roundToInt()
            setPadding(pad, 0, pad, 0)
            setOnClickListener { if (!finished) finish(JSONObject().put("lines", PlateText.json(lines)), null) }
        }
        bottom.apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(panel, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(12f).roundToInt() })
            addView(useButton, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        }
        view.addView(bottom, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))

        // Shown at once, hidden only after a moment clear, so it doesn't flicker as the camera moves.
        marks.onCrowded = { on ->
            val n = ++seen
            if (on) warning.visibility = View.VISIBLE
            else main.postDelayed({ if (n == seen && !finished) warning.visibility = View.GONE }, 1500)
        }
        applyInsets(Insets.NONE)
    }

    /** Binds the camera. Call once the view is attached and the CAMERA permission is granted. */
    fun start() {
        val exec = ContextCompat.getMainExecutor(act)
        controller.setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
        // The default analysis size (640x480) is too small for a plate a few metres away.
        controller.imageAnalysisResolutionSelector = ResolutionSelector.Builder()
            .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build()
        controller.imageAnalysisBackpressureStrategy = ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST
        controller.isPinchToZoomEnabled = true
        // View-referenced coordinates only work with a CameraController attached to the PreviewView.
        controller.setImageAnalysisAnalyzer(exec,
            MlKitAnalyzer(listOf(recognizer), ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED, exec) { r -> onResult(r) })
        preview.controller = controller
        try {
            controller.bindToLifecycle(act)
        } catch (e: Exception) {
            return finish(null, "unavailable")
        }
        controller.initializationFuture.addListener({
            if (finished) return@addListener
            val selector = try {
                when {
                    controller.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
                    controller.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
                    else -> null
                }
            } catch (e: Exception) { null } // the camera provider failed to start
            when (selector) {
                null -> finish(null, "unavailable")
                CameraSelector.DEFAULT_BACK_CAMERA -> {}
                else -> controller.cameraSelector = selector
            }
        }, exec)
    }

    fun applyInsets(bars: Insets) {
        val pad = dp(16f).roundToInt()
        (cancelButton.layoutParams as FrameLayout.LayoutParams).apply {
            leftMargin = pad + bars.left
            topMargin = dp(12f).roundToInt() + bars.top
            cancelButton.layoutParams = this
        }
        bottom.setPadding(pad + bars.left, 0, pad + bars.right, dp(20f).roundToInt() + bars.bottom)
        marks.topInset = bars.top.toFloat()
    }

    fun cancel() = finish(JSONObject().put("cancelled", true), null)

    private fun onResult(r: MlKitAnalyzer.Result) {
        if (finished) return
        val text = r.getValue(recognizer) ?: return
        lines = PlateText.lines(text)
        marks.update(lines)
    }

    /** A tapped plate: every line in view, plus that one (which may have just left the frame) as `tapped`. */
    private fun use(line: Text.Line) {
        if (finished) return
        val all = if (lines.any { it === line }) lines else lines + line
        finish(JSONObject().put("lines", PlateText.json(all)).put("tapped", line.text.trim()), null)
    }

    private fun finish(result: JSONObject?, error: String?) {
        if (finished) return
        finished = true
        main.removeCallbacksAndMessages(null)
        marks.stop()
        controller.clearImageAnalysisAnalyzer()
        controller.unbind()
        preview.controller = null
        recognizer.close()
        (view.parent as? ViewGroup)?.removeView(view)
        done(result, error)
    }
}
