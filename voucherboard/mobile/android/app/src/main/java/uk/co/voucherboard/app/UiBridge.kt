package uk.co.voucherboard.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/** The UI view: serves assets/www and answers VBNative.call (mobile/BRIDGE.md). */
class UiBridge(private val act: MainActivity) {
    companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$ASSET_HOST"
        const val START = "$ORIGIN/www/index.html"
    }

    private class BadArgs(message: String) : Exception(message)

    private val web = act.ui
    private val store = Store(act)
    private val main = Handler(Looper.getMainLooper())
    private val queued = mutableListOf<JSONObject>()
    private var helloed = false

    private val loader = WebViewAssetLoader.AssetsPathHandler(act).let { assets ->
        WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            // AssetsPathHandler gets the path after the prefix, so put the www/ back.
            .addPathHandler("/www/", WebViewAssetLoader.PathHandler { path -> assets.handle("www/$path") })
            .build()
    }

    init {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
        }
        web.setBackgroundColor(0xfff6f8fb.toInt())
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val u = request?.url ?: return true
                return !(u.scheme == "https" && u.host == ASSET_HOST && (u.path ?: "").startsWith("/www/"))
            }

            // The UI has no network of its own: anything not in the bundle gets an empty 403.
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val u = request?.url ?: return null
                if (u.scheme == "https" && u.host == ASSET_HOST) loader.shouldInterceptRequest(u)?.let { return it }
                return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                helloed = false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                act.applyInsetsToPage()
            }
        }
    }

    fun load() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            val msg = android.text.Html.escapeHtml(act.getString(R.string.webview_too_old))
            web.loadDataWithBaseURL(null, "<p style=\"font:16px sans-serif;padding:24px\">$msg</p>", "text/html", "utf-8", null)
            return
        }
        WebViewCompat.addWebMessageListener(web, "vbNative", setOf(ORIGIN),
            WebViewCompat.WebMessageListener { _, message, _, isMainFrame, replyProxy ->
                if (isMainFrame) onMessage(message.data, replyProxy)
            })
        web.loadUrl(START)
    }

    /** A notification tap. Held until the UI has said hello, so a cold start doesn't lose it. */
    fun notification(event: JSONObject) {
        if (helloed) act.emit("notification", event) else queued += event
    }

    private inner class Reply(private val id: Any, private val proxy: JavaScriptReplyProxy) {
        private var sent = false
        fun ok(value: Any?) = send(JSONObject().put("id", id).put("ok", true).put("value", value ?: JSONObject.NULL))
        fun fail(error: String) = send(JSONObject().put("id", id).put("ok", false).put("error", error))
        private fun send(o: JSONObject) {
            if (Looper.myLooper() != Looper.getMainLooper()) {
                main.post { send(o) }
                return
            }
            if (sent) return
            sent = true
            proxy.postMessage(o.toString())
        }
    }

    private fun onMessage(data: String?, proxy: JavaScriptReplyProxy) {
        val msg = try { JSONObject(data ?: return) } catch (e: JSONException) { return }
        val id = msg.opt("id") ?: return
        val reply = Reply(id, proxy)
        try {
            dispatch(msg.optString("cmd"), msg.optJSONObject("args") ?: JSONObject(), reply)
        } catch (e: BadArgs) {
            reply.fail(e.message ?: "bad arguments")
        } catch (e: Exception) {
            reply.fail("failed")
        }
    }

    private fun dispatch(cmd: String, args: JSONObject, reply: Reply) {
        when (cmd) {
            "hello" -> {
                helloed = true
                reply.ok(JSONObject().put("platform", "android").put("version", BuildConfig.VERSION_NAME).put("build", BuildConfig.VERSION_CODE.toString()))
                val events = queued.toList()
                queued.clear()
                main.post { events.forEach { act.emit("notification", it) } }
            }
            "council.fetch" -> act.council.fetch(fetchRequest(args)) { value, error ->
                if (error != null) reply.fail(error) else reply.ok(value)
            }
            "council.show" -> {
                val reason = args.str("reason", 16)
                if (reason !in setOf("signin", "buy", "browse")) throw BadArgs("bad reason")
                val path = CouncilView.sitePath(args.str("path", 2048)) ?: throw BadArgs("bad path")
                val buy = if (reason == "buy") buyIntent(args.optJSONObject("buy") ?: throw BadArgs("bad buy")) else null
                act.council.show(reason, path, buy) { reply.ok(null) }
            }
            "council.signOut" -> act.council.signOut { reply.ok(null) }
            "store.get" -> reply.ok(store.get(key(args)))
            "store.set" -> {
                val key = key(args)
                if (!args.has("value")) throw BadArgs("bad value")
                store.set(key, args.get("value"))
                reply.ok(null)
            }
            "store.remove" -> { store.remove(key(args)); reply.ok(null) }
            "notify.permission" -> act.requestNotifications { reply.ok(JSONObject().put("granted", it)) }
            "notify.schedule" -> { Reminders.schedule(act, reminderItems(args)); reply.ok(null) }
            "orientation.set" -> {
                act.requestedOrientation = when (args.str("mode", 16)) {
                    "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    "auto" -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                    else -> throw BadArgs("bad mode")
                }
                reply.ok(null)
            }
            "run.begin" -> { act.keepScreenOn(true); reply.ok(null) }
            "run.end" -> { act.keepScreenOn(false); reply.ok(null) }
            "share" -> {
                val title = args.optStr("title", 200) ?: ""
                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, args.str("text", 20_000))
                    .putExtra(Intent.EXTRA_SUBJECT, title)
                act.startActivity(Intent.createChooser(send, title.ifEmpty { null }))
                reply.ok(null)
            }
            "haptic" -> {
                val confirm = if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
                val reject = if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.VIRTUAL_KEY
                web.performHapticFeedback(when (args.str("kind", 16)) {
                    "success" -> confirm
                    "warning", "error" -> reject
                    "light" -> HapticFeedbackConstants.CLOCK_TICK
                    else -> throw BadArgs("bad kind")
                })
                reply.ok(null)
            }
            "openExternal" -> {
                val u = Uri.parse(args.str("url", 4096))
                if (u.scheme != "https" || u.host.isNullOrEmpty()) throw BadArgs("bad url")
                try {
                    act.startActivity(Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE))
                    reply.ok(null)
                } catch (e: ActivityNotFoundException) {
                    reply.fail("no browser")
                }
            }
            else -> reply.fail("unknown command")
        }
    }

    // ---------- argument checks ----------

    private fun JSONObject.str(name: String, max: Int): String {
        val v = opt(name)
        if (v !is String || v.length > max) throw BadArgs("bad $name")
        return v
    }

    private fun JSONObject.optStr(name: String, max: Int): String? = if (isNull(name)) null else str(name, max)

    private fun key(args: JSONObject) = args.str("key", 256).also { if (it.isEmpty()) throw BadArgs("bad key") }

    private val headerName = Regex("^[A-Za-z0-9-]{1,64}$")

    private fun fetchRequest(args: JSONObject): JSONObject {
        val method = args.str("method", 8).uppercase()
        if (method != "GET" && method != "POST") throw BadArgs("bad method")
        val path = CouncilView.sitePath(args.str("path", 4096)) ?: throw BadArgs("bad path")
        val headers = JSONObject()
        args.optJSONObject("headers")?.let { h ->
            for (k in h.keys()) {
                val v = h.opt(k)
                if (!headerName.matches(k) || v !is String || v.length > 1024 || v.any { it == '\r' || it == '\n' }) throw BadArgs("bad header")
                headers.put(k, v)
            }
        }
        val body = args.optStr("body", 1_000_000)
        return JSONObject().put("method", method).put("path", path).put("headers", headers).put("body", body ?: JSONObject.NULL)
    }

    private fun buyIntent(b: JSONObject): JSONObject {
        fun idOf(name: String): String {
            val s = when (val v = b.opt(name)) {
                is String -> v
                is Int, is Long -> v.toString()
                else -> throw BadArgs("bad $name")
            }
            if (s.isEmpty() || s.length > 64) throw BadArgs("bad $name")
            return s
        }
        val count = b.opt("count")
        if (count !is Int || count < 1 || count > 1000) throw BadArgs("bad count")
        // buyfill.js compares permitId with the button's data-permitid attribute, so it must be a string.
        return JSONObject().put("permitId", idOf("permitId")).put("periodPriceId", idOf("periodPriceId"))
            .put("count", count).put("label", b.str("label", 200))
    }

    private fun reminderItems(args: JSONObject): List<Reminders.Item> {
        val arr: JSONArray = args.optJSONArray("items") ?: throw BadArgs("bad items")
        if (arr.length() > 100) throw BadArgs("too many items")
        return (0 until arr.length()).map { i ->
            val o = arr.optJSONObject(i) ?: throw BadArgs("bad item")
            val actions = o.optJSONArray("actions") ?: JSONArray()
            val extend = (0 until actions.length()).mapNotNull { actions.optJSONObject(it) }.firstOrNull { it.opt("id") == "extend" }
            val data = o.optJSONObject("data") ?: JSONObject()
            if (data.toString().length > 4000) throw BadArgs("data too big")
            Reminders.Item(
                id = o.str("id", 128).also { if (it.isEmpty()) throw BadArgs("bad id") },
                at = parseTime(o.str("at", 64)) ?: throw BadArgs("bad at"),
                title = o.str("title", 200),
                body = o.optStr("body", 1000) ?: "",
                extendTitle = extend?.str("title", 60),
                data = data.toString(),
            )
        }.associateBy { it.id }.values.toList()
    }

    private fun parseTime(s: String): Long? = try {
        Instant.parse(s).toEpochMilli()
    } catch (e: DateTimeParseException) {
        try { OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (e2: DateTimeParseException) { null }
    }
}
