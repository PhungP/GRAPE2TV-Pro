package com.grape.launcher

import android.app.Activity
import android.app.Notification
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.net.wifi.WifiManager
import android.view.KeyEvent
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import android.webkit.WebView

/**
 * Cầu nối JavaScript ⇄ Android. Tên trong JS: window.Android
 *
 * Hiệu năng: danh sách app, bài đang phát và trạng thái mạng đều được GIỮ ĐỆM và chỉ tính lại khi hệ thống báo thay đổi
 * (broadcast gói, MediaController.Callback, NetworkCallback). Giao diện chỉ đọc bản đệm nên các lệnh gọi lặp lại gần như miễn phí,
 * và Kotlin đẩy sự kiện lên JS (window.__mediaChanged / __netChanged / __appsChanged) thay vì để JS hỏi liên tục.
 */
class LauncherBridge(private val activity: Activity) {

    private val ctx: Context = activity.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val iconCache = HashMap<String, String>()
    private var downloadId = -1L
    @Volatile var webView: WebView? = null
    /** Launcher đang hiển thị? Khi ẩn thì không đẩy sự kiện lên JS; khi quay lại JS tự đồng bộ lại. */
    @Volatile var active = true
    /** Cầu nối với MainActivity (giám sát WebView). */
    @Volatile var onReady: (() -> Unit)? = null
    @Volatile var onRecover: ((String) -> Unit)? = null
    @Volatile var stateProvider: (() -> String)? = null
    @Volatile private var released = false
    // Luồng nền dùng chung (tối đa 2) thay cho việc tạo Thread mới mỗi lần; dọn khi release()
    private val io = Executors.newFixedThreadPool(2) { r -> Thread(r, "g2tv-io").apply { isDaemon = true } }
    private fun bg(block: () -> Unit) { try { io.execute { try { block() } catch (e: Throwable) { Diag.w("bg", "${e.javaClass.simpleName}: ${e.message}") } } } catch (_: RejectedExecutionException) {} }
    @Volatile private var appsGen = 0
    private val refreshPending = java.util.concurrent.atomic.AtomicBoolean(false)
    @Volatile private var artKey = ""
    @Volatile private var artB64 = ""
    @Volatile private var apkVerified = false
    @Volatile private var apkRejected = false
    @Volatile private var coversJson: String? = null
    @Volatile private var coversAt = 0L
    private val infoJson: String by lazy {
        val v = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName } catch (_: Exception) { "1.0.0" }
        JSONObject().put("versionName", v).put("packageName", ctx.packageName).toString()
    }

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
            if (id == downloadId && downloadId != -1L) bg {
                if (verifyApk()) { apkVerified = true; installApk() }
                else { apkRejected = true; apkFile().delete() }
            }
        }
    }

    // ---------- Giữ đệm danh sách ứng dụng ----------
    @Volatile private var appsJson: String? = null
    private val appsLock = Any()
    private val pkgReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            val pkg = intent?.data?.schemeSpecificPart
            synchronized(appsLock) { if (pkg != null) iconCache.remove(pkg); appsJson = null; appsGen++ }
            // gộp nhiều broadcast liên tiếp (cài nhiều app) thành một lần làm mới
            if (refreshPending.compareAndSet(false, true)) bg { Thread.sleep(400); refreshPending.set(false); getApps(); push("__appsChanged") }
        }
    }

    // ---------- Giữ đệm MediaSession ----------
    private val mediaLock = Any()
    @Volatile private var controllers: List<MediaController> = emptyList()
    private val callbacks = HashMap<MediaSession.Token, MediaController.Callback>()
    @Volatile private var needAccess = false
    @Volatile private var current: MediaController? = null
    @Volatile private var curMd: MediaMetadata? = null
    @Volatile private var curPs: PlaybackState? = null
    @Volatile private var nowJson = "{}"
    private var sessionListenerOn = false
    private var queueKey = ""
    private var queueJson = JSONArray()
    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { refreshMedia() }
    private val mediaCallback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) { rebuildNow() }
        override fun onPlaybackStateChanged(state: PlaybackState?) { rebuildNow() }
        override fun onQueueChanged(queue: MutableList<MediaSession.QueueItem>?) { queueKey = ""; rebuildNow() }
        override fun onSessionDestroyed() { refreshMedia() }
    }

    // ---------- Giữ đệm mạng ----------
    @Volatile private var netCb: ConnectivityManager.NetworkCallback? = null

    // đẩy sự kiện lên JS, gộp các lần gọi dồn dập
    private val pushed = HashSet<String>()
    private fun push(fn: String) {
        if (!active || released) return
        synchronized(pushed) { if (!pushed.add(fn)) return }
        main.postDelayed({
            synchronized(pushed) { pushed.remove(fn) }
            if (!released) try { webView?.evaluateJavascript("window.$fn && window.$fn()", null) } catch (_: Exception) {}
        }, 60)
    }

    init {
        ContextCompat.registerReceiver(
            ctx, downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED
        )
        val pf = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED); addAction(Intent.ACTION_PACKAGE_REMOVED); addAction(Intent.ACTION_PACKAGE_REPLACED)
            addDataScheme("package")
        }
        ContextCompat.registerReceiver(ctx, pkgReceiver, pf, ContextCompat.RECEIVER_EXPORTED)
        MediaListenerService.onEvent = { main.post { refreshMedia() } }
        bg { getApps() }      // làm nóng bản đệm để lần mở đầu không bị chậm
        main.post { refreshMedia(); watchNetwork() }
    }

    fun release() {
        released = true
        io.shutdownNow()
        try { ctx.unregisterReceiver(downloadReceiver) } catch (_: Exception) {}
        try { ctx.unregisterReceiver(pkgReceiver) } catch (_: Exception) {}
        MediaListenerService.onEvent = null
        main.removeCallbacksAndMessages(null)
        unwatchMedia()
        try { netCb?.let { (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(it) } } catch (_: Exception) {}
        netCb = null
    }

    /** Launcher quay lại phía trước: đọc lại phiên nhạc (đề phòng vừa cấp/thu hồi quyền) rồi để JS tự đồng bộ. */
    fun onResume() { active = true; refreshMedia() }
    fun onStop() { active = false }

    /** Hệ thống báo thiếu RAM: bỏ các bản đệm có thể dựng lại. */
    fun trim() { coversJson = null; artKey = ""; artB64 = "" }

    // ---------- Giám sát WebView (gọi từ JS) ----------

    /** React đã mount xong. Không gọi trong thời hạn → MainActivity coi là treo/màn hình đen và phục hồi. */
    @JavascriptInterface fun ready() { Diag.i("js", "ready"); onReady?.invoke() }

    /** Lỗi JS nghiêm trọng (ErrorBoundary / lỗi chưa bắt). Giới hạn tần suất để không làm tràn nhật ký. */
    private var lastErrAt = 0L
    @JavascriptInterface fun reportError(msg: String, fatal: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastErrAt > 2000) { lastErrAt = now; Diag.w("js-error", msg.take(240)) }
        if (fatal) onRecover?.invoke("js-fatal")
    }

    /** Người dùng bấm "Thử lại" ở màn hình lỗi của giao diện. */
    @JavascriptInterface fun recover() { onRecover?.invoke("user-retry") }

    @JavascriptInterface fun log(event: String, detail: String) { Diag.i("js:" + event.take(32), detail.take(160)) }

    @JavascriptInterface
    fun getDiagnostics(): String {
        val rt = Runtime.getRuntime()
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val mi = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val wvPkg = if (Build.VERSION.SDK_INT >= 26) try { WebView.getCurrentWebViewPackage()?.let { "${it.packageName} ${it.versionName}" } } catch (_: Exception) { null } else null
        return buildString {
            append("${stateProvider?.invoke() ?: "?"} active=$active needAccess=$needAccess\n")
            append("Heap ${(rt.totalMemory() - rt.freeMemory()) shr 20}/${rt.maxMemory() shr 20} MB • RAM trống ${mi.availMem shr 20} MB${if (mi.lowMemory) " (THẤP)" else ""}\n")
            append("WebView: ${wvPkg ?: "?"} • Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) • ${Build.MODEL}\n")
            append("— Sự kiện gần nhất —\n").append(Diag.dump(30))
        }
    }

    // ---------- Ứng dụng ----------

    @JavascriptInterface
    fun getApps(): String {
        appsJson?.let { return it }
        synchronized(appsLock) {
            appsJson?.let { return it }
            val gen = appsGen
            val pm = ctx.packageManager
            val found = LinkedHashMap<String, ResolveInfo>()
            for (cat in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
                val query = Intent(Intent.ACTION_MAIN).addCategory(cat)
                for (ri in pm.queryIntentActivities(query, 0)) {
                    val pkg = ri.activityInfo.packageName
                    if (pkg != ctx.packageName && !found.containsKey(pkg)) found[pkg] = ri
                }
            }
            // tính nhãn một lần (loadLabel khá tốn), rồi mới sắp xếp
            val labeled = found.values.map { it to it.loadLabel(pm).toString() }.sortedBy { it.second.lowercase() }
            val arr = JSONArray()
            for ((ri, label) in labeled) {
                val pkg = ri.activityInfo.packageName
                arr.put(JSONObject().apply {
                    put("name", label)
                    put("pkg", pkg)
                    put("icon", iconCache.getOrPut(pkg) { iconToBase64(ri) })
                })
            }
            return arr.toString().also { if (gen == appsGen) appsJson = it }   // nếu có gói đổi trong lúc dựng thì không lưu bản cũ
        }
    }

    private fun iconToBase64(ri: ResolveInfo): String = try {
        val d = ri.loadIcon(ctx.packageManager)
        val size = 160
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        d.setBounds(0, 0, size, size)
        d.draw(canvas)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (_: Exception) { "" }

    @JavascriptInterface
    fun launch(pkg: String): Boolean = launchWith(pkg, "")

    /** Mở app; nếu extra khác rỗng thì gửi kèm extra "grape_open" (vd "library") để app đích tự nhảy tới mục đó nếu hỗ trợ. */
    @JavascriptInterface
    fun launchWith(pkg: String, extra: String): Boolean {
        val pm = ctx.packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (extra.isNotEmpty()) intent.putExtra("grape_open", extra)
        return try { activity.runOnUiThread { activity.startActivity(intent) }; true } catch (_: Exception) { false }
    }

    /** Mở GRAPE2Play thẳng tới một album trong thư viện (extra: grape_open=library, grape_album_id, grape_album_title). */
    @JavascriptInterface
    fun openAlbum(id: String, title: String): Boolean {
        val pm = ctx.packageManager
        val pkg = "com.grape.play"
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("grape_open", "library")
        if (id.isNotEmpty()) intent.putExtra("grape_album_id", id)
        if (title.isNotEmpty()) intent.putExtra("grape_album_title", title)
        return try { activity.runOnUiThread { activity.startActivity(intent) }; true } catch (_: Exception) { false }
    }

    // ---------- Nhạc đang phát (MediaSession) ----------

    private fun queryControllers(): List<MediaController>? {
        val base = try {
            val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            msm.getActiveSessions(ComponentName(ctx, MediaListenerService::class.java))
        } catch (_: SecurityException) { return null }
        return (base + notificationControllers()).distinctBy { it.sessionToken }
    }

    /** Lấy thêm MediaSession từ các thông báo phát nhạc đang hiển thị. */
    @Suppress("DEPRECATION")
    private fun notificationControllers(): List<MediaController> {
        val svc = MediaListenerService.instance ?: return emptyList()
        return try {
            svc.activeNotifications.mapNotNull { sbn ->
                val token = sbn.notification.extras.getParcelable<MediaSession.Token>(Notification.EXTRA_MEDIA_SESSION)
                token?.let { MediaController(ctx, it) }
            }
        } catch (_: Exception) { emptyList() }
    }

    private fun pick(list: List<MediaController>): MediaController? =
        list.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: list.firstOrNull { it.packageName == "com.grape.play" }
            ?: list.firstOrNull { it.metadata != null }
            ?: list.firstOrNull()

    private fun unwatchMedia() {
        synchronized(mediaLock) {
            for (c in controllers) try { c.unregisterCallback(mediaCallback) } catch (_: Exception) {}
            callbacks.clear()
            controllers = emptyList()
            if (sessionListenerOn) {
                try { (ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager).removeOnActiveSessionsChangedListener(sessionsListener) } catch (_: Exception) {}
                sessionListenerOn = false
            }
        }
    }

    /** Hỏi hệ thống danh sách phiên nhạc (chỉ khi có sự kiện/khi quay lại), gắn callback, rồi dựng lại bản đệm. Chạy trên main thread. */
    private fun refreshMedia() {
        synchronized(mediaLock) {
            val list = queryControllers()
            if (list == null) {
                needAccess = true
                for (c in controllers) try { c.unregisterCallback(mediaCallback) } catch (_: Exception) {}
                controllers = emptyList(); current = null; curMd = null; curPs = null
            } else {
                needAccess = false
                val old = controllers.map { it.sessionToken }.toSet()
                val now = list.map { it.sessionToken }.toSet()
                for (c in controllers) if (c.sessionToken !in now) try { c.unregisterCallback(mediaCallback) } catch (_: Exception) {}
                for (c in list) if (c.sessionToken !in old) try { c.registerCallback(mediaCallback, main) } catch (_: Exception) {}
                controllers = list
                if (!sessionListenerOn) {
                    try {
                        (ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager)
                            .addOnActiveSessionsChangedListener(sessionsListener, ComponentName(ctx, MediaListenerService::class.java), main)
                        sessionListenerOn = true
                    } catch (_: SecurityException) {}
                }
            }
        }
        rebuildNow()
    }

    /** Dựng lại JSON "Đang phát" (không gồm vị trí). Chỉ báo JS khi nội dung thật sự đổi. */
    private fun rebuildNow() {
        val json: String
        synchronized(mediaLock) {
            if (needAccess) { current = null; curMd = null; curPs = null; json = JSONObject().put("needAccess", true).toString() }
            else {
                val c = pick(controllers)
                current = c
                if (c == null) { curMd = null; curPs = null; json = "{}" }
                else {
                    val md = c.metadata; val ps = c.playbackState
                    curMd = md; curPs = ps
                    json = JSONObject().apply {
                        put("title", md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: "")
                        put("artist", md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: "")
                        put("album", md?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "")
                        put("queue", upcoming(c, md, ps))
                        put("playing", ps?.state == PlaybackState.STATE_PLAYING)
                        put("duration", md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L)
                        put("pkg", c.packageName)
                    }.toString()
                }
            }
            if (json == nowJson) return
            nowJson = json
        }
        push("__mediaChanged")
    }

    @JavascriptInterface
    fun getNowPlaying(): String = nowJson

    /** Vị trí phát hiện tại, tính từ bản đệm PlaybackState (không gọi hệ thống). JS gọi mỗi giây để vẽ thanh tiến độ. */
    @JavascriptInterface
    fun getProgress(): String {
        val ps = curPs
        val playing = ps?.state == PlaybackState.STATE_PLAYING
        var pos = ps?.position ?: 0L
        if (pos < 0) pos = 0L
        if (playing && ps != null) pos += ((SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime) * ps.playbackSpeed).toLong()
        val dur = curMd?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
        return """{"position":${maxOf(0L, pos)},"duration":$dur,"playing":$playing}"""
    }

    /** Các bài tiếp theo trong hàng đợi (MediaSession queue). Chỉ đọc lại khi đổi bài/đổi hàng đợi. */
    private fun upcoming(c: MediaController, md: MediaMetadata?, ps: PlaybackState?): JSONArray {
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
        val key = c.packageName + "|" + title
        if (key == queueKey) return queueJson
        val arr = JSONArray()
        try {
            val q = c.queue
            if (q != null && q.isNotEmpty()) {
                val activeId = ps?.activeQueueItemId ?: -1L
                var idx = q.indexOfFirst { it.queueId == activeId }
                if (idx < 0) idx = q.indexOfFirst { it.description.title?.toString() == title }
                val from = if (idx >= 0) idx + 1 else 0
                for (k in from until minOf(q.size, from + 4)) {
                    val d = q[k].description
                    arr.put(JSONObject().put("title", d.title?.toString() ?: "").put("artist", d.subtitle?.toString() ?: ""))
                }
            }
        } catch (_: Exception) {}
        queueKey = key; queueJson = arr
        return arr
    }

    /** Gọi mạng cho giao diện (tránh CORS). Chỉ cho phép máy chủ trong danh sách trắng, chỉ https. */
    @JavascriptInterface
    fun fetchText(url: String, id: String) {
        val host = try { Uri.parse(url).host ?: "" } catch (_: Exception) { "" }
        if (!url.startsWith("https://") || host !in setOf("www.bing.com")) { reply(id, ""); return }
        bg {
            var out = ""
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 6000; c.readTimeout = 6000
                out = c.inputStream.bufferedReader().use { it.readText() }
            } catch (_: Exception) {}
            reply(id, out)
        }
    }

    private fun reply(id: String, text: String) {
        val js = "window.__cb && window.__cb(${JSONObject.quote(id)}, ${JSONObject.quote(text)})"
        if (!released) activity.runOnUiThread { try { webView?.evaluateJavascript(js, null) } catch (_: Exception) {} }
    }

    /** Ảnh bìa bài đang phát (JPEG base64, tối đa 256px). Rỗng nếu app nhạc không cung cấp. */
    @JavascriptInterface
    fun getArt(): String {
        val md = curMd ?: return ""
        val key = (current?.packageName ?: "") + "|" + (md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "")
        if (key == artKey) return artB64            // cùng bài: dùng lại, không giải mã/nén lại
        val b64 = try {
            val direct = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART) ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            if (direct != null) encodeThumb(direct, 85, owned = false)    // bitmap thuộc MediaMetadata: không được recycle
            else {
                val uri = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: md.getString(MediaMetadata.METADATA_KEY_ART_URI) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI)
                loadArtUri(uri)?.let { encodeThumb(it, 85, owned = true) } ?: ""
            }
        } catch (_: Throwable) { "" }              // gồm OutOfMemoryError: thiếu ảnh bìa tốt hơn là crash
        artKey = key; artB64 = b64
        return b64
    }

    /** Thu nhỏ còn tối đa 256px rồi nén JPEG → base64. owned=true: bitmap do ta tạo nên được giải phóng ngay. */
    private fun encodeThumb(bmp: Bitmap, quality: Int, owned: Boolean): String {
        val scale = 256f / maxOf(bmp.width, bmp.height)
        val small = if (scale < 1f) Bitmap.createScaledBitmap(bmp, maxOf(1, (bmp.width * scale).toInt()), maxOf(1, (bmp.height * scale).toInt()), true) else bmp
        val out = ByteArrayOutputStream()
        small.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (small !== bmp) small.recycle()
        if (owned) bmp.recycle()
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** Hệ số thu nhỏ khi giải mã (luỹ thừa 2) sao cho cạnh còn ≥ 256px: tránh giải mã ảnh bìa 3000×3000 đầy đủ chỉ để làm thumbnail. */
    private fun sampleFor(w: Int, h: Int): Int { var s = 1; while (w / (s * 2) >= 256 && h / (s * 2) >= 256) s *= 2; return s }

    private fun decodeBlob(blob: ByteArray): Bitmap? {
        val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(blob, 0, blob.size, o)
        if (o.outWidth <= 0) return null
        return android.graphics.BitmapFactory.decodeByteArray(blob, 0, blob.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sampleFor(o.outWidth, o.outHeight) })
    }

    private fun has(c: MediaController, a: Long) = ((c.playbackState?.actions ?: 0L) and a) != 0L

    private fun key(c: MediaController?, code: Int) {
        val down = KeyEvent(KeyEvent.ACTION_DOWN, code)
        val up = KeyEvent(KeyEvent.ACTION_UP, code)
        if (c != null) { c.dispatchMediaButtonEvent(down); c.dispatchMediaButtonEvent(up) }
        else { val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager; am.dispatchMediaKeyEvent(down); am.dispatchMediaKeyEvent(up) }
    }

    private fun seek(c: MediaController, delta: Long) {
        val ps = c.playbackState
        if (ps != null && has(c, PlaybackState.ACTION_SEEK_TO)) {
            var pos = ps.position.coerceAtLeast(0L)
            if (ps.state == PlaybackState.STATE_PLAYING) pos += ((SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime) * ps.playbackSpeed).toLong()
            c.transportControls.seekTo((pos + delta).coerceAtLeast(0L))
        } else key(c, if (delta < 0) KeyEvent.KEYCODE_MEDIA_REWIND else KeyEvent.KEYCODE_MEDIA_FAST_FORWARD)
    }

    /** Một số app chỉ cung cấp đường dẫn ảnh bìa (content:// hoặc file://) thay vì bitmap. */
    private fun loadArtUri(uri: String?): Bitmap? {
        if (uri.isNullOrEmpty() || !(uri.startsWith("content://") || uri.startsWith("file://"))) return null
        return try {
            val u = Uri.parse(uri)
            val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            ctx.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, o) }
            if (o.outWidth <= 0) null
            else ctx.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sampleFor(o.outWidth, o.outHeight) }) }
        } catch (_: Exception) { null }
    }

    @JavascriptInterface
    fun media(action: String) {
        val c = current
        if (c == null) { // không thấy phiên nhạc: gửi phím media tới app đang giữ nút media
            when (action) {
                "next" -> key(null, KeyEvent.KEYCODE_MEDIA_NEXT)
                "prev" -> key(null, KeyEvent.KEYCODE_MEDIA_PREVIOUS)
                "playpause" -> key(null, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
                "rew" -> key(null, KeyEvent.KEYCODE_MEDIA_REWIND)
                "fwd" -> key(null, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD)
            }
            return
        }
        val t = c.transportControls
        when (action) {
            "next" -> if (has(c, PlaybackState.ACTION_SKIP_TO_NEXT)) t.skipToNext() else key(c, KeyEvent.KEYCODE_MEDIA_NEXT)
            "prev" -> if (has(c, PlaybackState.ACTION_SKIP_TO_PREVIOUS)) t.skipToPrevious() else key(c, KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            "playpause" -> if (c.playbackState?.state == PlaybackState.STATE_PLAYING) t.pause() else t.play()
            "rew" -> seek(c, -10_000L)
            "fwd" -> seek(c, 10_000L)
        }
    }

    /** Báo cáo chi tiết từng phiên nhạc: dùng để biết app nhạc đã cung cấp những thông tin gì cho launcher. */
    @JavascriptInterface
    fun debugSessions(): String {
        val list = queryControllers() ?: return "Chưa cấp quyền truy cập thông báo cho GRAPE2TV Pro."
        val notif = MediaListenerService.instance?.let { "đã kết nối" } ?: "chưa kết nối"
        if (list.isEmpty()) return "Không thấy phiên nhạc nào (dịch vụ thông báo: $notif). Hãy phát nhạc trong GRAPE2Play rồi thử lại. Nếu vẫn trống: app nhạc chưa tạo MediaSession đang hoạt động."
        val sb = StringBuilder("Dịch vụ thông báo: $notif\n")
        for (c in list) {
            val md = c.metadata
            val ps = c.playbackState
            val st = when (ps?.state) { PlaybackState.STATE_PLAYING -> "đang phát"; PlaybackState.STATE_PAUSED -> "tạm dừng"; PlaybackState.STATE_BUFFERING -> "đang đệm"; null -> "KHÔNG có trạng thái"; else -> "khác (${ps?.state})" }
            fun yn(b: Boolean) = if (b) "có" else "KHÔNG"
            val dur = md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
            val hasArt = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) != null || md?.getBitmap(MediaMetadata.METADATA_KEY_ART) != null ||
                !(md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: md?.getString(MediaMetadata.METADATA_KEY_ART_URI)).isNullOrEmpty()
            val acts = ps?.actions ?: 0L
            sb.append("\n• ${c.packageName}\n")
            sb.append("  Trạng thái: $st\n")
            sb.append("  Tên bài: ${yn(!md?.getString(MediaMetadata.METADATA_KEY_TITLE).isNullOrEmpty())} | Nghệ sĩ: ${yn(!md?.getString(MediaMetadata.METADATA_KEY_ARTIST).isNullOrEmpty())} | Album: ${yn(!md?.getString(MediaMetadata.METADATA_KEY_ALBUM).isNullOrEmpty())}\n")
            sb.append("  Thời lượng: ${if (dur > 0) "${dur / 1000}s" else "KHÔNG có"} | Vị trí: ${yn(ps != null && ps.position >= 0)} | Ảnh bìa: ${yn(hasArt)}\n")
            sb.append("  Hàng đợi: ${c.queue?.size ?: 0} bài\n")
            sb.append("  Hỗ trợ: tiếp ${yn(acts and PlaybackState.ACTION_SKIP_TO_NEXT != 0L)}, trước ${yn(acts and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L)}, tua ${yn(acts and PlaybackState.ACTION_SEEK_TO != 0L)}\n")
        }
        return sb.toString()
    }

    // ---------- Mạng + thư viện ----------

    private fun watchNetwork() {
        if (Build.VERSION.SDK_INT < 24 || netCb != null) return   // API < 24: JS tự hỏi thưa (30 giây/lần)
        try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { push("__netChanged") }
                override fun onLost(network: Network) { push("__netChanged") }
                override fun onCapabilitiesChanged(network: Network, caps: android.net.NetworkCapabilities) { push("__netChanged") }
            }
            cm.registerDefaultNetworkCallback(cb, main)
            netCb = cb
        } catch (_: Exception) {}
    }

    @Suppress("DEPRECATION")
    @JavascriptInterface
    fun getNetwork(): String {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val info = cm.activeNetworkInfo
        if (info == null || !info.isConnected) return """{"type":"none","level":0}"""
        if (info.type == ConnectivityManager.TYPE_WIFI) {
            val rssi = try { (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo.rssi } catch (_: Exception) { -60 }
            val level = when { rssi > -55 -> 4; rssi > -65 -> 3; rssi > -75 -> 2; else -> 1 }
            return """{"type":"wifi","level":$level}"""
        }
        return """{"type":"ethernet","level":4}"""
    }

    /**
     * Bìa album từ thư viện GRAPE2Play. Cần GRAPE2Play cung cấp ContentProvider:
     *   content://com.grape.play.library/albums  — cột "cover" (BLOB JPEG/PNG nhỏ), sắp xếp tuỳ ý.
     * Chưa có provider → trả mảng rỗng, giao diện dùng bìa của các bài đã phát.
     */
    @JavascriptInterface
    fun getLibraryAlbums(): String {
        val nowMs = SystemClock.elapsedRealtime()
        coversJson?.let { if (nowMs - coversAt < 30_000) return it }
        val arr = JSONArray()
        val uri = Uri.parse("content://com.grape.play.library/albums")
        try {
            // Thử lấy thêm mã (_id) và tên album nếu GRAPE2Play cung cấp; nếu provider không có các cột đó thì chỉ lấy ảnh bìa
            val cursor = try { ctx.contentResolver.query(uri, arrayOf("cover", "_id", "title"), null, null, null) }
                catch (_: Exception) { ctx.contentResolver.query(uri, arrayOf("cover"), null, null, null) }
            cursor?.use { c ->
                val iId = c.getColumnIndex("_id"); val iTitle = c.getColumnIndex("title")
                while (c.moveToNext() && arr.length() < 12) {
                    val blob = c.getBlob(0) ?: continue
                    val bmp = decodeBlob(blob) ?: continue
                    arr.put(JSONObject().apply {
                        put("cover", encodeThumb(bmp, 82, owned = true))
                        if (iId >= 0) put("id", c.getString(iId) ?: "")
                        if (iTitle >= 0) put("title", c.getString(iTitle) ?: "")
                    })
                }
            }
        } catch (_: Throwable) { /* chưa có provider / không đọc được / thiếu RAM */ }
        return arr.toString().also { coversJson = it; coversAt = nowMs }
    }

    // ---------- Hệ thống ----------

    private fun startSafe(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { try { activity.startActivity(intent) } catch (_: Exception) {} }
    }

    // ---------- Launcher mặc định ----------

    /** GRAPE2TV Pro đang là màn hình chính (nút HOME) mặc định? */
    @JavascriptInterface
    fun isDefaultLauncher(): Boolean = try {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        ctx.packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName == ctx.packageName
    } catch (_: Exception) { false }

    /**
     * Android không cho app tự đặt mình làm mặc định; chỉ mở hộp thoại/màn hình hệ thống để người dùng xác nhận.
     * Thử lần lượt: hộp thoại vai trò HOME (Android 10+) → cài đặt "Ứng dụng màn hình chính" → cài đặt ứng dụng mặc định.
     * Trả về "role" | "settings" | "none" (không có màn hình nào: hướng dẫn thủ công ở phía giao diện).
     */
    @JavascriptInterface
    fun setDefaultLauncher(): String {
        if (Build.VERSION.SDK_INT >= 29) try {
            val rm = ctx.getSystemService(android.app.role.RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME)) {
                if (rm.isRoleHeld(android.app.role.RoleManager.ROLE_HOME)) return "role"
                val i = rm.createRequestRoleIntent(android.app.role.RoleManager.ROLE_HOME)
                activity.runOnUiThread { try { activity.startActivityForResult(i, 4711) } catch (_: Exception) {} }
                return "role"
            }
        } catch (_: Exception) {}
        for (action in listOf(Settings.ACTION_HOME_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) {
            val i = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (i.resolveActivity(ctx.packageManager) != null) { startSafe(i); return "settings" }
        }
        return "none"
    }

    @JavascriptInterface
    fun openNotificationAccess() = startSafe(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))

    @JavascriptInterface
    fun openWifiSettings() = startSafe(Intent(Settings.ACTION_WIFI_SETTINGS))

    @JavascriptInterface
    fun openSystemSettings() = startSafe(Intent(Settings.ACTION_SETTINGS))

    @JavascriptInterface
    fun getInfo(): String = infoJson

    // ---------- Cập nhật APK từ GitHub ----------

    private fun apkFile() = File(ctx.getExternalFilesDir(null), "update.apk")

    /** Chỉ nhận APK từ GitHub Releases của chính dự án này (https, đúng máy chủ và đường dẫn). */
    private fun allowedUpdateUrl(url: String): Boolean {
        val u = try { Uri.parse(url) } catch (_: Exception) { return false }
        val path = u.path ?: return false
        return u.scheme == "https" && u.host == "github.com" && path.endsWith(".apk") &&
            (path.startsWith("/PhungP/GRAPE2TV-Pro/releases/download/") || path.startsWith("/PhungP/grape2launcher/releases/download/"))
    }

    @JavascriptInterface
    fun downloadAndInstall(url: String) {
        if (!allowedUpdateUrl(url)) { Diag.w("ota", "url rejected"); return }
        apkVerified = false; apkRejected = false
        apkFile().delete()
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("GRAPE2TV Pro")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(ctx, null, "update.apk")
        downloadId = dm.enqueue(req)
        Diag.i("ota", "download started")
    }

    @JavascriptInterface
    fun getDownloadProgress(): Int {
        if (downloadId == -1L || apkRejected) return -1
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        dm.query(DownloadManager.Query().setFilterById(downloadId)).use { c ->
            if (!c.moveToFirst()) return -1
            return when (c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                DownloadManager.STATUS_SUCCESSFUL -> if (apkVerified) 100 else 99   // chỉ báo 100% sau khi đã xác minh APK
                DownloadManager.STATUS_FAILED -> -1
                else -> {
                    val got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    if (total > 0) minOf(99, (got * 100 / total).toInt()) else 0
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun signers(info: android.content.pm.PackageInfo): Set<String> =
        if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet() ?: emptySet()
        else info.signatures?.map { it.toCharsString() }?.toSet() ?: emptySet()

    /** Trước khi mở trình cài đặt: đúng gói, đúng chữ ký của bản đang cài và versionCode CAO HƠN (chặn hạ cấp). */
    @Suppress("DEPRECATION")
    private fun verifyApk(): Boolean = try {
        val pm = ctx.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val neu = pm.getPackageArchiveInfo(apkFile().path, flags)
        val cur = pm.getPackageInfo(ctx.packageName, flags)
        val newCode = if (neu == null) -1L else if (Build.VERSION.SDK_INT >= 28) neu.longVersionCode else neu.versionCode.toLong()
        val curCode = if (Build.VERSION.SDK_INT >= 28) cur.longVersionCode else cur.versionCode.toLong()
        val ok = neu != null && neu.packageName == ctx.packageName && newCode > curCode &&
            signers(neu).isNotEmpty() && signers(neu) == signers(cur)
        Diag.i("ota", "verify ok=$ok new=$newCode cur=$curCode")
        ok
    } catch (e: Exception) { Diag.w("ota", "verify error ${e.javaClass.simpleName}"); false }

    private fun installApk() {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            // Lần đầu: cho phép "cài ứng dụng không rõ nguồn" cho launcher rồi bấm cập nhật lại
            startSafe(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")))
            return
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apkFile())
        startSafe(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }
}
