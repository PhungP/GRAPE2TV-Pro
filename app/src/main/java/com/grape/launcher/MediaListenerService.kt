package com.grape.launcher

import android.service.notification.NotificationListenerService

/**
 * Chỉ cần được cấp "Quyền truy cập thông báo" để launcher đọc được bài đang phát.
 * Giữ tham chiếu để đọc thêm MediaSession từ thông báo phát nhạc (phòng khi app nhạc không hiện trong danh sách session).
 */
class MediaListenerService : NotificationListenerService() {
    companion object { @Volatile var instance: MediaListenerService? = null }

    override fun onListenerConnected() { instance = this }
    override fun onListenerDisconnected() { if (instance === this) instance = null }
}
