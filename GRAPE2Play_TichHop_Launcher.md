# GRAPE2Play ⇄ GRAPE2TV Pro — những gì app cần cung cấp

Launcher **không đọc dữ liệu riêng của GRAPE2Play**. Nó chỉ dùng các kênh chuẩn của Android, nên GRAPE2Play phải "công khai" thông tin qua các kênh dưới đây. Mình chưa xem được mã nguồn GRAPE2Play (chưa có trong cuộc trò chuyện này), nên đây là bản đặc tả để bạn lập trình lại; sau khi làm, dùng **Cài đặt → Hệ thống → Kiểm tra nhạc** trên launcher để biết app đã cung cấp đủ chưa.

## 1. Bảng tóm tắt: hộp nào lấy dữ liệu từ đâu

| Hiển thị trên launcher | Kênh | GRAPE2Play phải làm |
|---|---|---|
| Tên bài, nghệ sĩ, album | `MediaSession` → `MediaMetadata` | Gán TITLE, ARTIST, ALBUM |
| Thanh tiến độ, thời gian | `MediaSession` → `PlaybackState` + `DURATION` | Cập nhật vị trí; gán DURATION |
| Trạng thái Đang phát / Tạm dừng | `PlaybackState.state` | PLAYING / PAUSED |
| Nút Trước / Phát / Tiếp | `PlaybackState.actions` | Khai báo SKIP_TO_NEXT, SKIP_TO_PREVIOUS, PLAY, PAUSE |
| Ảnh bìa trong hộp Đang phát | `MediaMetadata` ALBUM_ART (bitmap) hoặc ALBUM_ART_URI (`content://`) | Gán ảnh bìa |
| Ô **Tiếp theo** | `MediaSession.queue` (+ `activeQueueItemId`) | Công bố hàng đợi |
| Ô **Thư viện** (bìa album) | `ContentProvider` `content://com.grape.play.library/albums` | Thêm provider (mục 4) |
| Ô Thư viện → mở thẳng thư viện | Intent extra `grape_open=library` | Xử lý extra (mục 5) |

## 2. MediaSession (bắt buộc cho hộp Đang phát và Tiếp theo)

Nguyên nhân phổ biến khiến hộp Đang phát trống: app phát nhạc nhưng **không tạo MediaSession**, hoặc tạo mà chưa `isActive = true`, hoặc không có dịch vụ nền (foreground service) nên bị hệ thống ngắt.

### Cách A — Media3 (khuyên dùng, nếu app dùng ExoPlayer)
```kotlin
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val player = ExoPlayer.Builder(this).build()
        session = MediaSession.Builder(this, player).build()   // Media3 tự công bố state, vị trí, thời lượng, hàng đợi
    }
    override fun onGetSession(info: MediaSession.ControllerInfo) = session
    override fun onDestroy() { session?.run { player.release(); release() }; session = null; super.onDestroy() }
}
```
Khi nạp bài, **gắn đủ metadata vào MediaItem** (đây là chỗ launcher lấy chữ và ảnh):
```kotlin
val meta = MediaMetadata.Builder()
    .setTitle(track.title)
    .setArtist(track.artist)
    .setAlbumTitle(track.album)
    .setArtworkData(coverJpegBytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)   // hoặc .setArtworkUri(contentUri)
    .build()
val item = MediaItem.Builder().setUri(track.uri).setMediaMetadata(meta).build()
player.setMediaItems(queueItems, startIndex, 0L)   // nạp CẢ danh sách phát để ô "Tiếp theo" có dữ liệu
player.prepare(); player.play()
```
Lưu ý với nguồn SMB/WebDAV/UPnP/Drive: thời lượng chỉ biết sau khi `prepare()`. Nếu tệp không báo thời lượng thì thanh tiến độ không chạy; hãy đọc thời lượng từ thẻ tag và gán `MediaMetadata.Builder().setDurationMs(...)`.

### Cách B — MediaSessionCompat (nếu app tự quản lý player)
```kotlin
val session = MediaSessionCompat(this, "GRAPE2Play").apply {
    setCallback(object : MediaSessionCompat.Callback() { /* onPlay, onPause, onSkipToNext, onSkipToPrevious, onSeekTo */ })
    isActive = true
}
session.setMetadata(MediaMetadataCompat.Builder()
    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
    .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
    .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBitmap)
    .build())
session.setPlaybackState(PlaybackStateCompat.Builder()
    .setState(PlaybackStateCompat.STATE_PLAYING, positionMs, 1f)      // cập nhật khi play/pause/seek/đổi bài
    .setActions(PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or PlaybackStateCompat.ACTION_SEEK_TO)
    .setActiveQueueItemId(currentQueueId)
    .build())
session.setQueue(queue.mapIndexed { i, t ->
    MediaSessionCompat.QueueItem(MediaDescriptionCompat.Builder().setMediaId(t.id).setTitle(t.title).setSubtitle(t.artist).build(), i.toLong())
})
```
Chỉ cần gọi `setState(...)` khi có thay đổi (play, pause, tua, đổi bài); launcher tự tính vị trí đang chạy từ `position` + thời gian cập nhật + tốc độ.

