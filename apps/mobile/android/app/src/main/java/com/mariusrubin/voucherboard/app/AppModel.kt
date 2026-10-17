package com.mariusrubin.voucherboard.app

import android.net.Uri
import android.util.Log
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.mariusrubin.voucherboard.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.serializer
import org.json.JSONObject
import java.util.UUID

/** Decodes the engine's JSON. Unknown fields are skipped, so the engine can add to a view before the app reads it. */
val EngineJson = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

/** Builds call arguments: strings, numbers, booleans, lists, maps, QuickForm and null. */
fun args(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(pairs.associate { (k, v) -> k to toJson(v) })

fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is QuickForm -> EngineJson.encodeToJsonElement(v)
    is Collection<*> -> JsonArray(v.map(::toJson))
    is Map<*, *> -> JsonObject(v.entries.associate { (k, x) -> k.toString() to toJson(x) })
    else -> throw IllegalArgumentException("can't send ${v::class.simpleName} to the engine")
}

/**
 * Calls the engine in the invisible engine view (apps/mobile/BRIDGE.md, "Engine API"). Android has no callAsyncJavaScript,
 * so each call is started with evaluateJavascript and its result comes back on the `vbEngine` message listener.
 */
class EngineClient {
    var webView: WebView? = null
    private var ready = false
    private val waiting = mutableListOf<CompletableDeferred<Unit>>()
    private val calls = mutableMapOf<Long, CompletableDeferred<Result<String>>>()
    private var seq = 0L

    /** The engine page has loaded; calls made before this wait for it. */
    fun pageLoaded() {
        ready = true
        waiting.forEach { it.complete(Unit) }
        waiting.clear()
    }

    /** The page went away (renderer gone, reload): calls in flight fail, new ones wait for the next load. */
    fun pageGone() {
        ready = false
        calls.values.forEach { it.complete(Result.failure(EngineError("The engine stopped"))) }
        calls.clear()
    }

    /** A reply from the page's `vbEngine.postMessage`: `{ id, ok, value }` with `value` as JSON text, or `{ id, ok: false, error }`. */
    fun reply(data: String) {
        val m = runCatching { JSONObject(data) }.getOrNull() ?: return
        val call = calls.remove(m.optLong("id", -1)) ?: return
        call.complete(if (m.optBoolean("ok")) Result.success(m.optString("value", "null")) else Result.failure(EngineError(m.optString("error", "failed"))))
    }

    /** Returns the engine's answer as JSON text. Runs on the main thread. */
    suspend fun callRaw(name: String, args: JsonObject = JsonObject(emptyMap())): String {
        if (!ready) CompletableDeferred<Unit>().also { waiting += it }.await()
        val web = webView ?: throw EngineError("No engine")
        val id = ++seq
        val done = CompletableDeferred<Result<String>>()
        calls[id] = done
        val js = "(function(){var i=$id;VBEngine.call(${JSONObject.quote(name)},$args).then(function(v){" +
            "vbEngine.postMessage(JSON.stringify({id:i,ok:true,value:JSON.stringify(v===undefined?null:v)}))},function(e){" +
            "vbEngine.postMessage(JSON.stringify({id:i,ok:false,error:String(e&&e.message||e)}))})})()"
        web.evaluateJavascript(js, null)
        return done.await().getOrThrow()
    }

    suspend fun <T> call(name: String, args: JsonObject, serializer: KSerializer<T>): T =
        EngineJson.decodeFromString(serializer, callRaw(name, args))
}

class EngineError(message: String) : Exception(message)

enum class AppTab { Today, Calendar, List, Vehicles, More }

/** What opens Book a visitor: a ready-made form (Extend, a favourite, a day), or plates from a scan. */
data class QuickStart(
    val view: Seed = Seed(),
    val cands: List<ActionResult.Candidate> = emptyList(),
    val err: String? = null,
    val scan: String? = null,
)

/** quickInit's options: vehicles, days and times to start with. */
data class Seed(
    val vrns: List<String> = emptyList(),
    val days: List<String>? = null,
    val from: Int? = null,
    val to: Int? = null,
    val extend: TodayView.Live.Extend? = null,
    val form: QuickForm? = null,
)

sealed class Sheet {
    data class Quick(val start: QuickStart) : Sheet()
    data object Plan : Sheet()
    data class Entry(val id: Int) : Sheet()
    data class Visit(val key: String) : Sheet()
    data class Bulk(val keys: List<String>) : Sheet()
    data class BulkTime(val keys: List<String>) : Sheet()
    data object Run : Sheet()
    data object NewFavourite : Sheet()
}

