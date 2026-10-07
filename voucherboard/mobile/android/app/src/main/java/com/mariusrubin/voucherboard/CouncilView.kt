package com.mariusrubin.voucherboard

import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.Insets
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONException
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * The council view (mobile/BRIDGE.md): a WebView on the council site that runs the planner's requests in the user's
 * own session, and that the user sees only to sign in, buy or browse.
 */
class CouncilView(private val act: MainActivity) {
    companion object {
        const val HOST = "parkingpermits.lewisham.gov.uk"
        const val ORIGIN = "https://$HOST"
        private const val HOME = "/Home/ApplicantPermits"
        private const val TIMEOUT_MS = 60_000L
        private val BLOCKED = Regex("/(PermitPayment|VoucherBuyAgain|Payment|Account)(/|$)", RegexOption.IGNORE_CASE)
        private val ACCOUNT = Regex("^/Account(/|$)", RegexOption.IGNORE_CASE)
        private val LOGIN = Regex("^/Account/Login", RegexOption.IGNORE_CASE)
        private val PERMITS = Regex("^/Home/ApplicantPermits(/|$)", RegexOption.IGNORE_CASE)
        private val NAVY = Color.rgb(0x2b, 0x49, 0x72)

        fun isCouncil(u: Uri?) = u != null && u.scheme == "https" && HOST.equals(u.host, ignoreCase = true) && (u.port == -1 || u.port == 443)

        /** A site-relative path that stays on the council host, or null. */
        fun sitePath(p: String): String? {
            if (!p.startsWith("/") || p.startsWith("//") || p.any { it == '\\' || it.isWhitespace() || it.isISOControl() }) return null
            return if (isCouncil(Uri.parse(ORIGIN + p))) p else null
        }
    }

    private class Job(val id: Long, val req: JSONObject, val cb: (JSONObject?, String?) -> Unit) {
        var sent = false
        var timer: Runnable? = null
    }

    val web = WebView(act)
    private val titleView = TextView(act)
    private val textView = TextView(act)
    private val header = LinearLayout(act)
    val container = LinearLayout(act)

    var shown = false
        private set
    private var reason: String? = null
    private var buyIntent: JSONObject? = null
    private var startedSinceShow = false
    private var clearHistoryNext = false
    private var outsideAccount = false
    private var loading = false

    private val main = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<Job>()
    private var current: Job? = null
    private var seq = 0L
    private val waiters = mutableListOf<() -> Unit>()
    private val docStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    private val script: String = try {
        // buyfill.js first: council.js's buy() calls VB.buyFill. One script keeps that order.
        listOf("council/buyfill.js", "council/council.js").joinToString("\n;\n") { name ->
            act.assets.open(name).bufferedReader().use { it.readText() }
        }
    } catch (e: java.io.IOException) {
        Log.e("Voucherboard", "Council scripts missing from assets", e)
        ""
    }

