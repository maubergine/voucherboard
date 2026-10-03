package uk.co.voucherboard.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** The UI's key-value store. Each value is kept as its JSON text, in app-private SharedPreferences. */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("vb_store", Context.MODE_PRIVATE)

    /** The stored value as an org.json value (JSONObject, JSONArray, String, Number, Boolean), or JSONObject.NULL. */
    fun get(key: String): Any =
        prefs.getString(key, null)?.let { runCatching { JSONTokener(it).nextValue() }.getOrNull() } ?: JSONObject.NULL

    fun set(key: String, value: Any?) {
        if (value == null || value == JSONObject.NULL) remove(key) else prefs.edit().putString(key, jsonText(value)).apply()
    }

    fun remove(key: String) = prefs.edit().remove(key).apply()

    private fun jsonText(v: Any): String = when (v) {
        is JSONObject, is JSONArray -> v.toString()
        is Number -> JSONObject.numberToString(v)
        is Boolean -> v.toString()
        else -> JSONObject.quote(v.toString())
    }
}
