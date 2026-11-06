#!/usr/bin/env bash
# Builds Voucherboard's components on a Mac, and runs the phone apps in a simulator or emulator. See docs/DEVELOPING.md.
set -euo pipefail

VB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$VB/build" # everything else: Xcode build data, staging, logs
XCODE_APP="${VB_XCODE:-/Applications/Xcode.app}"
IOS_DEVICE="${VB_IOS_DEVICE:-}"
AVD="${VB_AVD:-vb36}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
VERBOSE=0
BUILD_ONLY=0
OPEN=0

usage() {
  cat <<EOF
Usage: scripts/dev.sh [options] <command>...

Commands:
  test       Run the tests (npm test).
  chrome     Package the Chrome zips into dist/. Load extension/ unpacked for development.
  firefox    Package the Firefox zip into dist/, and stage build/firefox (load its manifest.json in about:debugging).
  safari     Build the Safari app (ad hoc signed) into build/safari. --open launches it; without it, the build is
             unregistered so an installed copy keeps the extension.
  ios        Build the iOS app for the Simulator, then boot, install and launch it.
  android    Build the Android debug APK, then start the emulator, install and launch it. Offers to install what's missing.
  all        test, chrome, firefox, safari, and ios and android with --build-only.

Options:
  --build-only   ios, android: build without starting a simulator or emulator.
  --open         safari: open the built app afterwards.
  -v, --verbose  Show full xcodebuild and Gradle output.
  -h, --help     Show this help.

Environment:
  VB_XCODE       Xcode to use (default /Applications/Xcode.app). DEVELOPER_DIR is always set from it.
  VB_IOS_DEVICE  Simulator name or UDID (default: a booted iPhone, else the first available one).
  VB_AVD         Android emulator (default vb36).
  ANDROID_HOME   Android SDK (default ~/Library/Android/sdk).
  VB_JDK         JDK 21 for Gradle (default: the first JDK 21 java_home lists that isn't GraalVM).
  VB_CUTOUT      android: the emulator's camera cut-out: none (default), device (the AVD's own, e.g. the Pixel 8's
                 punch hole), or a simulated hole, corner, tall or double.
  VB_AVD_IMAGE   System image for a new emulator (default: API 36, or 36.1 for vb361, Google APIs).

android asks before installing anything it's missing: Temurin 21 and the SDK's command-line tools (with Homebrew),
and the emulator, its system image and the AVD (with sdkmanager and avdmanager). Without a terminal it never installs.
Before starting the emulator, it turns on typing with the Mac's keyboard (hw.keyboard=yes in the AVD's config.ini).
EOF
}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found. $2"; }

# Every Xcode step uses this Xcode, whatever xcode-select points at (often the Command Line Tools).
xcode() {
  [[ -d "$XCODE_APP/Contents/Developer" ]] || die "Xcode not found at $XCODE_APP. Set VB_XCODE."
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
  need xcodegen "Install it with: brew install xcodegen"
}

# xcodebuild, quiet unless -v; the log is kept in build/ either way.
xcb() {
  local log="$1"; shift
  mkdir -p "$BUILD"
  if ((VERBOSE)); then xcodebuild "$@" | tee "$log"
  else xcodebuild -quiet "$@" >"$log" 2>&1 || { grep -E 'error:' "$log" >&2 || tail -30 "$log" >&2; die "Build failed. Log: $log"; }
  fi
}

cmd_test() { say "Tests"; (cd "$VB" && npm test); }

cmd_chrome() {
  say "Chrome"
  (cd "$VB" && node scripts/package.mjs)
  echo "For development, load $VB/extension unpacked in chrome://extensions."
}

cmd_firefox() {
  say "Firefox"
  (cd "$VB" && node scripts/package-firefox.mjs && node scripts/package-firefox.mjs --dir build/firefox)
  echo "Load $BUILD/firefox/manifest.json in about:debugging > This Firefox > Load Temporary Add-on."
}

