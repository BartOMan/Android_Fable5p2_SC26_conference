# SC26 Atlas: Android shell

Native wrapper for the offline web app in `app/web/www`. One activity, one WebView.
The web app is packaged as APK assets and served at
`https://appassets.androidplatform.net/assets/www/index.html`.

- Package: `io.github.bartoman.sc26atlas`, version 1.0.0, minSdk 26, target/compile SDK 35
- Toolchain: Gradle 9.9.1 (wrapper), Android Gradle Plugin 9.5.1 (built-in Kotlin 2.2.10), JDK 17
- Libraries: androidx core 1.16.0, activity 1.10.1, webkit 1.18.0, core-splashscreen 1.2.0

## Commands

Build, emulator, install and CDP attach (macOS, start in the repo root):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH
cd app/android

# 1. Build both APKs. The release APK is also copied to <repo>/dist/SC26-Atlas-v1.0.0.apk
./gradlew assembleDebug assembleRelease
ls -l app/build/outputs/apk/debug/app-debug.apk ../../dist/SC26-Atlas-v1.0.0.apk
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs ../../dist/SC26-Atlas-v1.0.0.apk

# 2. Create the test AVD if it is missing, boot it headless, wait until Android is up
avdmanager list avd | grep -q sc26test || echo no | avdmanager create avd -n sc26test -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_8
emulator -avd sc26test -no-window -no-audio -no-boot-anim -gpu host > /tmp/sc26-emulator.log 2>&1 &
adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done'

# 3. Install and launch the debug build, take a screenshot
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.github.bartoman.sc26atlas/.MainActivity
adb exec-out screencap -p > /tmp/sc26-screen.png

# 4. Attach to the WebView with Chrome DevTools Protocol (debug build only)
npm i --prefix /tmp/sc26build/pw playwright-core          # once; node_modules stays outside the repo
node tools/cdp-attach.mjs                                  # prints page title and URL
node tools/cdp-attach.mjs "AndroidBridge.appVersion()"     # evaluates a JS expression in the page

# 5. Smoke-test the whole app inside the WebView: every screen, share sheet, reminders, back, restart, airplane mode
node tools/emu-smoke.mjs                                   # screenshots go to /tmp/sc26build/shots/emu

# 6. Stop the emulator (the AVD is kept)
adb emu kill
```

## What the web app can rely on

| Thing | Contract |
| --- | --- |
| Assets | Everything in `app/web/www` is packaged on every build (nothing is copied into this project). MIME type comes from the file extension; a missing file returns 404. |
| `--sat`, `--sab` | CSS variables on `<html>`: top and bottom system bar inset in CSS px (for example `50.29px`). Set before first paint and updated on rotation. `--sab` is `0px` while the keyboard is open. |
| `window.__sc26Back()` | Called on the back button/gesture. Return `true` (or `"true"`) if the page handled it; anything else closes the app. |
| `window.__sc26Open(id)` | Called with the reminder id (string) after the user taps a reminder notification, once the page has loaded. |
| `window.AndroidBridge` | Exists only on pages of the asset origin. All methods accept strings or numbers and never throw. |

`AndroidBridge` methods:

| Method | Effect |
| --- | --- |
| `share(title, text)` | Share sheet with plain text. |
| `shareFile(filename, mimeType, content)` | Writes UTF-8 `content` to the cache dir and shares it as a file (for example `.ics`). |
| `addCalendarEvent(title, startMs, endMs, location, description)` | Opens the calendar app's "new event" screen. Times are epoch milliseconds. |
| `openExternal(url)` | Opens `http`, `https`, `mailto`, `tel`, `sms` or `geo` links in the system app. |
| `scheduleReminder(id, title, text, triggerAtMs)` | Local notification at about that time. Asks for notification permission if needed (Android 13+). Same `id` replaces the earlier reminder. |
| `cancelReminder(id)` | Removes the pending reminder and its notification. |
| `notificationsAllowed()` | `"true"` or `"false"`. |
| `appVersion()` | `"1.0.0"`. |
| `haptic()` | Short tick. |

## Files

| Path | Purpose |
| --- | --- |
| `app/build.gradle.kts` | App module: SDK levels, signing, assets from `app/web`, `dist/` copy task. |
| `app/src/main/AndroidManifest.xml` | Permissions, activity (`configChanges`), reminder receiver, FileProvider. |
| `app/src/main/kotlin/.../MainActivity.kt` | WebView setup, link handling, back, insets, splash, notification taps. |
| `app/src/main/kotlin/.../WebAssetHandler.kt` | Serves assets with MIME types. |
| `app/src/main/kotlin/.../AndroidBridge.kt` | `window.AndroidBridge`. |
| `app/src/main/kotlin/.../Reminders.kt` | Alarms, notification channel "Session reminders", receiver. |
| `app/src/main/res/` | Adaptive icon (vector), theme, splash, strings. |
| `tools/cdp-attach.mjs` | CDP attach script (see step 4). |
| `keystore/sc26atlas.jks` | Release key. Not in git. |

## Notes

- Release key: Gradle creates `keystore/sc26atlas.jks` (alias and passwords `sc26atlas`) when it is missing. Keep a backup. A new key cannot update an app installed with the old one.
- Debug and release builds are signed with different keys. To switch on a device: `adb uninstall io.github.bartoman.sc26atlas`, then install the other APK. This deletes the app's localStorage.
- Only `app/web/www` is packaged. Other entries in `app/web` (for example `tests/`) are left out of the APK.
- Reminders use inexact alarms (no exact-alarm permission). Measured on the API 35 emulator: on time when the device is awake, up to 75 % of the lead time late (1 hour at most) in Doze. Force-stopping the app or rebooting drops pending reminders.
- `env(safe-area-inset-*)` depends on the WebView version. On the emulator's WebView 124 it only reflects the display cutout and goes stale after rotation. Use `--sat` / `--sab`.
- A change of the system navigation mode or wallpaper colours recreates the activity, so the page reloads. Rotation, dark mode, font size and resize do not.
- WebView debugging (step 4) is on in debug builds only.

## Emulator rendering

Boot the emulator with `-gpu host`. With the software renderer
(`-gpu swiftshader_indirect`) the WebView shows stale tiles in the app's
scrolling screens: strips of earlier content stay on screen between cards. The
page layout is correct in that mode (checked through DevTools), and the
artifact disappears with host GPU rendering, so it is an emulator effect.

`tools/shell-test-page/` holds the small diagnostic page that was used to
verify the shell on its own (bridge calls, insets, local fetch). It is not
packaged into the app.
