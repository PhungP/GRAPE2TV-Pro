package com.grape.launcher

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : android.app.Activity() {

    private lateinit var webView: WebView
    private lateinit var bridge: LauncherBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        bridge = LauncherBridge(this)
        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0A0D1D"))
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true      // localStorage lưu cài đặt
            settings.allowFileAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            addJavascriptInterface(bridge, "Android")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
            loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        }
        bridge.webView = webView
        setContentView(webView)
        webView.requestFocus()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // Nhấn nút HOME khi đang ở launcher: về trạng thái đầu, đóng hộp thoại
        webView.evaluateJavascript("window.__onBack && window.__onBack()", null)
        webView.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.requestFocus()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Back: đóng Cài đặt nếu đang mở; launcher thì không thoát ra ngoài
            webView.evaluateJavascript("window.__onBack && window.__onBack()", null)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        bridge.release()
        webView.destroy()
        super.onDestroy()
    }
}
