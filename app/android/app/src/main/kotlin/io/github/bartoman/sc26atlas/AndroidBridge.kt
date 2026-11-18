package io.github.bartoman.sc26atlas

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.provider.CalendarContract
import android.util.Log
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/**
 * Native side of `window.AndroidBridge`.
 *
 * This object is injected with addJavascriptInterface under the private name [NATIVE_NAME], which
 * WebView exposes to every frame. Pages do not call it directly: [facadeJs] is injected at document
 * start into asset-origin frames only and defines `window.AndroidBridge`, a thin wrapper that
 *  - passes a per-process secret [token], so frames from any other origin cannot use the bridge, and
 *  - converts every argument with String(), because the WebView bridge would otherwise mangle large
 *    numbers such as epoch millis ("1.7319e+12") when coercing them to Java strings.
 *
 * @JavascriptInterface methods are called on a WebView background thread; all work is posted to the
 * main thread and exceptions are swallowed so bad input can never crash the app.
 */
class AndroidBridge(private val activity: MainActivity, private val webView: WebView) {

    private val token = UUID.randomUUID().toString()

    val facadeJs: String = """
        (function () {
          var n = window.$NATIVE_NAME, t = "$token";
          if (!n || window.AndroidBridge) return;
          function s(v) { return v == null ? "" : String(v); }
          window.AndroidBridge = {
            share: function (title, text) { n.share(t, s(title), s(text)); },
            shareFile: function (filename, mimeType, content) { n.shareFile(t, s(filename), s(mimeType), s(content)); },
            addCalendarEvent: function (title, startMs, endMs, location, description) {
              n.addCalendarEvent(t, s(title), s(startMs), s(endMs), s(location), s(description));
            },
            openExternal: function (url) { n.openExternal(t, s(url)); },
            scheduleReminder: function (id, title, text, triggerAtMs) {
              n.scheduleReminder(t, s(id), s(title), s(text), s(triggerAtMs));
            },
            cancelReminder: function (id) { n.cancelReminder(t, s(id)); },
            notificationsAllowed: function () { return n.notificationsAllowed(t); },
            appVersion: function () { return n.appVersion(t); },
            haptic: function () { n.haptic(t); }
          };
        })();
    """.trimIndent()

    @JavascriptInterface
    fun share(token: String?, title: String?, text: String?) = onMain(token) {
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, title.orEmpty())
            .putExtra(Intent.EXTRA_TITLE, title.orEmpty())
            .putExtra(Intent.EXTRA_TEXT, text.orEmpty())
        activity.startActivity(Intent.createChooser(send, null))
    }

    @JavascriptInterface
    fun shareFile(token: String?, filename: String?, mimeType: String?, content: String?) = onMain(token) {
        // Keep only a plain file name so the page cannot write outside <cache>/shared/.
        val name = File(filename.orEmpty()).name.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(80)
            .ifBlank { "export.txt" }
        val file = File(File(activity.cacheDir, "shared").apply { mkdirs() }, name)
        file.writeText(content.orEmpty(), Charsets.UTF_8)
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType(mimeType?.takeIf { '/' in it } ?: "text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(name, uri) // lets the chooser itself read the file for its preview
        activity.startActivity(Intent.createChooser(send, name))
    }

    @JavascriptInterface
    fun addCalendarEvent(
        token: String?, title: String?, startMs: String?, endMs: String?, location: String?, description: String?,
    ) = onMain(token) {
        val start = parseMillis(startMs) ?: return@onMain
        val end = parseMillis(endMs)?.takeIf { it > start } ?: (start + 60 * 60 * 1000L)
        activity.startActivity(
            Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
                .putExtra(CalendarContract.Events.TITLE, title.orEmpty())
                .putExtra(CalendarContract.Events.EVENT_LOCATION, location.orEmpty())
                .putExtra(CalendarContract.Events.DESCRIPTION, description.orEmpty()),
        )
    }

    @JavascriptInterface
    fun openExternal(token: String?, url: String?) = onMain(token) {
        activity.openExternal(Uri.parse(url.orEmpty()))
    }

    @JavascriptInterface
    fun scheduleReminder(token: String?, id: String?, title: String?, text: String?, triggerAtMs: String?) =
        onMain(token) {
            val triggerAt = parseMillis(triggerAtMs) ?: return@onMain
            if (id.isNullOrEmpty()) return@onMain
            Reminders.schedule(activity, id, title.orEmpty(), text.orEmpty(), triggerAt)
            activity.requestNotificationPermissionIfNeeded()
        }

    @JavascriptInterface
    fun cancelReminder(token: String?, id: String?) = onMain(token) {
        if (!id.isNullOrEmpty()) Reminders.cancel(activity, id)
    }

    @JavascriptInterface
    fun notificationsAllowed(token: String?): String = answer(token, "false") {
        Reminders.notificationsAllowed(activity).toString()
    }

    @JavascriptInterface
    fun appVersion(token: String?): String = answer(token, "") { BuildConfig.VERSION_NAME }

    @JavascriptInterface
    fun haptic(token: String?) = onMain(token) {
        webView.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
    }

    /** Runs [block] on the main thread if the caller knows the token. */
    private fun onMain(token: String?, block: () -> Unit) {
        if (token != this.token) return
        activity.runOnUiThread {
            try {
                block()
            } catch (e: Exception) { // e.g. no app can handle the intent
                Log.w(TAG, "Bridge call failed", e)
            }
        }
    }

    /** Runs [block] on the calling (bridge) thread and returns its result, or [fallback] on any failure. */
    private fun answer(token: String?, fallback: String, block: () -> String): String {
        if (token != this.token) return fallback
        return try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "Bridge call failed", e)
            fallback
        }
    }

    /** Epoch millis arrive as text: "1731900000000", "1731900000000.0" or "1.7319e12". */
    private fun parseMillis(value: String?): Long? =
        value?.trim()?.toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 }?.toLong()

    companion object {
        const val NATIVE_NAME = "__sc26Native"
        private const val TAG = "SC26Bridge"
    }
}