    init {
        buildViews()
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false) // target=_blank opens in this view
            javaScriptCanOpenWindowsAutomatically = false
            setGeolocationEnabled(false)
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
        }
        if (docStart && script.isNotEmpty()) WebViewCompat.addDocumentStartJavaScript(web, script, setOf(ORIGIN))
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "vbCouncil", setOf(ORIGIN),
                WebViewCompat.WebMessageListener { _, message, _, isMainFrame, _ ->
                    if (isMainFrame) onCouncilMessage(message.data)
                })
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val u = request?.url ?: return true
                if (isCouncil(u)) return false
                // Hidden, the view stays on the council host. Shown, it may go to the card and 3-D Secure pages.
                return !(shown && u.scheme == "https")
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                loading = true
                startedSinceShow = true
                // A navigation kills the page's pending fetch, so fail it now rather than after the timeout.
                current?.let { if (it.sent) finish(it, null, "network") }
            }

            override fun onPageFinished(view: WebView?, url: String?) = pageFinished(url)
        }
        // Dialogs only while the user can see the page; a hidden page never puts one over the planner.
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?) = hiddenCancel(result)
            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?) = hiddenCancel(result)
            override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?) = hiddenCancel(result)
            // Hidden, leaving is always allowed, so loading the permits page is never held up.
            override fun onJsBeforeUnload(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                if (shown) return false
                result?.confirm()
                return true
            }
            private fun hiddenCancel(result: JsResult?): Boolean {
                if (shown) return false
                result?.cancel()
                return true
            }
        }
    }

    private fun dp(v: Int) = (v * act.resources.displayMetrics.density).roundToInt()

    private fun buildViews() {
        titleView.apply { setTextColor(Color.WHITE); textSize = 17f; typeface = Typeface.DEFAULT_BOLD }
        textView.apply { setTextColor(Color.WHITE); textSize = 14f; setPadding(0, dp(6), 0, 0) }
        val back = Button(act).apply {
            setText(R.string.council_back)
            isAllCaps = false
            setTextColor(NAVY)
            backgroundTintList = ColorStateList.valueOf(Color.WHITE)
            setOnClickListener { close(auto = false) }
        }
        val row = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            addView(titleView, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(back, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        }
        header.apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(NAVY)
            addView(row)
            addView(textView)
        }
        container.apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(NAVY)
            // INVISIBLE, not GONE: the hidden page keeps a size and keeps running.
            visibility = View.INVISIBLE
            addView(header, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(web, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        }
    }

    fun applyInsets(bars: Insets, ime: Insets) {
        header.setPadding(dp(16), dp(10) + bars.top, dp(12), dp(12))
        container.setPadding(bars.left, 0, bars.right, maxOf(bars.bottom, ime.bottom))
    }

    // ---------- shown ----------

    fun show(reason: String, path: String, buy: JSONObject?, onShown: () -> Unit) {
        shown = true
        this.reason = reason
        buyIntent = buy
        startedSinceShow = false
        clearHistoryNext = true
        titleView.text = act.getString(if (reason == "signin") R.string.council_title_signin else R.string.council_title_site)
        textView.text = act.getString(when (reason) {
            "signin" -> R.string.council_text_signin
            "buy" -> R.string.council_text_buy
            else -> R.string.council_text_browse
        })
        container.visibility = View.VISIBLE
        container.bringToFront()
        act.councilShown(true)
        loading = true
        web.loadUrl(ORIGIN + path)
        web.requestFocus()
        container.post { onShown() }
    }

    fun back() {
        if (web.canGoBack()) web.goBack() else close(auto = false)
    }

    private fun close(auto: Boolean) {
        if (!shown) return
        val r = reason
        shown = false
        reason = null
        buyIntent = null
        web.clearFocus()
        container.visibility = View.INVISIBLE
        act.councilShown(false)
        act.emit("council.closed", JSONObject().put("reason", r).put("signedIn", auto || outsideAccount))
    }

    private fun pageFinished(url: String?) {
        loading = false
        val u = url?.let(Uri::parse)
        if (isCouncil(u)) {
            outsideAccount = !ACCOUNT.containsMatchIn(u!!.path ?: "/")
            // Old WebView without document-start scripts: inject at page end instead.
            if (!docStart && script.isNotEmpty()) web.evaluateJavascript("if(!window.__vbCouncil){$script\n}", null)
        }
        if (shown && startedSinceShow) {
            if (clearHistoryNext) { clearHistoryNext = false; web.clearHistory() }
            val path = u?.path ?: ""
            when (reason) {
                "signin" -> if (isCouncil(u) && outsideAccount) close(auto = true)
                "buy" -> buyIntent?.let { intent ->
                    if (isCouncil(u) && PERMITS.containsMatchIn(path)) {
                        buyIntent = null
                        web.evaluateJavascript("window.__vbCouncil&&__vbCouncil.buy($intent)", null)
                    }
                }
            }
        }
        val ready = waiters.toList()
        waiters.clear()
        ready.forEach { it() }
    }

    fun signOut(done: () -> Unit) {
        val cm = CookieManager.getInstance()
        cm.removeAllCookies {
            cm.flush()
            WebStorage.getInstance().deleteAllData()
            web.clearCache(true)
            if (web.url != null) { loading = true; web.loadUrl(ORIGIN + HOME) }
            done()
        }
    }

    fun destroy() {
        main.removeCallbacksAndMessages(null)
        web.destroy()
    }

    // ---------- council.fetch ----------

    fun fetch(req: JSONObject, cb: (JSONObject?, String?) -> Unit) {
        queue.addLast(Job(++seq, req, cb))
        pump()
    }

    private fun pump() {
        if (current != null) return
        val job = queue.removeFirstOrNull() ?: return
        current = job
        job.timer = Runnable {
            if (!job.sent && loading) { web.stopLoading(); loading = false }
            finish(job, null, "network")
        }.also { main.postDelayed(it, TIMEOUT_MS) }
        whenReady(job, navigated = false)
    }

    /** Runs the job once the view shows a council page council.js will work on, loading the permits page if needed. */
    private fun whenReady(job: Job, navigated: Boolean) {
        if (current !== job) return
        if (loading) { waiters += { whenReady(job, navigated) }; return }
        if (!isCouncil(web.url?.let(Uri::parse))) return notReady(job, navigated)
        web.evaluateJavascript("!!(window.__vbCouncil&&__vbCouncil.ready())") { r ->
            if (current !== job) return@evaluateJavascript
            if (r == "true" && isCouncil(web.url?.let(Uri::parse))) send(job) else notReady(job, navigated)
        }
    }

    private fun notReady(job: Job, navigated: Boolean) {
        val url = web.url
        val u = url?.let(Uri::parse)
        when {
            // Signed out: answer like the browser would, with the login page's URL, so portal.js says so.
            navigated && isCouncil(u) && LOGIN.containsMatchIn(u!!.path ?: "") ->
                finish(job, JSONObject().put("status", 200).put("url", url).put("body", ""), null)
            navigated -> finish(job, null, if (BLOCKED.containsMatchIn(u?.path ?: "")) "blocked" else "network")
            // Never pull the page out from under the user; wait for them to reach a usable page or close the view.
            shown -> waiters += { whenReady(job, navigated = false) }
            else -> {
                loading = true
                web.loadUrl(ORIGIN + HOME)
                waiters += { whenReady(job, navigated = true) }
            }
        }
    }

    private fun send(job: Job) {
        job.sent = true
        val js = "(function(){if(!window.__vbCouncil||!window.vbCouncil)return false;__vbCouncil.fetchAndPost(${job.id},${job.req});return true})()"
        web.evaluateJavascript(js) { r -> if (r != "true") finish(job, null, "network") }
    }

    private fun onCouncilMessage(data: String?) {
        val m = try { JSONObject(data ?: return) } catch (e: JSONException) { return }
        val job = current ?: return
        if (!job.sent || m.optLong("id", -1) != job.id) return
        if (m.has("error")) {
            finish(job, null, if (m.optString("error") == "blocked") "blocked" else "network")
        } else {
            finish(job, JSONObject().put("status", m.optInt("status")).put("url", m.optString("url")).put("body", m.optString("body")), null)
        }
    }

    private fun finish(job: Job, value: JSONObject?, error: String?) {
        if (current !== job) return
        current = null
        job.timer?.let { main.removeCallbacks(it) }
        job.cb(value, error)
        main.post { pump() }
    }
}
