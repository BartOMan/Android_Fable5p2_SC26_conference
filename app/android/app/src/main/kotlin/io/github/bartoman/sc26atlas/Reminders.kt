package io.github.bartoman.sc26atlas

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/** Local "session reminder" notifications: AlarmManager -> [ReminderReceiver] -> notification -> MainActivity. */
object Reminders {
    const val EXTRA_ID = "reminder_id"
    const val EXTRA_TITLE = "reminder_title"
    const val EXTRA_TEXT = "reminder_text"
    private const val CHANNEL_ID = "session_reminders"
    private const val KIND_WINDOW = "window"
    private const val KIND_IDLE = "idle"

    fun schedule(context: Context, id: String, title: String, text: String, triggerAtMs: Long) {
        ensureChannel(context)
        cancelAlarms(context, id)
        val alarms = context.getSystemService(AlarmManager::class.java)
        fun alarm(kind: String) = PendingIntent.getBroadcast(
            context, 0,
            receiverIntent(context, id, kind).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        if (Build.VERSION.SDK_INT < 31) {
            // Exact alarms need no permission before Android 12.
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, alarm(KIND_IDLE))
            return
        }
        // Android 12+ without the exact-alarm permission: an inexact alarm may fire anywhere in its
        // window, and in practice fires at the very end of it. Two alarms cover each other's weak spot:
        //  - a window that ENDS at the requested time: on time or slightly early, but held back in Doze.
        //    The shortest window Android accepts is min(10 min, 75 % of the time until it opens), which
        //    works out to 3/7 of the lead time. (Android 12 stretches short windows to 10 min.)
        //  - an allow-while-idle alarm: fires in Doze, but its window STARTS at the requested time and
        //    is 75 % of the lead time long (max 1 h), so on its own it would usually be late.
        // Whichever fires first shows the notification; ReminderReceiver then cancels the other.
        val lead = triggerAtMs - System.currentTimeMillis()
        val window = minOf(10 * 60 * 1000L, lead * 3 / 7)
        if (window > 0) {
            alarms.setWindow(AlarmManager.RTC_WAKEUP, triggerAtMs - window, window, alarm(KIND_WINDOW))
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, alarm(KIND_IDLE))
    }

    /** Cancels the pending alarms and removes the notification if it is already showing. */
    fun cancel(context: Context, id: String) {
        cancelAlarms(context, id)
        context.getSystemService(NotificationManager::class.java).cancel(id, 0)
    }

    fun cancelAlarms(context: Context, id: String) {
        for (kind in listOf(KIND_WINDOW, KIND_IDLE)) {
            PendingIntent.getBroadcast(
                context, 0, receiverIntent(context, id, kind),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
            )?.let {
                context.getSystemService(AlarmManager::class.java).cancel(it)
                it.cancel()
            }
        }
    }

    fun notificationsAllowed(context: Context): Boolean {
        ensureChannel(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        return manager.areNotificationsEnabled() &&
            manager.getNotificationChannel(CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun show(context: Context, id: String, title: String, text: String) {
        ensureChannel(context)
        val open = Intent(context, MainActivity::class.java)
            .setData(reminderUri(id))
            .putExtra(EXTRA_ID, id)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
        val notification = Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setColor(context.getColor(R.color.accent_cyan))
            .setContentTitle(title.ifEmpty { context.getString(R.string.app_name) })
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true) // both alarms of a reminder can fire together
            .setContentIntent(
                PendingIntent.getActivity(
                    context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        // Silently dropped by the system if the user has not allowed notifications.
        context.getSystemService(NotificationManager::class.java).notify(id, 0, notification)
    }

    // createNotificationChannel is a no-op when the channel already exists.
    private fun ensureChannel(context: Context) {
        val channel = NotificationChannel(
            CHANNEL_ID, context.getString(R.string.reminder_channel_name), NotificationManager.IMPORTANCE_HIGH,
        ).apply { description = context.getString(R.string.reminder_channel_description) }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    // The data URI makes each PendingIntent distinct per reminder and alarm kind (extras alone do not).
    private fun receiverIntent(context: Context, id: String, kind: String) =
        Intent(context, ReminderReceiver::class.java).setData(reminderUri(id, kind)).putExtra(EXTRA_ID, id)

    private fun reminderUri(id: String, kind: String? = null): Uri = Uri.fromParts("sc26reminder", id, kind)
}

/**
 * Manifest-registered, so the alarm is delivered even after the app process has died;
 * everything needed to build the notification travels in the alarm's PendingIntent extras.
 */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Reminders.EXTRA_ID) ?: return
        Reminders.cancelAlarms(context, id)
        Reminders.show(
            context, id,
            intent.getStringExtra(Reminders.EXTRA_TITLE).orEmpty(),
            intent.getStringExtra(Reminders.EXTRA_TEXT).orEmpty(),
        )
    }
}
