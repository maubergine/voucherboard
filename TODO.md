# TODO

## Notifications (desktop and mobile)

Local reminders built from the saved plan, scheduled on the device. No push server.

- [ ] Chrome: background service worker using `chrome.alarms` and `chrome.notifications`. These are new manifest permissions, so Chrome disables the extension after the update until the user accepts them. Say so in the release notes.
- [ ] Reschedule on every plan save and on `refresh()`; drop alarms for cancelled or ended bookings.
- [ ] Settings: on/off and lead time (for example "15 min before a voucher ends").
- [ ] iOS and Android shells: the same schedule through `UNUserNotificationCenter` and `AlarmManager`/`WorkManager`, driven by `VB.host`.
- [ ] Copy: plain outcome lines, such as "VW55XYZ: voucher ends at 12:00".

## Mobile

- [ ] Architecture: native WebView shells (see the step (a) proposal). Sideload for development; store distribution is the goal.
