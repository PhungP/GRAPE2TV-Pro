package com.grape.launcher

import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader

/**
 * Activity chứa đúng MỘT WebView và giám sát sức khoẻ của nó:
 *
 *   INITIALIZING → READY            (giao diện React gọi Android.ready() sau khi mount)
 *   READY/INITIALIZING → RECOVERING → INITIALIZING   (renderer chết, trang lỗi, treo, không mount được)
 *   … → FAILED                      (phục hồi thất bại ≥ MAX_ATTEMPTS lần trong WINDOW_MS: hiện màn hình lỗi, bấm OK để thử lại)
 *
 * Không bao giờ có 2 WebView cùng lúc; không tải lại vô hạn; không để màn hình đen vô thời hạn.
 */
class MainActivity : android.app.Activity() {

    private enum class State { INITIALIZING, READY, RECOVERING, FAILED }

    private companion object {
        const val URL = "https://appassets.androidplatform.net/assets/web/index.html"
        const val HOST = "appassets.androidplatform.net"
        const val STARTUP_TIMEOUT_MS = 15_000L   // sau ngần này mà giao diện chưa báo ready → phục hồi
        const val HEALTH_TIMEOUT_MS = 5_000L     // kiểm tra sau khi quay lại: WebView không trả lời → phục hồi
        const val MAX_ATTEMPTS = 3
        const val WINDOW_MS = 120_000L
    }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var root: FrameLayout
    private lateinit var bridge: LauncherBridge
    private lateinit var loader: WebViewAssetLoader
    private var webView: WebView? = null
    private var fallback: TextView? = null
    private var state = State.INITIALIZING
    private val attempts = ArrayDeque<Long>()
    private var healthToken = 0
    private var destroyed = false
    private val watchdog = Runnable { if (state == State.INITIALIZING) recover("startup-timeout") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Diag.init(this)
        Diag.i("lifecycle", "onCreate")
        applyImmersive()
        root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#101014")) }
        setContentView(root)
        loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        bridge = LauncherBridge(this).also {
            it.onReady = { main.post { markReady() } }
            it.onRecover = { why -> main.post { recover(why) } }
            it.stateProvider = { "state=$state attempts=${attempts.size}" }
        }
        createWebView()
    }

