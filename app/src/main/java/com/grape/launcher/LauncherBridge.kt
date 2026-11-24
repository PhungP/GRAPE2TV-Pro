package com.grape.launcher

import android.app.Activity
import android.app.Notification
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.ConnectivityManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.view.KeyEvent
import android.media.AudioManager
import android.os.Build
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

/** Cầu nối JavaScript ⇄ Android. Tên trong JS: window.Android */
class LauncherBridge(private val activity: Activity) {

    private val ctx: Context = activity.applicationContext
    private val iconCache = HashMap<String, String>()
    private var downloadId = -1L

    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
            if (id == downloadId && downloadId != -1L) installApk()
        }
    }

    init {
        ContextCompat.registerReceiver(
            ctx, downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED
        )
    }

    fun release() {
        try { ctx.unregisterReceiver(downloadReceiver) } catch (_: Exception) {}
    }

    // ---------- Ứng dụng ----------

    @JavascriptInterface
    fun getApps(): String {
        val pm = ctx.packageManager
        val found = LinkedHashMap<String, ResolveInfo>()
        for (cat in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val query = Intent(Intent.ACTION_MAIN).addCategory(cat)
            for (ri in pm.queryIntentActivities(query, 0)) {
                val pkg = ri.activityInfo.packageName
                if (pkg != ctx.packageName && !found.containsKey(pkg)) found[pkg] = ri
            }
        }
        val sorted = found.values.sortedBy { it.loadLabel(pm).toString().lowercase() }
        val arr = JSONArray()
        for (ri in sorted) {
            val pkg = ri.activityInfo.packageName
            arr.put(JSONObject().apply {
                put("name", ri.loadLabel(pm).toString())
                put("pkg", pkg)
                put("icon", iconCache.getOrPut(pkg) { iconToBase64(ri) })
            })
        }
        return arr.toString()
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

    // ---------- Nhạc đang phát (MediaSession) ----------

    private fun controllers(): List<MediaController>? {
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

    @JavascriptInterface
    fun getNowPlaying(): String {
        val list = controllers() ?: return JSONObject().put("needAccess", true).toString()
        val c = pick(list) ?: return "{}"
        val md = c.metadata
        val ps = c.playbackState
        val playing = ps?.state == PlaybackState.STATE_PLAYING
        var pos = ps?.position ?: 0L
        if (pos < 0) pos = 0L
        if (playing && ps != null) pos += ((SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime) * ps.playbackSpeed).toLong()
        return JSONObject().apply {
            put("title", md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: "")
            put("artist", md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: "")
            put("playing", playing)
            put("position", maxOf(0L, pos))
            put("duration", md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L)
            put("pkg", c.packageName)
        }.toString()
    }

    /** Ảnh bìa bài đang phát (JPEG base64, tối đa 256px). Rỗng nếu app nhạc không cung cấp. */
    @JavascriptInterface
    fun getArt(): String = try {
        val c = controllers()?.let { pick(it) }
        val md = c?.metadata
        val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        if (bmp == null) "" else {
            val scale = 256f / maxOf(bmp.width, bmp.height)
            val small = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
            val out = ByteArrayOutputStream()
            small.compress(Bitmap.CompressFormat.JPEG, 85, out)
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
    } catch (_: Exception) { "" }

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

    @JavascriptInterface
    fun media(action: String) {
        val c = controllers()?.let { pick(it) }
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

    /** Liệt kê phiên nhạc tìm thấy — dùng để chẩn đoán khi hộp Đang phát không hiện. */
    @JavascriptInterface
    fun debugSessions(): String {
        val list = controllers() ?: return "Chưa cấp quyền truy cập thông báo cho GRAPE2Launcher."
        if (list.isEmpty()) return "Không thấy phiên nhạc nào. Hãy phát nhạc rồi thử lại (thông báo nghe nhạc: ${MediaListenerService.instance?.let { "đã kết nối" } ?: "chưa kết nối"})."
        return list.joinToString(" | ") { c ->
            val st = when (c.playbackState?.state) { PlaybackState.STATE_PLAYING -> "đang phát"; PlaybackState.STATE_PAUSED -> "tạm dừng"; null -> "không có trạng thái"; else -> "khác" }
            "${c.packageName}: $st, " + (c.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "không có tên bài")
        }
    }

    // ---------- Mạng + thư viện ----------

    @Suppress("DEPRECATION")
    @JavascriptInterface
    fun getNetwork(): String {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val info = cm.activeNetworkInfo
        if (info == null || !info.isConnected) return """{"type":"none","level":0}"""
        if (info.type == ConnectivityManager.TYPE_WIFI) {
            val rssi = try { (ctx.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo.rssi } catch (_: Exception) { -60 }
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
    fun getLibraryCovers(): String {
        val arr = JSONArray()
        try {
            ctx.contentResolver.query(Uri.parse("content://com.grape.play.library/albums"), arrayOf("cover"), null, null, null)?.use { c ->
                while (c.moveToNext() && arr.length() < 12) {
                    val blob = c.getBlob(0) ?: continue
                    val bmp = android.graphics.BitmapFactory.decodeByteArray(blob, 0, blob.size) ?: continue
                    val scale = 256f / maxOf(bmp.width, bmp.height)
                    val small = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
                    val out = ByteArrayOutputStream()
                    small.compress(Bitmap.CompressFormat.JPEG, 82, out)
                    arr.put(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                }
            }
        } catch (_: Exception) { /* chưa có provider / không đọc được */ }
        return arr.toString()
    }

    // ---------- Hệ thống ----------

    private fun startSafe(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.runOnUiThread { try { activity.startActivity(intent) } catch (_: Exception) {} }
    }

    @JavascriptInterface
    fun openNotificationAccess() = startSafe(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))

    @JavascriptInterface
    fun openWifiSettings() = startSafe(Intent(Settings.ACTION_WIFI_SETTINGS))

    @JavascriptInterface
    fun openSystemSettings() = startSafe(Intent(Settings.ACTION_SETTINGS))

    @JavascriptInterface
    fun getInfo(): String {
        val v = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName } catch (_: Exception) { "1.0.0" }
        return JSONObject().put("versionName", v).put("packageName", ctx.packageName).toString()
    }

    // ---------- Cập nhật APK từ GitHub ----------

    private fun apkFile() = File(ctx.getExternalFilesDir(null), "update.apk")

    @JavascriptInterface
    fun downloadAndInstall(url: String) {
        // Chỉ nhận liên kết https của GitHub Releases
        if (!url.startsWith("https://github.com/")) return
        apkFile().delete()
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("GRAPE2Launcher")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(ctx, null, "update.apk")
        downloadId = dm.enqueue(req)
    }

    @JavascriptInterface
    fun getDownloadProgress(): Int {
        if (downloadId == -1L) return -1
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        dm.query(DownloadManager.Query().setFilterById(downloadId)).use { c ->
            if (!c.moveToFirst()) return -1
            return when (c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))) {
                DownloadManager.STATUS_SUCCESSFUL -> 100
                DownloadManager.STATUS_FAILED -> -1
                else -> {
                    val got = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    if (total > 0) minOf(99, (got * 100 / total).toInt()) else 0
                }
            }
        }
    }

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
