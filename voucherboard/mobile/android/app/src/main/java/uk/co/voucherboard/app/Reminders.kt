package uk.co.voucherboard.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** notify.schedule: alarms that post local notifications. Items are saved so they can be rescheduled after a reboot. */
object Reminders {
    const val EXTRA_ACTION = "vb.action"
    const val EXTRA_DATA = "vb.data"
    const val EXTRA_NOTIFICATION = "vb.notification"
    const val EXTRA_TOKEN = "vb.token"
    private const val CHANNEL = "reminders"
    private const val PREFS = "vb_reminders"
    private const val ACTION_FIRE = "uk.co.voucherboard.app.action.REMINDER"
    private const val ACTION_TAP = "uk.co.voucherboard.app.action.NOTIFICATION"

    data class Item(val id: String, val at: Long, val title: String, val body: String, val extendTitle: String?, val data: String) {
        fun toJson(): JSONObject = JSONObject().put("id", id).put("at", at).put("title", title).put("body", body)
            .put("extendTitle", extendTitle ?: JSONObject.NULL).put("data", data)

        companion object {
            fun from(o: JSONObject) = Item(o.getString("id"), o.getLong("at"), o.getString("title"), o.optString("body"),
                if (o.isNull("extendTitle")) null else o.getString("extendTitle"), o.optString("data", "{}"))
        }
    }

    /** Replaces every pending reminder with [items]. Items in the past are skipped. */
    fun schedule(ctx: Context, items: List<Item>) {
        load(ctx).forEach { alarms(ctx).cancel(alarmIntent(ctx, it.id)) }
        val now = System.currentTimeMillis()
        val keep = items.filter { it.at > now }
        save(ctx, keep)
        keep.forEach { setAlarm(ctx, it) }
    }

    fun rescheduleAll(ctx: Context) {
        val now = System.currentTimeMillis()
        val keep = load(ctx).filter { it.at > now }
        save(ctx, keep)
        keep.forEach { setAlarm(ctx, it) }
    }

    fun fire(ctx: Context, id: String) {
        val items = load(ctx)
        val item = items.firstOrNull { it.id == id } ?: return
        save(ctx, items - item)
        post(ctx, item)
    }

    /** A per-install secret that marks the notification intents as ours. */
    fun token(ctx: Context): String {
        val p = prefs(ctx)
        return p.getString("token", null) ?: UUID.randomUUID().toString().also { p.edit().putString("token", it).apply() }
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun alarms(ctx: Context) = ctx.getSystemService(AlarmManager::class.java)

    private fun load(ctx: Context): List<Item> = runCatching {
        val arr = JSONArray(prefs(ctx).getString("items", "[]"))
        (0 until arr.length()).map { Item.from(arr.getJSONObject(it)) }
    }.getOrDefault(emptyList())

    private fun save(ctx: Context, items: List<Item>) {
        prefs(ctx).edit().putString("items", JSONArray(items.map { it.toJson() }).toString()).apply()
    }

    // The data URI makes each reminder's PendingIntent distinct, so cancel() finds the right one.
    private fun alarmIntent(ctx: Context, id: String): PendingIntent = PendingIntent.getBroadcast(
        ctx, 0,
        Intent(ctx, ReminderReceiver::class.java).setAction(ACTION_FIRE).setData(Uri.fromParts("vbreminder", id, null)),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun setAlarm(ctx: Context, item: Item) {
        val am = alarms(ctx)
        val pi = alarmIntent(ctx, item.id)
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pi)
        }
    }

    private fun tapIntent(ctx: Context, item: Item, action: String, notificationId: Int): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .setAction(ACTION_TAP)
            .setData(Uri.fromParts("vbnotification", "$action/${item.id}", null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_ACTION, action)
            .putExtra(EXTRA_DATA, item.data)
            .putExtra(EXTRA_NOTIFICATION, notificationId)
            .putExtra(EXTRA_TOKEN, token(ctx))
        return PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    @SuppressLint("MissingPermission") // checked on the first line; lint doesn't follow the SDK_INT guard
    private fun post(ctx: Context, item: Item) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, ctx.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = ctx.getString(R.string.channel_reminders_text) }
        )
        val nid = item.id.hashCode()
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(ctx, R.color.navy))
            .setContentTitle(item.title)
            .setContentText(item.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(item.body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tapIntent(ctx, item, "open", nid))
        item.extendTitle?.let { b.addAction(0, it, tapIntent(ctx, item, "extend", nid)) }
        try {
            NotificationManagerCompat.from(ctx).notify(nid, b.build())
        } catch (e: SecurityException) {
            // Permission withdrawn between the check and the post.
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        intent.data?.schemeSpecificPart?.let { Reminders.fire(context, it) }
    }
}

class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> Reminders.rescheduleAll(context)
        }
    }
}