### Dịch vụ nền (cả hai cách)
Phát nhạc trong **foreground service** có thông báo kiểu media, nếu không hệ thống sẽ ngắt khi người dùng về launcher:
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<service android:name=".PlaybackService" android:exported="true" android:foregroundServiceType="mediaPlayback">
    <intent-filter><action android:name="androidx.media3.session.MediaSessionService" /></intent-filter>
</service>
```

## 3. Hàng đợi cho ô "Tiếp theo"
Launcher lấy tối đa 4 bài **sau bài đang phát** trong `MediaSession.queue`. Với Media3, chỉ cần nạp cả danh sách bằng `setMediaItems(...)` (không nạp từng bài một). Với MediaSessionCompat dùng `setQueue(...)` và `setActiveQueueItemId(...)` như trên. Hàng đợi quá dài nên cắt khoảng 50–100 bài quanh bài hiện tại.

## 4. Thư viện: ContentProvider cung cấp bìa album
Launcher đọc `content://com.grape.play.library/albums`, cột `cover` (BLOB JPEG/PNG, **cạnh dài ≤ 256 px**), tối đa 12 dòng mới nhất/nổi bật.
```kotlin
class LibraryProvider : ContentProvider() {
    override fun onCreate() = true
    override fun query(uri: Uri, projection: Array<String>?, sel: String?, args: Array<String>?, order: String?): Cursor {
        val c = MatrixCursor(arrayOf("_id", "title", "artist", "cover"))
        // lấy từ cơ sở dữ liệu thư viện của GRAPE2Play: mỗi album 1 dòng, cover là JPEG nhỏ đã nén sẵn (nên lưu cache thumbnail)
        library.recentAlbums(limit = 12).forEach { c.addRow(arrayOf(it.id, it.title, it.artist, it.coverThumbJpeg)) }
        return c
    }
    override fun getType(uri: Uri) = "vnd.android.cursor.dir/vnd.grape.album"
    override fun insert(uri: Uri, v: ContentValues?) = null
    override fun delete(uri: Uri, s: String?, a: Array<String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<String>?) = 0
}
```
```xml
<provider android:name=".LibraryProvider" android:authorities="com.grape.play.library" android:exported="true" />
```
Provider chỉ đọc và chỉ trả về ảnh bìa nhỏ, nên để `exported="true"` là chấp nhận được. Nếu muốn chặt hơn, thêm `android:readPermission` loại signature và ký cả hai app bằng cùng một khoá.
Khi chưa có provider, ô Thư viện tự dùng bìa của các bài đã từng phát qua GRAPE2Play.

## 5. Mở thẳng thư viện từ ô Thư viện
Launcher mở GRAPE2Play với extra `grape_open = "library"`. Trong `MainActivity` của GRAPE2Play:
```kotlin
private fun handle(intent: Intent?) { if (intent?.getStringExtra("grape_open") == "library") navigateToLibrary() }
override fun onCreate(s: Bundle?) { super.onCreate(s); /* ... */ handle(intent) }
override fun onNewIntent(i: Intent) { super.onNewIntent(i); handle(i) }   // khi app đang chạy sẵn
```

## 6. Kiểm tra bằng launcher
Phát một bài trong GRAPE2Play → về launcher → **Cài đặt → Hệ thống → Kiểm tra nhạc**. Báo cáo mong đợi:
```
• com.grape.play
  Trạng thái: đang phát
  Tên bài: có | Nghệ sĩ: có | Album: có
  Thời lượng: 214s | Vị trí: có | Ảnh bìa: có
  Hàng đợi: 12 bài
  Hỗ trợ: tiếp có, trước có, tua có
```
Dòng nào ghi **KHÔNG** thì mục tương ứng ở bảng mục 1 sẽ trống. Nếu báo "Không thấy phiên nhạc nào" thì GRAPE2Play chưa tạo MediaSession đang hoạt động (mục 2).

## Chọn album từ ô Thư viện (GRAPE2TV Pro ≥ 1.2.0)
Con trỏ remote di chuyển giữa các bìa album trong ô Thư viện; bấm OK trên một bìa sẽ mở GRAPE2Play với các extra:
- `grape_open = "library"`
- `grape_album_id` — giá trị cột `_id` của album (nếu provider cung cấp)
- `grape_album_title` — giá trị cột `title` (nếu có)

ContentProvider `content://com.grape.play.library/albums` nên trả thêm cột `_id` và `title` (ngoài `cover`); nếu thiếu, launcher chỉ mở thư viện chung. GRAPE2Play cần đọc các extra trên để nhảy thẳng tới album.