data class Toast(
    val text: String,
    val undo: Int? = null,
    val error: Boolean = false,
    /** Shown while an action runs; the result replaces it in place. */
    val busy: Boolean = false,
    /** How much of a busy cancel is done, 0 to 1, from the engine's `progress` events. Null shows a spinner. */
    val progress: Double? = null,
    /** Stays until closed: set by `show` from the message time setting, or for Undo while TalkBack is on. */
    val sticky: Boolean = false,
    val id: String = UUID.randomUUID().toString(),
)

/** Native features the screens use that aren't engine calls: Live Updates and the appearance setting. */
interface AppHost {
    fun syncLive(today: TodayView)
    var appearance: String
    /** The user has turned off Live Updates for the app in Android's settings (Android 16+). */
    val liveBlocked: Boolean
    fun openLiveSettings()
    /** TalkBack (or another touch-exploration service) is on. */
    val screenReader: Boolean
    /** Android's "Time to take action" setting applied to a timeout, as AccessibilityManager.getRecommendedTimeoutMillis. */
    fun recommendedTimeout(ms: Long): Long
}

/**
 * The app's screen state, as AppModel.swift. The engine owns the data; this keeps what's on screen and fetches views
 * again whenever the engine says something changed (`version` goes up, and every screen's LaunchedEffect runs again).
 */
class AppModel(val host: AppHost) {
    val engine = EngineClient()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    var home by mutableStateOf<HomeView?>(null)
    var tab by mutableStateOf(AppTab.Today)
    var sheet by mutableStateOf<Sheet?>(null)
    var toast by mutableStateOf<Toast?>(null)
    var version by mutableIntStateOf(0)
    var boardSelection by mutableStateOf(setOf<String>())
    /** The Bookings tab's select mode, and the rows ticked in it by bulk key. A bulk action ends select mode. */
    var listSelecting by mutableStateOf(false)
    var listSelection by mutableStateOf(setOf<String>())
    fun endListSelect() { listSelecting = false; listSelection = emptySet() }
    /** A link from a Live Update, kept until the permits have loaded. */
    private var pendingLink: Uri? = null
    private var pendingChange = false
    private var toastJob: Job? = null

    // ---------- engine events ----------

    fun event(type: String, data: JSONObject) {
        when (type) {
            "change", "tick", "run" -> changed()
            "toast" -> data.optString("text").takeIf { it.isNotEmpty() }?.let { show(Toast(it)) }
            "progress" -> {
                val t = toast ?: return
                val done = data.optInt("done", -1)
                val total = data.optInt("total", 0)
                if (!t.busy || done < 0 || total <= 0) return
                // The voucher being cancelled counts as half done.
                toast = t.copy(progress = (done + 0.5) / total, text = if (total > 1) "Cancelling ${done + 1} of $total vouchers…" else t.text)
            }
            "home" -> { sheet = null; tab = AppTab.Today }
            "quick" -> {
                val q = data.optJSONObject("view")?.optJSONObject("q") ?: return
                runCatching { EngineJson.decodeFromString(QuickForm.serializer(), q.toString()) }.getOrNull()?.let {
                    sheet = Sheet.Quick(QuickStart(view = Seed(form = it)))
                }
            }
            "scan" -> {
                val r = runCatching { EngineJson.decodeFromString(ActionResult.serializer(), data.toString()) }.getOrNull() ?: ActionResult()
                sheet = Sheet.Quick(QuickStart(cands = r.cands ?: emptyList(), err = r.err))
            }
        }
    }

    /** Many changes can come at once (a run reports each step); they're folded into one refresh. */
    private fun changed() {
        if (pendingChange) return
        pendingChange = true
        scope.launch {
            delay(40)
            pendingChange = false
            refresh()
        }
    }

    suspend fun refresh() {
        view("home", serializer = HomeView.serializer())?.let { h ->
            home = h
            if (h.running && sheet != Sheet.Run) sheet = Sheet.Run
            if (!h.running && sheet == Sheet.Run) sheet = null
            if (h.phase == "ready") {
                view("today", serializer = TodayView.serializer())?.let { host.syncLive(it) }
                pendingLink?.let { pendingLink = null; follow(it) }
            }
        }
        version += 1
    }

    // ---------- links from the Live Update ----------

    /**
     * `voucherboard://visit?key=` opens the booking; `voucherboard://extend?vrn=&dk=&end=` opens Book a visitor to
     * extend it. Anything that doesn't look right is ignored.
     */
    fun open(link: Uri) {
        if (home?.phase == "ready") follow(link) else pendingLink = link
    }