cmd_safari() {
  say "Safari"
  xcode
  (cd "$VB/apps/safari" && xcodegen generate --quiet)
  xcb "$BUILD/safari-build.log" build -project "$VB/apps/safari/Voucherboard.xcodeproj" -scheme Voucherboard \
    -configuration Release -destination 'generic/platform=macOS' -derivedDataPath "$BUILD/safari"
  local app="$BUILD/safari/Build/Products/Release/Voucherboard for Safari.app"
  echo "Built $app"
  if ((OPEN)); then
    echo "Safari needs Settings > Developer > Allow unsigned extensions (see docs/DEVELOPING.md)."
    open "$app"
  else
    safari_unregister "$app"
  fi
}

# The build registers its extension under the same id as an installed copy, and Safari then can't find a signed one
# ("Safari's settings didn't open"). Unregister the build, and hand the id back to /Applications if it's there.
safari_unregister() {
  local lsr=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  local installed="/Applications/Voucherboard for Safari.app" appex="Contents/PlugIns/Voucherboard Extension.appex"
  pluginkit -r "$1/$appex" 2>/dev/null || true
  "$lsr" -u "$1" 2>/dev/null || true
  if [[ -d "$installed" ]]; then
    "$lsr" -f "$installed"
    pluginkit -a "$installed/$appex"
    echo "Unregistered the build; Safari uses $installed. Use --open to try the build in Safari."
  else
    echo "Unregistered the build. Use --open to try it in Safari."
  fi
}

# A booted iPhone, else the first available one, unless VB_IOS_DEVICE names one.
ios_device() {
  local list; list="$(xcrun simctl list devices available)"
  if [[ -n "$IOS_DEVICE" ]]; then
    grep -F "$IOS_DEVICE" <<<"$list" | grep -oE '[0-9A-F-]{36}' | head -1
  else
    { grep -E 'iPhone.*\(Booted\)' <<<"$list" || grep -E 'iPhone' <<<"$list"; } | grep -oE '[0-9A-F-]{36}' | head -1
  fi
}

cmd_ios() {
  say "iOS"
  xcode
  (cd "$VB/apps/mobile/ios" && xcodegen generate --quiet)
  xcb "$BUILD/ios-build.log" build -project "$VB/apps/mobile/ios/Voucherboard.xcodeproj" -scheme Voucherboard \
    -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$BUILD/ios" \
    CODE_SIGNING_ALLOWED=NO
  local app="$BUILD/ios/Build/Products/Debug-iphonesimulator/Voucherboard.app"
  echo "Built $app"
  ((BUILD_ONLY)) && return
  local udid; udid="$(ios_device)"
  [[ -n "$udid" ]] || die "No iPhone simulator found${IOS_DEVICE:+ matching $IOS_DEVICE}. Add one in Xcode."
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  local id; id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")"
  xcrun simctl launch "$udid" "$id" >/dev/null
  echo "Running $id on simulator $udid. View it in Xcode's Device Hub."
}

# Asks before installing anything; the answer is no unless the user types y. Without a terminal, it's always no.
ask() {
  [[ -t 0 && -r /dev/tty ]] || return 1
  local a; printf '%s [y/N] ' "$1" >&2; read -r a </dev/tty || return 1
  [[ "$a" == [yY] || "$a" == [yY][eE][sS] ]]
}

# A JDK 21 for Gradle, not GraalVM: its jlink can't make the JDK image the Android Gradle plugin compiles against
# (core-for-system-modules.jar). VB_JDK wins; otherwise the first other JDK 21 java_home lists.
android_jdk() {
  local jh="${VB_JDK:-}"
  [[ -n "$jh" ]] || jh="$(/usr/libexec/java_home -V 2>&1 | awk '$1 ~ /^21\./ && !/GraalVM/ { print $NF; exit }')"
  if [[ -z "$jh" && -z "${VB_JDK:-}" ]]; then
    local why="JDK 21 not found (GraalVM doesn't work for Android builds)."
    command -v brew >/dev/null 2>&1 || die "$why Install Temurin 21 (https://adoptium.net), or set VB_JDK."
    ask "$why Install Temurin 21 with Homebrew (brew install --cask temurin@21)? macOS asks for your password." \
      || die "$why Install one, e.g. brew install --cask temurin@21, or set VB_JDK."
    brew install --cask temurin@21
    jh="$(/usr/libexec/java_home -V 2>&1 | awk '$1 ~ /^21\./ && !/GraalVM/ { print $NF; exit }')"
  fi
  [[ -n "$jh" && -x "$jh/bin/jlink" ]] || die "No usable JDK 21 at ${jh:-(none)}. Set VB_JDK to one that isn't GraalVM."
  export JAVA_HOME="$jh"
}

