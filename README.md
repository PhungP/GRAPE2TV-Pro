# GRAPE2TV Pro – Android TV Launcher

Launcher thay màn hình chính cho Android TV / TV box: đồng hồ, thời tiết Hải Phòng, Music Center "Đang phát" (đọc nhạc thật từ GRAPE2Play hoặc bất kỳ app nhạc nào), lưới ứng dụng thật trên TV, 2 giao diện Liquid Glass / Xperia, cập nhật APK từ GitHub Releases.

Định hướng: **nhẹ · mượt · nhanh · cao cấp** — ưu tiên TV box cấu hình thấp.

> Tên cũ: GRAPE2Launcher Lite. Gói ứng dụng (`com.grape.launcher`), khoá ký và dữ liệu người dùng giữ nguyên nên cài đè được lên bản cũ.

## Build
```bash
cd web && npm ci && npx tsc --noEmit && npm run build   # build giao diện vào app/src/main/assets/web
cd .. && ./gradlew assembleRelease                      # APK: app/build/outputs/apk/release/GRAPE2TV-Pro-<ver>-release*.apk
```
Ký bản phát hành: sao chép `keystore.properties.example` thành `keystore.properties` và điền thông tin khoá **hiện có** (file này và `*.keystore` nằm trong `.gitignore`). Phải dùng đúng một khoá cho mọi bản, nếu không TV sẽ không cho cài đè. Không có khoá → APK chưa ký (không cài/OTA được).
Bản release bật R8 + rút gọn tài nguyên (`app/proguard-rules.pro` giữ các phương thức `@JavascriptInterface`).

## Cài lên TV
- adb: `adb connect <IP-TV>:5555` rồi `adb install GRAPE2TV-Pro.apk`.
- Hoặc chép APK vào USB, mở bằng trình quản lý file (cho phép "cài từ nguồn không rõ").
- Đặt làm màn hình chính: nhấn HOME → chọn "GRAPE2TV Pro" → Luôn dùng. Một số TV (Google TV/Sony) không cho đổi launcher mặc định; khi đó mở từ danh sách ứng dụng.

## Cấp quyền hiển thị nhạc (Notification Access)
Trong launcher: Cài đặt → Hệ thống → **Cấp quyền hiển thị nhạc** → bật cho GRAPE2TV Pro. Cần để đọc bài đang phát và điều khiển Phát/Tạm dừng/Tiếp/Trước. Thu hồi quyền → Music Center báo cần cấp quyền; cấp lại là tự cập nhật.

## Điều khiển bằng remote
D-pad di chuyển giữa ô; OK mở/chọn; Back đóng Cài đặt/thoát chế độ sắp xếp/thoát bảo vệ màn hình; Home về trạng thái đầu. Sắp xếp ứng dụng: Cài đặt → Giao diện → Sắp xếp ứng dụng, OK để nhấc, mũi tên để di chuyển.

## Hiệu năng (v1.1.0)
- Danh sách app, icon, bài đang phát, hàng đợi và trạng thái mạng được **giữ đệm** và chỉ tính lại khi hệ thống báo (`MediaController.Callback`, `NetworkCallback`, broadcast cài/gỡ gói); Kotlin đẩy sự kiện lên giao diện thay vì giao diện hỏi 2 lần/giây.
- Launcher ẩn (đang ở app khác): dừng mọi bộ đếm/polling (`pauseTimers`), quay lại thì đồng bộ một lần.
- Đồng hồ, thanh tiến độ, Wi-Fi tách riêng — không render lại cả màn hình; ô ứng dụng dùng `React.memo`.
- CSS: bỏ `backdrop-filter` trên từng ô app, bỏ blob `filter: blur`, giảm blur panel, bỏ animation repaint. "Chuyển động nhẹ" tự bật mặc định trên thiết bị ≤2 GB RAM / ≤4 lõi.

## Cài đặt cần chỉnh nếu khác
`web/src/App.tsx` (đầu file): `GRAPE_PKG` (gói GRAPE2Play, mặc định com.grape.play), `REPO` (kho cập nhật: `PhungP/GRAPE2TV-Pro`). `app/build.gradle.kts`: `versionName` (versionCode tự suy ra: 1.1.1 → 10101).

## Phát hành & cập nhật online
- Kho: https://github.com/PhungP/GRAPE2TV-Pro (URL cũ `grape2launcher` được GitHub tự chuyển hướng).
- Quy ước: tag `vX.Y.Z`, tiêu đề `GRAPE2TV Pro X.Y.Z`, file `GRAPE2TV-Pro.apk` (đổi tên file build thành tên này khi đính vào Release). Nội dung `RELEASE_NOTES.md` hiện ở mục Cập nhật.
- `gh release create v1.1.1 GRAPE2TV-Pro.apk --title "GRAPE2TV Pro 1.1.1" --notes-file RELEASE_NOTES.md`
- Trước khi phát hành: `apksigner verify --print-certs` phải cho cùng chứng chỉ với bản đang chạy trên TV.
- Bìa album thư viện: GRAPE2Play cung cấp ContentProvider `content://com.grape.play.library/albums` (cột `cover`). Chưa có thì dùng bìa các bài đã phát.

## Tích hợp GRAPE2Play
Xem `GRAPE2Play_TichHop_Launcher.md`.
