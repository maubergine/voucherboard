# TODO

## Notifications (desktop)

The mobile app already schedules local reminders (`src/reminders.js`). The extension doesn't yet.

- [ ] Chrome: background service worker using `chrome.alarms` and `chrome.notifications`, scheduled from `VB.reminders.schedule()`. These are new manifest permissions, so Chrome disables the extension after the update until the user accepts them. Say so in the release notes.
- [ ] Reschedule on every plan save and on `refresh()`; drop alarms for cancelled or ended bookings.
- [ ] Settings: on/off and lead time, as in the app.
- [ ] An Extend action that opens the planner with the booking sheet filled in (never books from the notification).

## Mobile

The design is the split model: the UI runs in an app-owned WebView, and every council request runs in a hidden council-site WebView, so there's one cookie jar and real browser requests (`voucherboard/mobile/BRIDGE.md`). The UI, the shared core and both shells are written; the shells have never been built.

- [x] First iOS build on a Mac. The SwiftUI app runs in the Simulator against the test fixtures.
- [ ] iOS: check dark mode, iPad (board from Calendar), Dynamic Type and VoiceOver across the SwiftUI screens.
- [ ] iOS: a UI test target in the repo that tours the app against the fixtures (one was run from a scratch project).
- [ ] Try live on a phone, in test mode first: sign-in, session lifetime after the app is closed, Book now, a plan run, cancel, end early, favourites, the Buy hand-off and 3-D Secure in the council view, a reminder and Extend.
- [ ] Check that a run paused by backgrounding resumes cleanly.
- [ ] Number plate scanning on real photos: front (white) and rear (yellow) plates, angles, night, and several cars in one picture. Tune `src/plates.js` from what goes wrong.
- [ ] iOS share extension: check it can open the app on current iOS; if not, it falls back to "Open Voucherboard to choose the plate".
- [ ] Swipe actions on list rows: done on iOS Today, Calendar, List and the plan (remove a planned item; cancel a booking, with a confirm). Still to do: Vehicles.
- [ ] iOS Live Activity on a phone: check it starts after Book now, Extend from the Lock Screen, and that it goes when the visit ends.
- [x] Store listing: neutral branding with "for Lewisham" in the description, no council logo, a clear "not affiliated" line (`mobile/ios/AppStore/`).
- [x] Public T&Cs read: the visitor voucher T&Cs PDF, lewisham.gov.uk/termsandconditions, Marston's website terms. Nothing on third-party tools (`AppStore/REVIEW_BRIEF.md`, section 7).
- [ ] Owner: read the portal's per-permit T&Cs popup while signed in, and decide on writing to the council and NSL (`docs/APP_STORE.md`, 1.4 and 1.5).
- [x] Before App Store submission (`docs/APP_STORE.md`, step 2). Owner still to read the new terms wording.
  - [x] Demo mode for app review (guideline 2.1), running against the test fixtures.
  - [x] No "beta" in the app or its terms (2.2). Owner approves the terms wording.
  - [x] Share extension: drop the runtime `openURL` call (2.5.1).
  - [x] Council view: off-host links and account registration open in Safari (age rating 4+, 5.1.1(v)).
  - [x] Privacy policy link in the app (5.1.1(i)).
  - [x] Ask for notification permission after the first booking, so default-on reminders arrive.
  - [x] iPhone only for the first release.
- [ ] Bank holidays after 2027 in `src/zones.js`.
- [ ] Later: home-screen widgets ("On now", "Next") from cached data; Siri shortcuts.
