package com.grape.launcher

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Chỉ cần được cấp "Quyền truy cập thông báo" để launcher đọc được bài đang phát.
 * Giữ tham chiếu để đọc thêm MediaSession từ thông báo phát nhạc (phòng khi app nhạc không hiện trong danh sách session),
 * và báo cho LauncherBridge (onEvent) khi dịch vụ kết nối/ngắt hoặc có thông báo phát nhạc thay đổi — thay cho việc hỏi liên tục.
 */
class MediaListenerService : NotificationListenerService() {
    companion object {
        @Volatile var instance: MediaListenerService? = null
        @Volatile var onEvent: (() -> Unit)? = null
    }

    private fun isMedia(sbn: StatusBarNotification?) =
        sbn?.notification?.extras?.containsKey(Notification.EXTRA_MEDIA_SESSION) == true

    override fun onListenerConnected() { instance = this; onEvent?.invoke() }
    override fun onListenerDisconnected() { if (instance === this) instance = null; onEvent?.invoke() }
    override fun onNotificationPosted(sbn: StatusBarNotification?) { if (isMedia(sbn)) onEvent?.invoke() }
    override fun onNotificationRemoved(sbn: StatusBarNotification?) { if (isMedia(sbn)) onEvent?.invoke() }
}
