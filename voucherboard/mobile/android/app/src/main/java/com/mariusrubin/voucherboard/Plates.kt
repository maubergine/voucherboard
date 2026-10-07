package com.mariusrubin.voucherboard

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
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

/** Reads text from an image on the device (mobile/BRIDGE.md, "Number plate scanning"). Nothing is written to disk. */
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
 * The live scanner: a full-screen overlay in MainActivity with the camera preview, a box over each recognised line,
 * and Cancel / Use these. Tapping a box returns every current line plus that one as `tapped`.
 * Frames go straight from the camera to ML Kit; nothing is saved.
 */
class PlateScanner(private val act: MainActivity, private val done: (JSONObject?, String?) -> Unit) {
    val view = FrameLayout(act)
    private val preview = PreviewView(act)
    private val boxes = Boxes()
    private val hint = TextView(act)
    private val bar = LinearLayout(act)
    private val recognizer = PlateText.recognizer()
    private val controller = LifecycleCameraController(act)
    private var lines: List<Text.Line> = emptyList()
    private var finished = false

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, act.resources.displayMetrics)

    init {
        view.setBackgroundColor(Color.BLACK)
        view.isClickable = true // nothing reaches the UI underneath
        // TextureView: composes simply under the boxes and above the WebViews.
        preview.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        preview.scaleType = PreviewView.ScaleType.FILL_CENTER
        view.addView(preview, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        view.addView(boxes, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        val pad = dp(16f).roundToInt()
        hint.text = act.getString(R.string.scan_hint)
        hint.setTextColor(Color.WHITE)
        hint.textSize = 16f
        hint.gravity = Gravity.CENTER
        hint.setBackgroundColor(0x99000000.toInt())
        hint.setPadding(pad, pad, pad, pad)
        hint.isClickable = true
        view.addView(hint, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.TOP))

        bar.orientation = LinearLayout.HORIZONTAL
        bar.setBackgroundColor(0x99000000.toInt())
        bar.setPadding(pad, pad, pad, pad)
        bar.isClickable = true
        fun button(label: Int, onClick: () -> Unit) = Button(act).apply {
            text = act.getString(label)
            isAllCaps = false
            setOnClickListener { onClick() }
            bar.addView(this, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginStart = pad / 2; marginEnd = pad / 2 })
        }
        button(R.string.scan_cancel) { finish(JSONObject().put("cancelled", true), null) }
        button(R.string.scan_use) { finish(JSONObject().put("lines", PlateText.json(lines)), null) }
        view.addView(bar, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM))
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
        hint.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad)
        bar.setPadding(pad + bars.left, pad, pad + bars.right, pad + bars.bottom)
    }

    fun cancel() = finish(JSONObject().put("cancelled", true), null)

    private fun onResult(r: MlKitAnalyzer.Result) {
        if (finished) return
        val text = r.getValue(recognizer) ?: return
        lines = PlateText.lines(text)
        boxes.invalidate()
    }

    private fun tap(x: Float, y: Float) {
        val slop = dp(8f)
        val hit = lines.firstOrNull { l -> l.boundingBox?.let { RectF(it).apply { inset(-slop, -slop) }.contains(x, y) } == true } ?: return
        finish(JSONObject().put("lines", PlateText.json(lines)).put("tapped", hit.text.trim()), null)
    }

    private fun finish(result: JSONObject?, error: String?) {
        if (finished) return
        finished = true
        controller.clearImageAnalysisAnalyzer()
        controller.unbind()
        preview.controller = null
        recognizer.close()
        (view.parent as? ViewGroup)?.removeView(view)
        done(result, error)
    }

    private inner class Boxes : View(act) {
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp(2f); color = 0xffffd400.toInt() }
        private val fill = Paint().apply { color = 0x33ffd400 }
        private val r = RectF()

        override fun onDraw(canvas: Canvas) {
            val pad = dp(4f)
            val radius = dp(6f)
            for (l in lines) {
                val b = l.boundingBox ?: continue
                r.set(b)
                r.inset(-pad, -pad)
                canvas.drawRoundRect(r, radius, radius, fill)
                canvas.drawRoundRect(r, radius, radius, stroke)
            }
        }

        override fun onTouchEvent(e: MotionEvent): Boolean {
            if (e.actionMasked == MotionEvent.ACTION_UP) {
                performClick()
                tap(e.x, e.y)
            }
            return true
        }

        override fun performClick(): Boolean = super.performClick()
    }
}
