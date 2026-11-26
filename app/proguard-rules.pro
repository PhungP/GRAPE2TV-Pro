# Cầu nối JS ⇄ Android: WebView gọi các phương thức này bằng reflection theo tên → không được đổi tên/loại bỏ
-keepattributes JavascriptInterface
-keepclassmembers class com.grape.launcher.LauncherBridge {
    @android.webkit.JavascriptInterface <methods>;
}
# Dịch vụ thông báo (khai báo trong manifest) và Activity chính
-keep class com.grape.launcher.MediaListenerService { *; }
-keep class com.grape.launcher.MainActivity { *; }