    private fun follow(url: Uri) {
        val vrn = Regex("^[A-Z0-9]{1,10}$")
        val dk = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        when (url.host) {
            "visit" -> {
                val key = url.getQueryParameter("key") ?: return
                if (!Regex("^[A-Z0-9]{1,10}\\|\\d{4}-\\d{2}-\\d{2}\\|\\d{1,4}$").matches(key)) return
                tab = AppTab.Today
                sheet = Sheet.Visit(key)
            }
            "extend" -> {
                val v = url.getQueryParameter("vrn")?.takeIf { vrn.matches(it) } ?: return
                val d = url.getQueryParameter("dk")?.takeIf { dk.matches(it) } ?: return
                val end = url.getQueryParameter("end")?.toIntOrNull()?.takeIf { it in 0..1440 } ?: return
                tab = AppTab.Today
                sheet = Sheet.Quick(QuickStart(view = Seed(extend = TodayView.Live.Extend(v, d, end))))
            }
        }
    }

    // ---------- calls ----------

    suspend fun <T> view(name: String, args: JsonObject = JsonObject(emptyMap()), serializer: KSerializer<T>): T? = try {
        val raw = engine.callRaw(name, args)
        if (raw == "null") null else EngineJson.decodeFromString(serializer, raw)
    } catch (e: CancellationException) {
        throw e // the screen went away; not a failure
    } catch (e: Exception) {
        if (BuildConfig.DEBUG) Log.w("Voucherboard", "engine view $name failed", e)
        null
    }

    suspend inline fun <reified T> view(name: String, args: JsonObject = JsonObject(emptyMap())): T? = view(name, args, serializer<T>())

    /**
     * Runs an action and shows what it says: its message (with Undo), or its error. With `progress`, a busy toast
     * shows until it finishes.
     */
    suspend fun act(name: String, args: JsonObject = JsonObject(emptyMap()), progress: String? = null): ActionResult {
        if (progress != null) show(Toast(progress, busy = true))
        val r = try {
            val raw = engine.callRaw(name, args)
            if (raw == "null") ActionResult() else EngineJson.decodeFromString(ActionResult.serializer(), raw)
        } catch (e: Exception) {
            ActionResult(err = e.message ?: "Something went wrong.")
        }
        val t = toast
        if (r.err.isNullOrEmpty() && t != null && t.busy && t.progress != null) {
            // Let the pie fill before the tick replaces it.
            toast = t.copy(progress = 1.0)
            delay(350)
        }
        when {
            !r.err.isNullOrEmpty() -> show(Toast(r.err, error = true))
            !r.toast.isNullOrEmpty() -> show(Toast(r.toast, undo = r.undo))
            progress != null && toast?.busy == true -> toast = null
        }
        return r
    }

    /** Fire and forget, for buttons. */
    fun launchAct(name: String, args: JsonObject = JsonObject(emptyMap()), progress: String? = null, then: (ActionResult) -> Unit = {}) {
        scope.launch { then(act(name, args, progress)) }
    }

    fun undo(id: Int) {
        toast = null
        launchAct("undo", args("id" to id))
    }

    /**
     * Shows a message; ToastView is a live region, so TalkBack reads it out. It goes after 4 seconds (6 with Undo), times
     * the message time setting, or Android's "Time to take action" if longer; with the setting at 0, or with Undo while
     * TalkBack is on, it stays until closed.
     */
    fun show(t: Toast) {
        val times = home?.messageTime ?: 1
        val shown = t.copy(sticky = !t.busy && (times == 0 || (t.undo != null && host.screenReader)))
        toast = shown
        toastJob?.cancel()
        if (shown.busy || shown.sticky) return
        val ms = (if (t.undo != null) 6000L else 4000L) * maxOf(times, 1)
        toastJob = scope.launch {
            delay(host.recommendedTimeout(ms))
            if (toast?.id == shown.id) toast = null
        }
    }

    // ---------- shortcuts used by several screens ----------

    fun book(seed: Seed = Seed()) { sheet = Sheet.Quick(QuickStart(view = seed)) }

    fun scanToBook(source: String) { sheet = Sheet.Quick(QuickStart(scan = source)) }

    fun open(row: Row) {
        if (row.kind == "visit" && row.key != null) sheet = Sheet.Visit(row.key) else row.id?.let { sheet = Sheet.Entry(it) }
    }

    fun open(block: Block) {
        if (block.kind == "visit" && block.key != null) sheet = Sheet.Visit(block.key) else block.id?.let { sheet = Sheet.Entry(it) }
    }

    /** A scan opens the camera or photo picker, so it can take as long as the user does. Errors come back as `err`. */
    suspend fun callScan(source: String): ActionResult = try {
        engine.call("scan", args("source" to source), ActionResult.serializer())
    } catch (e: Exception) {
        ActionResult(err = "Couldn't read the picture. Try again, or type the plate.")
    }
}