# The SDK's command-line tools (sdkmanager, avdmanager): the SDK's own, else Homebrew's, which can install into
# ANDROID_HOME. Offers to install them, and to accept the SDK licences Gradle needs, if there's no SDK yet.
android_tools() {
  SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  [[ -x "$SDKMANAGER" ]] || SDKMANAGER="$(command -v sdkmanager || true)"
  if [[ -z "$SDKMANAGER" ]]; then
    local why="The Android SDK's command-line tools aren't installed."
    command -v brew >/dev/null 2>&1 || die "$why Install Android Studio, or the command-line tools, into $ANDROID_HOME."
    ask "$why Install them with Homebrew (brew install --cask android-commandlinetools), for an SDK in $ANDROID_HOME?" \
      || die "$why Install Android Studio, or: brew install --cask android-commandlinetools"
    brew install --cask android-commandlinetools
    SDKMANAGER="$(command -v sdkmanager)" || die "sdkmanager still not found."
  fi
  AVDMANAGER="$(dirname "$SDKMANAGER")/avdmanager"
  if [[ ! -d "$ANDROID_HOME/licenses" ]]; then
    ask "Gradle needs the Android SDK licences accepted, and downloads the SDK parts it's missing into $ANDROID_HOME. Review the licences now?" \
      || die "Accept the licences first: $SDKMANAGER --sdk_root=$ANDROID_HOME --licenses"
    mkdir -p "$ANDROID_HOME"
    "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses
  fi
}

