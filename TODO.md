# TODO

## Notifications (desktop)

The mobile app already schedules local reminders (`src/reminders.js`). The extension doesn't yet.

- [ ] Chrome: background service worker using `chrome.alarms` and `chrome.notifications`, scheduled from `VB.reminders.schedule()`. These are new manifest permissions, so Chrome disables the extension after the update until the user accepts them. Say so in the release notes.
- [ ] Reschedule on every plan save and on `refresh()`; drop alarms for cancelled or ended bookings.
- [ ] Settings: on/off and lead time, as in the app.
- [ ] An Extend action that opens the planner with the booking sheet filled in (never books from the notification).

## Mobile

The design is the split model: the UI runs in an app-owned WebView, and every council request runs in a hidden council-site WebView, so there's one cookie jar and real browser requests (`voucherboard/mobile/BRIDGE.md`). The UI, the shared core and both shells are written; the shells have never been built.

- [ ] First iOS build on a Mac: `xcodegen`, fix compile errors, run through `mobile/ios/README.md`'s open points.
- [ ] First Android build in Android Studio: fix compile errors, run through `mobile/android/README.md`'s open points.
- [ ] Try live on a phone, in test mode first: sign-in, session lifetime after the app is closed, Book now, a plan run, cancel, end early, favourites, the Buy hand-off and 3-D Secure in the council view, a reminder and Extend.
- [ ] Check that a run paused by backgrounding resumes cleanly on both platforms.
- [ ] App icons: 1024 px for iOS, plus adaptive icon artwork for Android (the current icons are placeholders).
- [ ] Swipe actions on list rows (remove, book again, cancel). The flow has them; the build uses buttons for now.
- [ ] Demo mode for app review (Apple guideline 2.1, Play "app access"), running against the test fixtures.
- [ ] Store listing: neutral branding with "for Lewisham" in the description, no council logo, a clear "not affiliated" line.
- [ ] Before store submission: read the full visitor voucher T&Cs PDF, lewisham.gov.uk/termsandconditions and the portal's per-permit T&Cs popup for anything on third-party tools.
- [ ] Later: home-screen widgets ("On now", "Next") from cached data; Siri and Android shortcuts.
