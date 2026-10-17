import groovy.json.JsonSlurper
import javax.inject.Inject

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// The app's store id: reverse DNS of mariusrubin.com, the owner's domain, matching the iOS bundle id. It can't change
// once the app is on Google Play. `namespace` below is the Kotlin package.
val appId = "com.mariusrubin.voucherboard"
// Same version as the extension and the iOS app, so error reports line up.
val extVersion = (JsonSlurper().parse(file("../../../../extension/manifest.json")) as Map<*, *>)["version"] as String
// CI passes the run number (-PvbVersionCode=), as iOS uses it for the build number. Local builds are 1.
val vbVersionCode = (findProperty("vbVersionCode") as String?)?.toInt() ?: 1

android {
    namespace = "com.mariusrubin.voucherboard"
    compileSdk = 37

    defaultConfig {
        applicationId = appId
        minSdk = 26
        // Google Play's target API level requirement (docs/GOOGLE_PLAY.md, "What expires").
        targetSdk = 36
        versionCode = vbVersionCode
        versionName = extVersion
    }

    // Release builds are signed only in CI, with the upload key from the google-play environment
    // (.github/workflows/android.yml). Locally, release builds are unsigned; the key never lives in the repo.
    val keystore = System.getenv("VB_UPLOAD_KEYSTORE")
    if (!keystore.isNullOrEmpty()) {
        signingConfigs.create("upload") {
            storeFile = file(keystore)
            storePassword = System.getenv("VB_UPLOAD_STORE_PASSWORD")
            keyAlias = System.getenv("VB_UPLOAD_KEY_ALIAS")
            keyPassword = System.getenv("VB_UPLOAD_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!keystore.isNullOrEmpty()) signingConfig = signingConfigs.getByName("upload")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    // The screens: Compose over the shared engine, mirroring the iOS app's SwiftUI (see README.md).
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Number plate scanning (apps/mobile/BRIDGE.md). The bundled Latin model ships in the APK, so nothing is downloaded.
    implementation("com.google.mlkit:text-recognition:16.0.1")
    val camerax = "1.6.2"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")
    implementation("androidx.camera:camera-mlkit-vision:$camerax")
}

// Copies the shared web code into a generated assets dir (see apps/mobile/BRIDGE.md), so nothing is duplicated in git.
// The core list is the same as the iOS copy script in apps/mobile/ios/project.yml; test/shells.test.js checks they match.
abstract class AssembleWebAssets : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) abstract val www: ConfigurableFileCollection
    @get:InputFiles @get:PathSensitive(PathSensitivity.NAME_ONLY) abstract val core: ConfigurableFileCollection
    @get:InputFiles @get:PathSensitive(PathSensitivity.NAME_ONLY) abstract val council: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val fs: FileSystemOperations

    @TaskAction
    fun run() {
        val missing = (www.files + core.files + council.files).filterNot { it.exists() }
        if (missing.isNotEmpty()) throw GradleException("Web assets missing: " + missing.joinToString())
        fs.sync {
            into(outputDir.get().asFile)
            from(www) { into("www") }
            from(core) { into("www/core") }
            from(council) { into("council") }
        }
    }
}

val webAssets = tasks.register<AssembleWebAssets>("assembleWebAssets") {
    www.from(fileTree("../../www") { exclude(".gitignore", "core/**") })
    core.from(listOf("zones", "planner", "portal", "terms", "model", "reminders", "plates").map { "../../../../extension/src/$it.js" })
    council.from("../../council/council.js", "../../../../extension/src/buyfill.js")
    outputDir.set(layout.buildDirectory.dir("generated/vbAssets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(webAssets, AssembleWebAssets::outputDir)
    }
}
