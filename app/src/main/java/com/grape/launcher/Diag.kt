package com.grape.launcher

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Nhật ký chẩn đoán nhẹ: giữ N dòng gần nhất trong RAM (không ghi đĩa, không có dữ liệu nhạy cảm) để xem lại khi launcher
 * bị đơ / màn hình đen (Cài đặt → Hệ thống → Chẩn đoán). Chỉ ghi các SỰ KIỆN (đổi trạng thái, lỗi, phục hồi), không ghi theo chu kỳ.
 * Bản release chỉ đẩy ra Logcat các sự kiện cảnh báo (w); bản debug đẩy tất cả.
 */
object Diag {
    private const val TAG = "G2TV"
    private const val MAX = 150
    private val buf = ArrayDeque<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)
    @Volatile private var debuggable = false

    fun init(ctx: Context) { debuggable = (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0 }

    @Synchronized private fun add(level: String, event: String, detail: String) {
        val line = "${fmt.format(Date())} $level $event${if (detail.isEmpty()) "" else " — $detail"}"
        if (buf.size >= MAX) buf.removeFirst()
        buf.addLast(line)
    }

    fun i(event: String, detail: String = "") { add("I", event, detail); if (debuggable) Log.i(TAG, "$event $detail") }
    fun w(event: String, detail: String = "") { add("W", event, detail); Log.w(TAG, "$event $detail") }

    @Synchronized fun dump(last: Int = 40): String = buf.toList().takeLast(last).joinToString("\n")
}
