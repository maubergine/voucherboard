# Content rating answers (Play Console > App content > Content rating)

Play uses the IARC questionnaire, which gives a rating for each region: PEGI in the UK and Europe, ESRB in the
Americas, and so on (https://support.google.com/googleplay/android-developer/answer/9898843). Expected result:
**PEGI 3**, **ESRB Everyone**, **IARC 3+**.

| Question | Answer | Why |
| --- | --- | --- |
| Email address for IARC | voucherboard@mariusrubin.com | IARC sends the certificate there |
| Category | **All other app types** (not a game, not social or communication, not a reference/news/educational app) | It's a utility |
| Violence, blood, sexual content, profanity, fear, drugs, alcohol, tobacco | No to each | |
| Gambling, simulated gambling | No | |
| Does the app let users interact or exchange content with other users? | **No** | Nothing a user writes is shown to anyone else. Favourite nicknames are saved to the user's own council account |
| Does the app share the user's current physical location with other users? | **No** | The app has no location permission |
| Does the app allow users to purchase digital goods? | **No** | Vouchers are bought and paid for on the council's own pages, in the council view. The app takes no payment |
| Does the app contain ads? | **No** | |
| Is the app a web browser or search engine? / Unrestricted internet access | **No** | The council view shows one site. Taps that leave it, and the council's account registration, open in the phone's browser; only payment and 3-D Secure redirects load in the app (`CouncilView.kt`) |

## Target audience and content (App content > Target audience and content)

- Target age groups: **18 and over** only. The app is for permit holders, who are adults; choosing only 18+ keeps it
  out of the Families policy and the Designed for Families programme.
- "Could your store listing unintentionally appeal to children?" **No.**

## Other App content declarations

| Declaration | Answer |
| --- | --- |
| Ads | No, the app doesn't contain ads |
| Government apps | **No**, it isn't developed by or on behalf of a government. The listing names its sources and says it doesn't represent the council, as Google's government information rules ask (https://support.google.com/googleplay/android-developer/answer/9514050) |
| Financial features | None. It doesn't handle money; buying vouchers happens on the council's pages |
| Health | None |
| News apps | No |
| COVID-19, crypto, VPN, accessibility, foreground service, full-screen intent | Not used. If Play Console asks about foreground services, the app has none: Live Updates are ordinary notifications promoted by Android 16, with no service behind them |
| Exact alarms | The app asks for `SCHEDULE_EXACT_ALARM` (user-granted), not `USE_EXACT_ALARM`, so no exact alarm declaration applies. See `docs/GOOGLE_PLAY.md`, 2.2 |
| Photo and video permissions | None requested: the system photo picker needs no permission |
