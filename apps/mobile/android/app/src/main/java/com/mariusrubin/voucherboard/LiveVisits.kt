package com.mariusrubin.voucherboard

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import com.mariusrubin.voucherboard.app.TodayView

/**
 * The Live Update: the Android counterpart of the iOS Live Activity (LiveVisits.swift). One ongoing notification per
 * visitor parked now, from the Today view the app fetches on every engine change, promoted on Android 16 and later to a
 * Live Update: a chip in the status bar counting down to the end, and on the lock screen and at the top of the shade a
 * progress bar with one segment per voucher, a car moving along it, and Extend. It's local: nothing is pushed.
 *
 * It meets Android's Live Update rules (developer.android.com/develop/ui/views/notifications/live-update): Progress
 * style, ongoing, a title, promotion requested, POST_PROMOTED_NOTIFICATIONS declared, a channel above IMPORTANCE_MIN,
 * not colorized and not a group summary. The channel is IMPORTANCE_LOW: it never sounds or pops up. It's user-initiated and time-bound, as the rules ask: a visitor the user
 * booked, parked now, until the booking ends. It times out at the end, so it goes even if the app isn't running, and a
 * visit the user swipes away isn't shown again. Before Android 16 it's an ordinary ongoing notification.
 */
object LiveVisits {
    private const val CHANNEL = "live"
    private const val TAG = "vb.live"
    private const val PREFS = "vb_live"
    private const val DISMISSED = "dismissed"
    private const val ACTION_DISMISSED = "com.mariusrubin.voucherboard.action.LIVE_DISMISSED"
    private const val MOST = 3

    @SuppressLint("MissingPermission") // checked first; lint doesn't follow the SDK_INT guard
    fun sync(ctx: Context, today: TodayView) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val live = if (today.liveActivity) today.live.filter { it.endIn > 0 } else emptyList()
        // Forget dismissals of visits that are over, so a dismissal doesn't outlive its visit.
        val dismissed = dismissed(ctx).intersect(live.map { it.key }.toSet())
        saveDismissed(ctx, dismissed)
        val wanted = live.filter { it.key !in dismissed }.take(MOST)
        val ids = wanted.associateBy { id(it.key) }
        for (n in nm.activeNotifications) if (n.tag == TAG && n.id !in ids) nm.cancel(TAG, n.id)
        if (wanted.isEmpty()) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, ctx.getString(R.string.channel_live), NotificationManager.IMPORTANCE_LOW)
                .apply { description = ctx.getString(R.string.channel_live_text); setShowBadge(false) }
        )
        val now = System.currentTimeMillis()
        for ((nid, v) in ids) {
            val start = now + v.startIn.toLong()
            val end = now + v.endIn.toLong()
            val title = if (v.name != v.plate) "${v.plate} · ${v.name}" else v.plate
            val text = listOfNotNull(today.zone.takeIf { it.isNotEmpty() }?.let { "Zone $it" }, v.ends).joinToString(" · ")
            val b = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(ContextCompat.getColor(ctx, R.color.navy))
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(progress(ctx, v, start, end, now))
                // The chip and the notification count down to the end.
                .setWhen(end)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setOngoing(true)
                .setRequestPromotedOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                // Its own group, so the system doesn't fold several visits under a summary, which can't be promoted.
                .setGroup("$TAG.${v.key}")
                .setTimeoutAfter(maxOf(1L, end - now))
                .setContentIntent(link(ctx, "visit", mapOf("key" to v.key)))
                .setDeleteIntent(dismissIntent(ctx, v.key))
            v.extend?.takeIf { v.canExtend }?.let { x ->
                b.addAction(R.drawable.ic_live_extend, ctx.getString(R.string.live_extend),
                    link(ctx, "extend", mapOf("vrn" to x.vrn, "dk" to x.dk, "end" to x.end.toString())))
            }
            try {
                NotificationManagerCompat.from(ctx).notify(TAG, nid, b.build())
            } catch (e: SecurityException) {
                // Permission withdrawn between the check and the post.
            }
        }
    }

    /** One segment per voucher, alternating shades so each voucher shows; the car is how far through the visit is. */
    private fun progress(ctx: Context, v: TodayView.Live, start: Long, end: Long, now: Long): NotificationCompat.ProgressStyle {
        val total = ((end - start) / 60_000L).toInt().coerceAtLeast(1)
        val navy = ContextCompat.getColor(ctx, R.color.navy)
        val light = ContextCompat.getColor(ctx, R.color.live_light)
        val spans = v.spans?.filter { it.t > it.f }.orEmpty()
        val segments = if (spans.isEmpty()) listOf(NotificationCompat.ProgressStyle.Segment(total).setColor(navy))
        else spans.mapIndexed { i, s -> NotificationCompat.ProgressStyle.Segment(s.t - s.f).setColor(if (i % 2 == 0) navy else light) }
        return NotificationCompat.ProgressStyle()
            .setProgressSegments(segments)
            .setStyledByProgress(true)
            .setProgress(((now - start) / 60_000L).toInt().coerceIn(0, segments.sumOf { it.length }))
            .setProgressTrackerIcon(IconCompat.createWithResource(ctx, R.drawable.ic_live_car))
    }

    /**
     * Whether the user has turned off Live Updates for Voucherboard in the system settings (Android 16 and later), so
     * More can say so and offer the switch. Notifications turned off altogether are reminders' business, not this.
     */
    fun blocked(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= 36 && NotificationManagerCompat.from(ctx).areNotificationsEnabled() &&
            !NotificationManagerCompat.from(ctx).canPostPromotedNotifications()

    /** Opens the system's Live Updates switch for Voucherboard. */
    fun openSettings(ctx: Context) {
        val intent = if (Build.VERSION.SDK_INT >= 36) Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS)
        else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        try {
            ctx.startActivity(intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
        } catch (e: ActivityNotFoundException) {
            ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
        }
    }

    private fun id(key: String) = key.hashCode()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun dismissed(ctx: Context): Set<String> = prefs(ctx).getStringSet(DISMISSED, emptySet()).orEmpty()
    private fun saveDismissed(ctx: Context, keys: Set<String>) = prefs(ctx).edit().putStringSet(DISMISSED, keys).apply()

    /** The user swiped a visit away: don't show it again (Live Update guidance: don't repost what was dismissed). */
    fun onDismissed(ctx: Context, key: String) = saveDismissed(ctx, dismissed(ctx) + key)

    private fun dismissIntent(ctx: Context, key: String): PendingIntent = PendingIntent.getBroadcast(
        ctx, 0,
        Intent(ctx, LiveDismissReceiver::class.java).setAction(ACTION_DISMISSED).setData(Uri.fromParts("vblive", key, null)),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** voucherboard://visit or extend, as the Live Activity's links, carried with this install's token (MainActivity checks it). */
    private fun link(ctx: Context, host: String, query: Map<String, String>): PendingIntent {
        val url = Uri.Builder().scheme("voucherboard").authority(host).apply { query.toSortedMap().forEach { (k, v) -> appendQueryParameter(k, v) } }.build()
        val intent = Intent(ctx, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.fromParts("vblive", url.toString(), null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(Reminders.EXTRA_ACTION, "link")
            .putExtra(Reminders.EXTRA_DATA, url.toString())
            .putExtra(Reminders.EXTRA_TOKEN, Reminders.token(ctx))
        return PendingIntent.getActivity(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}

/** A Live Update swiped away. Not exported: only the notification's own PendingIntent reaches it. */
class LiveDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        intent.data?.schemeSpecificPart?.let { LiveVisits.onDismissed(context, it) }
    }
}
