import groovy.json.JsonSlurper
import javax.inject.Inject
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app's store id: reverse DNS of mariusrubin.com, the owner's domain, matching the iOS bundle id. It can't change
// once the app is on Google Play. `namespace` below is the Kotlin package.
val appId = "com.mariusrubin.voucherboard"
// Same version as the extension, so error reports line up.
val extVersion = (JsonSlurper().parse(file("../../../manifest.json")) as Map<*, *>)["version"] as String

android {
    namespace = "com.mariusrubin.voucherboard"
    compileSdk = 35

    defaultConfig {
        applicationId = appId
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = extVersion
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")

    // Number plate scanning (mobile/BRIDGE.md). The bundled Latin model ships in the APK, so nothing is downloaded.
    implementation("com.google.mlkit:text-recognition:16.0.1")
    val camerax = "1.4.2"
    implementation("androidx.camera:camera-core:$camerax")
    implementation("androidx.camera:camera-camera2:$camerax")
    implementation("androidx.camera:camera-lifecycle:$camerax")
    implementation("androidx.camera:camera-view:$camerax")
    implementation("androidx.camera:camera-mlkit-vision:$camerax")
}

// Copies the shared web code into a generated assets dir (see mobile/BRIDGE.md), so nothing is duplicated in git.
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
    www.from("../../www")
    core.from(listOf("zones", "planner", "portal", "terms", "model", "reminders", "plates").map { "../../../src/$it.js" })
    council.from("../../council/council.js", "../../../src/buyfill.js")
    outputDir.set(layout.buildDirectory.dir("generated/vbAssets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(webAssets, AssembleWebAssets::outputDir)
    }
}