    private fun applyImmersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
    }

    // ---------- WebView: tạo / huỷ / phục hồi ----------

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        if (destroyed || webView != null) return
        state = State.INITIALIZING
        try {
            val wv = WebView(this).apply {
                setBackgroundColor(Color.parseColor("#101014"))
                isFocusable = true
                isFocusableInTouchMode = true
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true      // localStorage lưu cài đặt
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mediaPlaybackRequiresUserGesture = true
                overScrollMode = View.OVER_SCROLL_NEVER
                isVerticalScrollBarEnabled = false
                addJavascriptInterface(bridge, "Android")
                webViewClient = client
            }
            webView = wv
            bridge.webView = wv
            root.addView(wv, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            wv.requestFocus()
            Diag.i("webview", "created, loading")
            main.removeCallbacks(watchdog)
            main.postDelayed(watchdog, STARTUP_TIMEOUT_MS)
            wv.loadUrl(URL)
        } catch (e: Throwable) {   // thiếu/đang cập nhật gói WebView…
            Diag.w("webview", "create failed: ${e.javaClass.simpleName}: ${e.message}")
            webView = null; bridge.webView = null
            fail("Không khởi tạo được WebView (${e.javaClass.simpleName}).")
        }
    }

    private fun destroyWebView() {
        main.removeCallbacks(watchdog)
        healthToken++
        val wv = webView ?: return
        webView = null
        bridge.webView = null
        try { wv.stopLoading(); wv.removeJavascriptInterface("Android"); root.removeView(wv); wv.destroy() }
        catch (e: Throwable) { Diag.w("webview", "destroy failed: ${e.message}") }
    }

    private fun markReady() {
        if (destroyed || webView == null) return
        main.removeCallbacks(watchdog)
        if (state != State.READY) Diag.i("state", "READY")
        state = State.READY
    }

    /** Phục hồi có kiểm soát: huỷ WebView hỏng, tạo cái mới. Quá MAX_ATTEMPTS lần trong WINDOW_MS → màn hình lỗi (không lặp vô hạn). */
    private fun recover(reason: String) {
        if (destroyed || state == State.RECOVERING || state == State.FAILED) return
        val now = System.currentTimeMillis()
        while (attempts.isNotEmpty() && now - attempts.first() > WINDOW_MS) attempts.removeFirst()
        Diag.w("recover", "reason=$reason attempts=${attempts.size}")
        if (attempts.size >= MAX_ATTEMPTS) { destroyWebView(); fail("Giao diện không phục hồi được ($reason)."); return }
        attempts.addLast(now)
        state = State.RECOVERING
        destroyWebView()
        main.postDelayed({ state = State.INITIALIZING; createWebView() }, 400L * attempts.size)
    }

    private fun fail(msg: String) {
        state = State.FAILED
        Diag.w("state", "FAILED: $msg")
        fallback?.let { root.removeView(it) }
        fallback = TextView(this).apply {
            setTextColor(Color.parseColor("#F4F2F8")); textSize = 20f; gravity = Gravity.CENTER
            setPadding(80, 40, 80, 40)
            text = "GRAPE2TV Pro\n\n$msg\n\nBấm OK để thử lại.\n\n" + Diag.dump(8)
            isFocusable = true
        }
        root.addView(fallback, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        fallback?.requestFocus()
    }

    private fun retryFromFailed() {
        fallback?.let { root.removeView(it) }; fallback = null
        attempts.clear()
        Diag.i("recover", "manual retry")
        createWebView()
    }

    private val client = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            loader.shouldInterceptRequest(request.url)

        // Chỉ cho phép trang nội bộ của launcher; chặn mọi điều hướng ra ngoài
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.host != HOST
        @Deprecated("API < 24")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = !url.startsWith("https://$HOST/")

        override fun onPageFinished(view: WebView, url: String?) { if (view === webView) Diag.i("webview", "page finished") }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (view === webView && request.isForMainFrame) main.post { recover("main-frame-error") }
        }

        // Renderer bị hệ thống kill/crash: PHẢI trả true, nếu không cả tiến trình app bị giết rồi khởi động lại (màn hình đen)
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Diag.w("webview", "renderer gone crash=${detail.didCrash()} view=${if (view === webView) "current" else "stale"}")
            if (view === webView) main.post { recover("renderer-gone") }
            return true
        }
    }

    // ---------- Vòng đời ----------

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Nhấn nút HOME khi đang ở launcher: về trạng thái đầu, đóng hộp thoại
        webView?.evaluateJavascript("window.__onBack && window.__onBack()", null)
        webView?.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        Diag.i("lifecycle", "onResume state=$state")
        bridge.onResume()
        webView?.let { wv ->
            wv.onResume()
            // báo JS: đang hiển thị → đồng bộ lại ứng dụng/nhạc/mạng rồi chạy lại các bộ đếm
            wv.evaluateJavascript("window.__setActive && window.__setActive(true)", null)
            wv.requestFocus()
        }
        if (state == State.READY) healthCheck()
    }

    /** Sau khi quay lại (standby/wake, từ app khác): hỏi JS một câu đơn giản. Không trả lời hoặc React không còn gắn → phục hồi. */
    private fun healthCheck() {
        val wv = webView ?: return
        val token = ++healthToken
        wv.evaluateJavascript("(function(){var r=document.getElementById('root');return (window.__alive&&r&&r.childElementCount>0)?1:0})()") { v ->
            if (token == healthToken) { healthToken++; if (v != "1") recover("health:$v") }
        }
        main.postDelayed({ if (token == healthToken) { healthToken++; recover("health-timeout") } }, HEALTH_TIMEOUT_MS)
    }

    override fun onPause() {
        Diag.i("lifecycle", "onPause")
        webView?.onPause()
        super.onPause()
    }

    override fun onStop() {
        // Launcher không còn hiển thị (sang app khác, TV standby): dừng đẩy sự kiện và dừng bộ đếm trong JS
        Diag.i("lifecycle", "onStop")
        bridge.onStop()
        webView?.evaluateJavascript("window.__setActive && window.__setActive(false)", null)
        super.onStop()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) { applyImmersive(); webView?.requestFocus() }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) { Diag.w("memory", "trim level=$level"); bridge.trim() }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (state == State.FAILED) {
            if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) { retryFromFailed(); return true }
            if (keyCode == KeyEvent.KEYCODE_BACK) return true
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Back: đóng Cài đặt nếu đang mở; launcher thì không thoát ra ngoài
            webView?.evaluateJavascript("window.__onBack && window.__onBack()", null)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        Diag.i("lifecycle", "onDestroy")
        destroyed = true
        main.removeCallbacksAndMessages(null)
        bridge.release()
        destroyWebView()
        super.onDestroy()
    }
}
