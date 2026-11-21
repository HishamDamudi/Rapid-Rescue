# Fixing: `Cannot query the value of this provider because it has no value available` (`:jni:compileReleaseJavaWithJavac`)

```
Could not determine the dependencies of task ':jni:compileReleaseJavaWithJavac'.
> Cannot query the value of this provider because it has no value available.
```

**No project file needs to change.** The most likely cause is a missing Android **NDK**.

## Why it started happening

`jni` is a *native* (C/CMake) plugin. Your lockfile pulls it in indirectly through `shared_preferences_android 2.5.x` and
`url_launcher_android 6.3.x`, which recently moved to it. Your project had no native plugin before, so your SDK never needed an NDK.
`jni` declares `ndkVersion = flutter.ndkVersion`; when that exact NDK is not installed, Gradle reports this misleading error
instead of "NDK not found".

Evidence: the same error (on Windows, even on a brand-new app) is reported in `flutter/flutter#192111`, where the reporter's build
worked once the exact NDK version Flutter requested was installed. I could not reproduce it here (no Android SDK in my
environment), so this is a diagnosis from evidence, not a verified fix on your machine. Steps 1-3 will confirm it.

## Fix (about 5 minutes)

1. **Find the NDK version your Flutter wants** (Windows PowerShell):
   ```powershell
   Select-String -Path "C:\flutter\flutter\packages\flutter_tools\gradle\src\main\kotlin\FlutterExtension.kt" -Pattern "ndkVersion"
   ```
   On current Flutter stable this is `28.2.13676358`. Use whatever your file says (your `flutter.sdk` path is in `android/local.properties`).

2. **Install exactly that NDK + CMake.** Android Studio → *Settings → Languages & Frameworks → Android SDK → SDK Tools* →
   tick **Show Package Details** → *NDK (Side by side)* → select that exact version, and also *CMake*. Apply.
   Or from a terminal:
   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" --install "ndk;28.2.13676358" "cmake;3.22.1"
   ```

3. **Accept licences and clean:**
   ```powershell
   flutter doctor --android-licenses
   cd mobile_user
   flutter clean
   flutter pub get
   flutter build apk
   ```

4. **Make sure Gradle uses JDK 17** (Android Studio's bundled JDK is fine): `flutter doctor -v` should show a Java 17 line.
   If it points at something else: `flutter config --jdk-dir "<path to JDK 17>"`.

## If it still fails

Run `flutter build apk -v` and look for the **first** line containing `NDK`, `CMake`, or `licenses`; that line names the real
cause. (The `KGP` / `mobile_scanner` / `sensors_plus` text in your log is only a *warning* about a future Flutter change and is not
what is failing the build.)

I deliberately did **not** downgrade AGP/Gradle or pin plugin versions: those are riskier changes, and the evidence points to the SDK
setup rather than to your project files.


## jni / Gradle error fix (applied)
Tools set to AGP 8.11.1, Gradle 8.14, Kotlin 2.2.20 (settings.gradle.kts, gradle-wrapper.properties, gradle.properties, build.gradle.kts in both apps).
REQUIRED on your PC: install Android SDK Platform 35 and 36 (Android Studio > SDK Manager > SDK Platforms), then:
  flutter clean && flutter pub get && flutter run
Add --android-skip-build-dependency-validation to hide the "will soon be dropped" warnings.


## App code is now Java (no Kotlin in the app module)
`MainActivity` is `MainActivity.java` in both apps and the `kotlin { }` block is removed from `android/app/build.gradle.kts`.
Flutter plugins (mobile_scanner, sensors_plus, Flutter's own Gradle plugin) still contain Kotlin internally - that cannot be removed from an app's dependencies.
