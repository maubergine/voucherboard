# App Privacy answers (App Store Connect > App Privacy)

Answer: **Data Not Collected.**

## Why that's the right answer

Apple counts data as *collected* when it's transmitted off the device in a way that lets the developer, or the
developer's third-party partners, access it for longer than it takes to service the request in real time. Data that is
only processed on the device isn't collected.

| Data | Where it goes | Collected? |
| --- | --- | --- |
| Plans, settings, chosen permit, terms acceptance | One file in the app's private storage, excluded from backup | No: on device only |
| Plates, booking times, favourites, voucher balance | Read from and sent to the council's permit site, in the user's own signed-in session, to do what the user asks | No: see below |
| Council session cookie | The phone's web view (`WKWebsiteDataStore.default()`), as Safari would keep it | No: on device, sent only to the council |
| Camera frames and photos for plate scanning | Read in memory by Vision; never saved or sent | No |
| Text read from a shared photo | `shared-scan.json` in the App Group, deleted when the app reads it | No: on device only |
| Reminders and Live Activities | Scheduled locally; no push token, no server | No |
| Error report | Only if the user chooses Share last error details, to wherever they share it | No: user-initiated sharing |

**The council is not the developer's partner.** Voucherboard has no server, SDK, analytics, advertising or crash
reporting. Requests go from the user's phone to the council's site, in the user's own session, exactly as when they use
the site in Safari. The council already holds this data as the user's service provider. Neither the developer nor any
partner of the developer can access it. The app's UI web view has `connect-src 'none'`, and only the council view
talks to the network (see `mobile/BRIDGE.md`).

## Questionnaire

1. *Do you or your third-party partners collect data from this app?* **No, we do not collect data from this app.**
2. That's all. With "No", App Store Connect asks nothing further and the product page shows **Data Not Collected**.

## Tracking

The app doesn't track. There's no IDFA use and no `NSUserTrackingUsageDescription`, so App Tracking Transparency
doesn't apply.

## Privacy manifest

No `PrivacyInfo.xcprivacy` is needed. The app uses no third-party SDKs, and none of Apple's required-reason APIs:
no `UserDefaults`, no file timestamp, disk space, system boot time or active keyboard APIs. `Store.swift` reads and
writes one JSON file with `Data(contentsOf:)` and `write(to:)`, which aren't on the list. If any of these are added later,
add a privacy manifest with the matching reason codes before the next upload, or App Store Connect warns (ITMS-91053).

## Keep these true

If any of the following changes, these answers and the privacy policy must change first. So must the terms
(section 12), which promise the same:

- adding analytics, crash reporting, remote config or a kill switch;
- any server of the developer's;
- push notifications (a push token is collected data);
- storing images.
