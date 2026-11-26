import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Chỉ cần sửa versionName ở đây (hoặc truyền -PversionName=1.0.2); versionCode tự suy ra: 1.1.0 -> 10100
val appVersionName: String = (project.findProperty("versionName") as String?) ?: "1.1.0"
val appVersionCode: Int = appVersionName.split(".").map { it.toIntOrNull() ?: 0 }.let { (it.getOrElse(0) { 0 } * 10000) + (it.getOrElse(1) { 0 } * 100) + it.getOrElse(2) { 0 } }

// Tên file APK: GRAPE2TV-Pro-<phiên bản>-<loại>.apk
base.archivesName.set("GRAPE2TV-Pro-$appVersionName")

android {
    namespace = "com.grape.launcher"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.grape.launcher"
        minSdk = 21
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
    }

    // Khoá ký KHÔNG nằm trong git: đọc từ keystore.properties (đã .gitignore) hoặc biến môi trường.
    // Không có thông tin khoá → vẫn build được (APK chưa ký); dùng Build > Generate Signed App Bundle / APK để ký.
    val ksProps = Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    fun ks(key: String, env: String): String? = ksProps.getProperty(key) ?: System.getenv(env)
    val ksFile = ks("storeFile", "KEYSTORE_FILE")

    signingConfigs {
        if (ksFile != null) {
            create("release") {
                storeFile = rootProject.file(ksFile)
                storePassword = ks("storePassword", "KEYSTORE_PASSWORD")
                keyAlias = ks("keyAlias", "KEY_ALIAS")
                keyPassword = ks("keyPassword", "KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // R8 + rút gọn tài nguyên. Các phương thức @JavascriptInterface và dịch vụ thông báo được giữ lại trong proguard-rules.pro
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (ksFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.core:core-ktx:1.13.1")
}
