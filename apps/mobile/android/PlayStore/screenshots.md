# Screenshots and graphics

Real screens from the app in demo mode, as for the App Store (`../../ios/AppStore/screenshots.md`): a made-up permit
and vehicles, captured on a weekday between 10:00 and 17:00 so a visitor is parked and controls are on. No real plates,
permit numbers or council pages. Same captions as iOS, with Android's own features.

| # | Screen | Caption |
| --- | --- | --- |
| 1 | Today | Who's parked now, and what's next |
| 2 | Book a visitor (days) | A week of visits in one go |
| 3 | Review run | Check it, then book it all |
| 4 | Lock screen with the Live Update | Extend from your lock screen |
| 5 | Reminder notification, expanded | A nudge before a voucher runs out |
| 6 | Scan with camera | Scan a number plate |
| 7 | Board (landscape) | Your whole week at a glance |
| 8 | Calendar | Every booking and plan |

## Sizes (https://support.google.com/googleplay/android-developer/answer/9866151, read 12 October 2026)

- **Phone screenshots:** at least 2, up to 8. JPEG or 24-bit PNG with no alpha. Each side 320 to 3,840 px, and the long
  side no more than twice the short side. Google recommends at least 4 at 1080 px or more: 1080 × 1920 portrait, or
  1920 × 1080 landscape for screenshot 7. Many phones' screens are taller than 2:1, so capture on an emulator with a
  1080 × 1920 display, or crop.
- **Feature graphic:** required, 1024 × 500, JPEG or 24-bit PNG with no alpha. The app icon on the navy background with
  "Voucherboard" and "Visitor parking, planned"; no council logo.
- **App icon:** 512 × 512, 32-bit PNG, up to 1,024 KB: `metadata/android/en-GB/images/icon.png`, the iOS 1024 px icon
  (`AppIcon.png`) scaled down with `ffmpeg -i AppIcon.png -vf scale=512:512:flags=lanczos -pix_fmt rgba icon.png`. Full
  square, no rounded corners or shadow: Play adds them. If the iOS icon changes, remake this and
  `res/drawable/ic_launcher_foreground.xml`.
- Tablet and Chromebook screenshots: none. The first release is for phones (`docs/GOOGLE_PLAY.md`, 2g).

## Capturing

1. Run the app on an emulator with the demo (sign-in screen > Try the demo).
2. Clean status bar: `adb shell settings put global sysui_demo_allowed 1`, then
   `adb shell am broadcast -a com.android.systemui.demo -e command enter` and
   `adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1030`.
3. `adb exec-out screencap -p > 01-today.png`, and so on.
4. For the notifications, Book now in the demo, then lock the emulator and wake it.
5. Exit demo mode: `adb shell am broadcast -a com.android.systemui.demo -e command exit`.

Don't commit the images: they're uploaded in Play Console. **CLAUDE** can make them on the emulator.
