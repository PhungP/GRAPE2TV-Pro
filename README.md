# GRAPE2Launcher Lite — Android TV

Launcher thay màn hình chính cho Android TV / TV box: đồng hồ, thời tiết Hải Phòng, dải "Đang phát" (đọc nhạc thật từ GRAPE2Play hoặc bất kỳ app nhạc nào), lưới ứng dụng thật trên TV, 2 giao diện Liquid Glass / Xperia, cập nhật APK từ GitHub Releases.

## Build APK (Android Studio)
Mở thư mục này bằng Android Studio → **Build > Generate Signed App Bundle / APK > APK** → chọn file khoá của bạn (release) → build. Nếu sửa giao diện web: `cd web && npm install && npm run build` trước (đã build sẵn trong `app/src/main/assets/web`).
Muốn `./gradlew assembleRelease` tự ký: sao chép `keystore.properties.example` thành `keystore.properties` và điền thông tin khoá (file này và `*.keystore` đã nằm trong `.gitignore`, không đưa lên git).

## Cài lên TV
- Qua USB / adb: `adb connect <IP-TV>:5555` rồi `adb install app-release.apk`.
- Hoặc chép APK vào USB, mở bằng trình quản lý file trên TV (cho phép "cài từ nguồn không rõ").
- Đặt làm màn hình chính: nhấn HOME → chọn "GRAPE2Launcher" → Luôn dùng. Một số TV (Google TV/Sony) không cho đổi launcher mặc định; khi đó mở app từ danh sách ứng dụng.
- Trong launcher: Cài đặt → **Cấp quyền hiển thị nhạc** → bật cho GRAPE2Launcher (để đọc bài đang phát và điều khiển Phát/Tiếp).

## Chỗ cần sửa nếu khác với bạn
`web/src/App.tsx` (đầu file): `GRAPE_PKG` (gói app GRAPE2Play, mặc định com.grape.play) và `REPO` (kho GitHub kiểm tra cập nhật, mặc định PhungP/grape2launcher). Sau khi sửa: `cd web && npm run build`.
`app/build.gradle.kts`: `applicationId`, `versionCode`, `versionName`. Khoá ký: giữ nguyên MỘT khoá cho mọi bản để cài đè được; file khoá không nằm trong git, hãy sao lưu riêng.

## Ghi chú
- Cài đặt → "Cỡ biểu tượng ứng dụng": Nhỏ / Vừa / Lớn.
- Ô "Thư viện âm nhạc" mở GRAPE2Play kèm extra `grape_open=library` (app đích tự nhảy tới thư viện nếu hỗ trợ extra này).
- Kho cập nhật: https://github.com/PhungP/grape2launcher (Releases, đính file .apk).

## Phiên bản & cập nhật online
- Phiên bản hiện tại: **1.0.2**. `versionName` nằm trong `app/build.gradle.kts` (và `DEFAULT_VERSION` trong `web/src/App.tsx`); `versionCode` tự suy ra (1.0.2 → 10002).
- Đưa lên GitHub: đẩy code, rồi `gh release create v1.0.2 <file.apk> --notes-file RELEASE_NOTES.md`, đính APK vào Release kèm nội dung `RELEASE_NOTES.md` (launcher hiển thị nội dung này ở mục Cập nhật).
- Trên TV: Cài đặt → Cập nhật → Kiểm tra; chỉ báo có bản mới khi tag trên GitHub **lớn hơn** bản đang cài.
- Bìa album thư viện: GRAPE2Play cần cung cấp ContentProvider `content://com.grape.play.library/albums` (cột `cover` = ảnh JPEG/PNG). Chưa có thì ô Thư viện dùng bìa của các bài đã phát.
