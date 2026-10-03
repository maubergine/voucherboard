import groovy.json.JsonSlurper
import javax.inject.Inject
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app's store id. Change it here only; `namespace` below is just the Kotlin package and can stay.
val appId = "uk.co.voucherboard.app"
// Same version as the extension, so error reports line up.
val extVersion = (JsonSlurper().parse(file("../../../manifest.json")) as Map<*, *>)["version"] as String

android {
    namespace = "uk.co.voucherboard.app"
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
    core.from(listOf("zones", "planner", "portal", "terms", "model", "reminders").map { "../../../src/$it.js" })
    council.from("../../council/council.js", "../../../src/buyfill.js")
    outputDir.set(layout.buildDirectory.dir("generated/vbAssets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(webAssets, AssembleWebAssets::outputDir)
    }
}
