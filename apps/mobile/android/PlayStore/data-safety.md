# Data safety answers (Play Console > App content > Data safety)

Answer: **No data collected, no data shared.** The listing then shows "No data shared with third parties" and "No data
collected".

## Why that's the right answer

Google's definitions (https://support.google.com/googleplay/android-developer/answer/10787469, read 12 October 2026):

- **Collect** means transmitting data from your app off a user's device. Data that is only processed on the device
  isn't collected.
- **Web views:** data sent through a web view counts only "if your app is in control of the code/behavior delivered
  through that webview".
- **Sharing** excludes transfers a user starts for a specific purpose ("based on a specific user-initiated action").

| Data | Where it goes | Collected? |
| --- | --- | --- |
| Plans, settings, chosen permit, terms acceptance | `SharedPreferences` in app-private storage, excluded from backup and device transfer (`data_extraction_rules.xml`) | No: on device only |
| Plates, booking times, favourites, voucher balance | Read from and sent to the council's permit site, in the user's own signed-in session, to do what the user asks | See below |
| Council session cookie | The WebView's cookie store, as Chrome would keep it | No: on device, sent only to the council |
| Camera frames and photos for plate scanning | Read in memory by ML Kit's bundled on-device model; never saved or sent | No |
| Images shared to the app | Read in memory from the sharing app's content URI; the image isn't copied or kept | No |
| Reminders and Live Updates | Local alarms and notifications; no Firebase, no push token | No |
| Error report | Only if the user chooses Share last error details, to wherever they share it | No: user-initiated |

**The council view.** This is the one judgement call. The app's own script (`apps/mobile/council/council.js`) runs in the
council view and sends the user's requests, so Google's web view sentence could be read as "collection". But the data
goes from the user's phone to the council's site, in the user's own session, to make the bookings the user asked for.
Nothing reaches the developer, and the developer has no server, SDK, analytics or partner that could receive it. The
council already holds this data as the user's service provider. That is a user-initiated transfer to the service the
user signed in to, not collection by the developer, and it's how App Store Connect was answered too
(`../../ios/AppStore/privacy-labels.md`).

If Play's review disagrees, the fallback is to declare **Personal info > Other info** (plates, vehicle nicknames,
booking times) as **collected, not shared**, **processed ephemerally: no**, **required**, purpose **App functionality**,
and say in the policy that the recipient is the council. Don't declare it pre-emptively.

## The questionnaire

1. *Does your app collect or share any of the required user data types?* **No.**
2. *Is all of the user data collected by your app encrypted in transit?* Not asked once you answer No. (Every request
   is HTTPS; the manifest sets `usesCleartextTraffic="false"`.)
3. *Do you provide a way for users to request that their data is deleted?* Not asked once you answer No. The privacy
   policy says how to delete everything on the phone.

## Advertising ID

Play Console > App content > Advertising ID: **No**, the app doesn't use an advertising ID. CI checks the merged
manifest has no `com.google.android.gms.permission.AD_ID`.

## Keep these true

If any of the following changes, these answers, `site/PRIVACY.md` and the terms (section 12) must change first:

- ML Kit's telemetry coming back (CI fails the build if `com.google.android.datatransport` is in the merged
  manifest; still check the traffic on a device, `docs/GOOGLE_PLAY.md` step 9);
- adding analytics, crash reporting, Firebase, remote config or a kill switch;
- any server of the developer's;
- push notifications (Firebase Cloud Messaging is a third-party SDK that collects a token);
- storing images.