# The emulator, the system image and the AVD named VB_AVD, installed (after asking) if any is missing. vb361 is
# Android 16 QPR1 (API 36.1, with Live Updates); any other name gets API 36, unless VB_AVD_IMAGE says otherwise.
android_emulator() {
  local abi=x86_64; [[ "$(uname -m)" == arm64 ]] && abi=arm64-v8a
  local api=36; [[ "$AVD" == vb361 ]] && api=36.1
  local image="${VB_AVD_IMAGE:-system-images;android-$api;google_apis;$abi}"
  local emu="$ANDROID_HOME/emulator/emulator" missing=()
  [[ -x "$emu" ]] || missing+=("the emulator")
  [[ -d "$ANDROID_HOME/${image//;//}" ]] || missing+=("the system image $image (about 1.5 GB)")
  if [[ ! -x "$emu" ]] || ! "$emu" -list-avds 2>/dev/null | grep -qx "$AVD"; then missing+=("an emulator named $AVD (a Pixel 8)"); fi
  ((${#missing[@]})) || return 0
  local list; list="$(printf '%s, ' "${missing[@]}")"
  ask "To run the app, this installs ${list%, } into $ANDROID_HOME. Go ahead?" \
    || die "No emulator named $AVD. Create one in Android Studio, set VB_AVD, or use --build-only."
  "$SDKMANAGER" --sdk_root="$ANDROID_HOME" "emulator" "platform-tools" "$image"
  if ! "$emu" -list-avds 2>/dev/null | grep -qx "$AVD"; then
    # avdmanager asks whether to make a custom hardware profile: no.
    echo no | ANDROID_SDK_ROOT="$ANDROID_HOME" "$AVDMANAGER" create avd -n "$AVD" -k "$image" -d pixel_8
  fi
}

# Typing on the Mac's keyboard goes to the emulator: hw.keyboard on in the AVD's config. avdmanager leaves it off, and
# so may an older or hand-made AVD. Read when the emulator starts, so it's set just before.
android_keyboard() {
  local cfg="${ANDROID_AVD_HOME:-$HOME/.android/avd}/$AVD.avd/config.ini"
  [[ -f "$cfg" ]] || return 0
  grep -qx 'hw.keyboard=yes' "$cfg" && return 0
  if grep -q '^hw.keyboard=' "$cfg"; then sed -i '' 's/^hw.keyboard=.*/hw.keyboard=yes/' "$cfg"; else echo 'hw.keyboard=yes' >>"$cfg"; fi
  echo "Turned on the Mac's keyboard for emulator $AVD (hw.keyboard=yes)."
}

# The display's camera cut-out (1 or 0), and whether SystemUI draws one (1 or 0).
android_cutout_spec() { "$ANDROID_HOME/platform-tools/adb" shell dumpsys display 2>/dev/null | grep -qE 'cutoutSpec=\{[mM]' && echo 1 || echo 0; }
android_cutout_drawn() {
  "$ANDROID_HOME/platform-tools/adb" shell dumpsys activity service com.android.systemui/.SystemUIService ScreenDecorations 2>/dev/null \
    | grep -q 'DisplayCutoutView' && echo 1 || echo 0
}

# Whether the status bar is as tall as its cut-out says (1 or 0): Android's 24dp default without one, taller with one.
# SystemUI works out its height when it starts, so a stale one means a restart is due.
android_bar_ok() {
  local adb="$ANDROID_HOME/platform-tools/adb" dpi bar spec
  dpi="$("$adb" shell wm density 2>/dev/null | tr -d '\r' | awk '/Override/ { o = $NF } /Physical/ { p = $NF } END { print o ? o : p }')"
  bar="$("$adb" shell dumpsys window 2>/dev/null | sed -n 's/.*type=statusBars frame=\[0,0\]\[[0-9]*,\([0-9]*\)\].*/\1/p' | head -1)"
  spec="$(android_cutout_spec)"
  [[ -n "$dpi" && -n "$bar" ]] || { echo 0; return; }
  local def=$(( (24 * dpi + 159) / 160 ))
  if [[ "$spec" == 0 ]]; then ((bar <= def)) && echo 1 || echo 0; else ((bar > def)) && echo 1 || echo 0; fi
}

# Waits up to $2 seconds for "$1" (a command printing 1 or 0) to print $3.
android_wait() { local i; for ((i = 0; i < $2; i++)); do [[ "$($1)" == "$3" ]] && return 0; sleep 1; done; return 1; }

# Restarts SystemUI without root (am crash), and waits for the new process.
android_restart_systemui() {
  local adb="$ANDROID_HOME/platform-tools/adb" old new="" i
  old="$("$adb" shell pidof com.android.systemui 2>/dev/null | tr -d '\r' || true)"
  "$adb" shell am crash com.android.systemui >/dev/null 2>&1 || true
  SYSTEMUI_RESTARTED=1
  for ((i = 0; i < 30; i++)); do
    sleep 1; new="$("$adb" shell pidof com.android.systemui 2>/dev/null | tr -d '\r' || true)"
    [[ -n "$new" && "$new" != "$old" ]] && return 0
  done
  die "SystemUI didn't restart. Restart the emulator (adb reboot)."
}

# Makes the display's cut-out and SystemUI's drawing of it match $1 (VB_CUTOUT; none means no cut-out). The display
# takes an overlay change a moment later, and SystemUI reads it only when it starts, so: wait for the display, restart
# SystemUI if its drawing or status bar is out of date, and check again (twice at most).
android_cutout_settle() {
  local want=1 try; [[ "$1" == none ]] && want=0
  android_wait android_cutout_spec 15 "$want" || die "The emulator didn't take the '$1' cut-out. Restart it (adb reboot) and run this again."
  for try in 1 2; do
    [[ "$2" == 0 && "$try" == 1 && "$(android_cutout_drawn)" == "$want" && "$(android_bar_ok)" == 1 ]] && return 0
    android_restart_systemui
    android_wait android_cutout_drawn 15 "$want" && android_wait android_bar_ok 15 1 && { sleep 2; return 0; }
  done
  die "SystemUI didn't draw the '$1' cut-out. Restart the emulator (adb reboot) and run this again."
}

cmd_android() {
  say "Android"
  local dir="$VB/apps/mobile/android"
  [[ -d "$dir" ]] || die "No apps/mobile/android here. The Android app is on the feat/android-compose branch."
  export ANDROID_HOME
  android_jdk
  android_tools
  local adb="$ANDROID_HOME/platform-tools/adb" emu="$ANDROID_HOME/emulator/emulator"
  local q=(--quiet); ((VERBOSE)) && q=()
  (cd "$dir" && ./gradlew "${q[@]}" :app:assembleDebug)
  local apk="$dir/app/build/outputs/apk/debug/app-debug.apk"
  echo "Built $apk"
  ((BUILD_ONLY)) && return
  if ! [[ -x "$adb" ]] || ! "$adb" devices | grep -q 'emulator-.*device$'; then
    android_emulator
    android_keyboard
    echo "Starting emulator $AVD"
    mkdir -p "$BUILD"
    nohup "$emu" -avd "$AVD" >"$BUILD/emulator.log" 2>&1 &
  fi
  "$adb" wait-for-device
  until [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
  # The emulator's camera cut-out, set before the app starts (a change restarts apps). By default none: no punch hole,
  # and the short status bar of phones without one. The emulator turns on its device's overlays at every boot
  # (com.android.internal.emulation.pixel_8 and com.android.systemui.emulation.pixel_8: the Pixel 8's centre hole), so
  # they're turned off again each run. VB_CUTOUT=device keeps them; hole, corner, tall or double simulates that cut-out.
  local cut="${VB_CUTOUT:-none}" dev; dev="$(sed -n 's/^hw.device.name=//p' "${ANDROID_AVD_HOME:-$HOME/.android/avd}/$AVD.avd/config.ini" 2>/dev/null || true)"
  local want=()
  case "$cut" in
    none) ;;
    device) [[ -n "$dev" ]] && want=("com.android.internal.emulation.$dev" "com.android.systemui.emulation.$dev") ;;
    *) want=("com.android.internal.display.cutout.emulation.$cut") ;;
  esac
  local on o changed=0
  on="$("$adb" shell cmd overlay list 2>/dev/null | tr -d '\r' | sed -n 's/^\[x\] \(com\.android\.[a-z]*\.\(display\.cutout\.\)\{0,1\}emulation\..*\)/\1/p' || true)"
  for o in $on; do [[ " ${want[*]-} " == *" $o "* ]] || { "$adb" shell cmd overlay disable "$o" >/dev/null; changed=1; }; done
  # From one cut-out to another, the old one goes first, so the new one isn't mistaken for it.
  if ((changed)) && ((${#want[@]})); then
    android_wait android_cutout_spec 15 0 || true
  fi
  for o in ${want[@]+"${want[@]}"}; do grep -qx "$o" <<<"$on" || { "$adb" shell cmd overlay enable "$o" >/dev/null; changed=1; }; done
  SYSTEMUI_RESTARTED=0
  android_cutout_settle "$cut" "$changed"
  if ((changed)); then echo "Emulator camera cut-out: $cut."
  elif ((SYSTEMUI_RESTARTED)); then echo "Restarted the emulator's SystemUI: it was still showing an old cut-out."; fi
  "$adb" install -r "$apk" >/dev/null
  # am start, not monkey: monkey exits 251 on Android 16 even when the app starts, which stopped this script.
  "$adb" shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n com.mariusrubin.voucherboard/.MainActivity >/dev/null
  echo "Running com.mariusrubin.voucherboard on the emulator."
}

cmd_all() {
  BUILD_ONLY=1
  cmd_test; cmd_chrome; cmd_firefox; cmd_safari; cmd_ios
  if [[ -d "$VB/apps/mobile/android" ]]; then cmd_android; else say "Android: skipped (on the feat/android-compose branch)"; fi
}

cmds=()
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    -v|--verbose) VERBOSE=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --open) OPEN=1 ;;
    test|chrome|firefox|safari|ios|android|all) cmds+=("$a") ;;
    *) usage >&2; die "Unknown argument: $a" ;;
  esac
done
((${#cmds[@]})) || { usage; exit 1; }
need node "Install Node.js 22 or later."
for c in "${cmds[@]}"; do "cmd_$c"; done
