package io.github.bartoman.sc26atlas

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: AndroidBridge
    private val documentStartSupported by lazy {
        WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    }

    private var pageLoaded = false
    private var insetsJs = ""
    private var insetsScript: ScriptHandler? = null
    private var pendingOpenId: String? = null // reminder id from a tapped notification, not yet given to the page

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* page polls notificationsAllowed() */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        // Must run before anything touches the decor view. On Android 15, a relaunch that reuses the
        // old window (recreate()) otherwise goes back to fitting the content between the system bars.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        // dark() = dark bars with light (white) icons, in both system light and dark mode.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        splash.setKeepOnScreenCondition { !pageLoaded }

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        val background = getColor(R.color.bg)
        webView = WebView(this).apply {
            setBackgroundColor(background) // no white flash before the first paint
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(background)
            addView(webView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        setContentView(root)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            textZoom = 100
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = false
        }

        bridge = AndroidBridge(this, webView)
        webView.addJavascriptInterface(bridge, AndroidBridge.NATIVE_NAME)
        if (documentStartSupported) {
            WebViewCompat.addDocumentStartJavaScript(webView, bridge.facadeJs, setOf(ASSET_ORIGIN))
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebAssetHandler(assets))
            .build()

        webView.webChromeClient = WebChromeClient() // enables alert()/confirm() dialogs
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.scheme == "https" && url.host == ASSET_HOST) return false // stays in the app
                // An embedded <iframe> may load remote content in place; only top-level navigation leaves.
                if (!request.isForMainFrame && (url.scheme == "http" || url.scheme == "https")) return false
                openExternal(url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                // Very old WebViews without document-start scripts: best effort, may run after page scripts.
                if (!documentStartSupported) view.evaluateJavascript(bridge.facadeJs, null)
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageLoaded = true
                if (!documentStartSupported) view.evaluateJavascript(bridge.facadeJs, null)
                view.evaluateJavascript(insetsJs, null)
                deliverPendingOpen()
            }

            // The renderer crashed or was killed for memory: rebuild the activity instead of dying with it.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        // Edge to edge: the page draws behind the status/navigation bars and pads itself with
        // --sat / --sab. Side insets (landscape nav bar, cutout) and the keyboard are padded natively.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            view.setPadding(bars.left, 0, bars.right, keyboard)
            val density = resources.displayMetrics.density
            setInsetVariables(bars.top / density, if (keyboard > 0) 0f else bars.bottom / density)
            // The WebView gets what is left, which is what env(safe-area-inset-*) is derived from.
            insets.inset(bars.left, 0, bars.right, keyboard)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                var answered = false
                webView.evaluateJavascript(BACK_JS) { handled ->
                    answered = true
                    if (handled != "true") finish()
                }
                // A hung page must not make the app impossible to leave.
                webView.postDelayed({ if (!answered) finish() }, 1500)
            }
        })

        if (savedInstanceState == null) handleIntent(intent)
        webView.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    /** Opens links in the browser / mail / maps app; anything that is not a plain link scheme is ignored. */
    fun openExternal(uri: Uri) {
        if (uri.scheme?.lowercase() !in EXTERNAL_SCHEMES) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: Exception) {
            Log.w(TAG, "No app can open $uri", e)
        }
    }

    fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    /** Publishes the top/bottom system bar insets (in CSS px) as --sat / --sab on <html>. */
    private fun setInsetVariables(top: Float, bottom: Float) {
        val js = "(function(){var s=document.documentElement.style;" +
            "s.setProperty('--sat','${px(top)}');s.setProperty('--sab','${px(bottom)}');})()"
        if (js == insetsJs) return
        insetsJs = js
        if (documentStartSupported) {
            // Also set them before the first paint of every future page load.
            insetsScript?.remove()
            insetsScript = WebViewCompat.addDocumentStartJavaScript(webView, js, setOf(ASSET_ORIGIN))
        }
        webView.evaluateJavascript(js, null)
    }

    private fun px(value: Float) = "${Math.round(value * 100) / 100.0}px" // e.g. "50.29px"

    private fun handleIntent(intent: Intent) {
        val id = intent.getStringExtra(Reminders.EXTRA_ID) ?: return
        intent.removeExtra(Reminders.EXTRA_ID)
        // Reopening the app from Recents replays the old notification intent; ignore that.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        pendingOpenId = id
        deliverPendingOpen()
    }

    /** Calls window.__sc26Open(id) once the page has loaded, retrying briefly until the page defines it. */
    private fun deliverPendingOpen(attempt: Int = 0) {
        val id = pendingOpenId ?: return
        if (!pageLoaded) return // onPageFinished calls this again
        val js = "(function(){if(typeof window.__sc26Open!=='function')return false;" +
            "try{window.__sc26Open(${JSONObject.quote(id)})}catch(e){console.error(e)}return true})()"
        webView.evaluateJavascript(js) { delivered ->
            if (delivered == "true") {
                if (pendingOpenId == id) pendingOpenId = null
            } else if (attempt < 40) { // up to ~10 s for a slow-starting page
                webView.postDelayed({ deliverPendingOpen(attempt + 1) }, 250)
            }
        }
    }

    private companion object {
        const val TAG = "SC26Atlas"
        const val ASSET_HOST = WebViewAssetLoader.DEFAULT_DOMAIN // appassets.androidplatform.net
        const val ASSET_ORIGIN = "https://$ASSET_HOST"
        const val START_URL = "$ASSET_ORIGIN/assets/www/index.html"
        const val BACK_JS = "(function(){try{var r=window.__sc26Back&&window.__sc26Back();" +
            "return r===true||r==='true'}catch(e){return false}})()"
        val EXTERNAL_SCHEMES = setOf("http", "https", "mailto", "tel", "sms", "geo")
    }
}
