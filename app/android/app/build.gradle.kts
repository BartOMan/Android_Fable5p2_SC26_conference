import com.android.build.api.artifact.SingleArtifact

plugins {
    id("com.android.application")
}

val appVersionName = "1.0.0"
val keystoreFile = rootProject.file("keystore/sc26atlas.jks")
val webDir = rootProject.file("../web") // <repo>/app/web

android {
    namespace = "io.github.bartoman.sc26atlas"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.bartoman.sc26atlas"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = appVersionName
    }

    signingConfigs {
        create("release") {
            storeFile = keystoreFile
            storePassword = "sc26atlas"
            keyAlias = "sc26atlas"
            keyPassword = "sc26atlas"
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The web app lives outside this Gradle project in <repo>/app/web/www. Adding <repo>/app/web as
    // an assets dir packages it as assets "www/..." straight from the source tree, so every build
    // picks up its current contents. (DropWebSiblings below keeps the rest of app/web out of the APK.)
    sourceSets {
        getByName("main") {
            assets.directories.add(webDir.path)
        }
    }

    // AGP's default pattern also drops directories starting with "_" (e.g. "_app", "_assets"),
    // which web bundlers like to emit. Keep everything except VCS/OS junk and dot-files.
    androidResources {
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

dependencies {
    // Newest releases that still accept compileSdk 35 (core 1.17+ and activity 1.11+ need compileSdk 36).
    implementation("androidx.core:core:1.16.0")
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.core:core-splashscreen:1.2.0")
}

// Release signing: create the keystore on first use so `./gradlew assembleRelease` works on a clean checkout.
val generateReleaseKeystore = tasks.register<Exec>("generateReleaseKeystore") {
    description = "Creates keystore/sc26atlas.jks with keytool if it does not exist."
    val keystore = keystoreFile
    onlyIf { !keystore.exists() }
    doFirst { keystore.parentFile.mkdirs() }
    commandLine(
        "${System.getProperty("java.home")}/bin/keytool", "-genkeypair", "-noprompt",
        "-keystore", keystore.absolutePath, "-alias", "sc26atlas",
        "-storepass", "sc26atlas", "-keypass", "sc26atlas",
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
        "-dname", "CN=SC26 Atlas, O=bartoman, C=US",
    )
}
tasks.matching { it.name == "validateSigningRelease" }.configureEach {
    dependsOn(generateReleaseKeystore)
}

// Only app/web/www belongs in the APK. Whatever else sits next to it in app/web (tests, tooling,
// node_modules) is removed from the merged assets before packaging.
abstract class DropWebSiblings : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val mergedAssets: DirectoryProperty

    @get:Input
    abstract val siblings: ListProperty<String>

    @get:OutputDirectory
    abstract val filteredAssets: DirectoryProperty

    @get:Inject
    abstract val files: FileSystemOperations

    @TaskAction
    fun run() {
        files.sync {
            from(mergedAssets)
            into(filteredAssets)
            siblings.get().forEach { exclude(it, "$it/**") }
        }
    }
}

// Copies the one signed APK out of the build folder to a single target file. A plain Copy task
// would claim its whole destination folder as output, and the destination here is the
// repository root, which holds the project itself.
abstract class PublishApk : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val apkDir: DirectoryProperty

    @get:OutputFile
    abstract val target: RegularFileProperty

    @TaskAction
    fun run() {
        val apks = apkDir.get().asFile.listFiles { f -> f.isFile && f.extension == "apk" }.orEmpty()
        check(apks.size == 1) { "expected exactly one APK in ${apkDir.get().asFile}, found ${apks.size}" }
        apks.single().copyTo(target.get().asFile, overwrite = true)
    }
}

androidComponents {
    onVariants { variant ->
        val drop = tasks.register<DropWebSiblings>("drop${variant.name.replaceFirstChar(Char::uppercase)}WebSiblings") {
            siblings.set(webDir.list().orEmpty().filter { it != "www" }.sorted())
        }
        variant.artifacts.use(drop)
            .wiredWithDirectories(DropWebSiblings::mergedAssets, DropWebSiblings::filteredAssets)
            .toTransform(SingleArtifact.ASSETS)
    }

    // After assembleRelease, copy the signed APK to the top of the repository as
    // SC26-Atlas-v<version>.apk, where it shows on the repository's main page.
    onVariants(selector().withBuildType("release")) { variant ->
        val apkName = "SC26-Atlas-v$appVersionName.apk"
        tasks.register<PublishApk>("distReleaseApk") {
            description = "Copies the signed release APK to the top of the repository."
            apkDir.set(variant.artifacts.get(SingleArtifact.APK))
            target.set(rootProject.layout.projectDirectory.file("../../$apkName"))
        }
    }
}
tasks.matching { it.name == "assembleRelease" }.configureEach {
    finalizedBy("distReleaseApk")
}
