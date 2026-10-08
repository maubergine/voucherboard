# Voucherboard: brief for App Review

*Version for the first App Store submission. Remove every [OWNER: …] note before attaching it. Attach it as a PDF under App Review Information > Attachment, and use it for
replies in App Store Connect. Every external quote was read on 8 October 2026 at the URL given.*

## 1. In one paragraph

Voucherboard is a free iPhone app for residents of the London Borough of Lewisham who hold a visitor parking permit. It
replaces clicking through the council's permit site one voucher at a time with a planner: book many visits at once,
skip hours that need no voucher, see everything on a calendar, and get reminded before a visitor's time runs out. It is
original software by one individual developer. It isn't affiliated with Lewisham Council or its supplier. It holds no
data off the phone, takes no payments and has no servers. Every booking, cancellation and purchase is still made by the
council's own system, in the resident's own signed-in session.

## 2. The problem

A Lewisham visitor permit is a balance of vouchers, usually one-hour vouchers. Each visit has to be activated on the
council's site, NSL's "Apply" platform (`parkingpermits.lewisham.gov.uk`), by filling in its booking form: plate, date,
start time and length. A carer, a cleaner or family visiting through the week means filling in that form again and again.
It also means working out which hours are controlled in your zone (some zones are controlled for only two hours a day),
and remembering to extend before a voucher ends to avoid a penalty charge.

## 3. What Voucherboard adds

The council's site offers a booking form for one visit at a time, a list of permits and bookings, favourite vehicles,
cancellation and Buy Again. Voucherboard adds the following, implemented in its own engine (`src/planner.js`,
`src/model.js`, `mobile/www/engine.js`) and SwiftUI screens.

| Area | Voucherboard |
| --- | --- |
| Planning | Plan several vehicles, days and times together, then review and run them as one batch |
| Quick picks | Today, Tomorrow, Rest of this week, Next week, Every *weekday* for 4 weeks; 1 hour, 2 hours, 5 hours, whole controlled period |
| Zone hours | Knows the controlled hours of all 30 Lewisham zones and subzones (from the council's published table), and only books the hours that need a voucher |
| Bank holidays | Marks England and Wales bank holidays on the board |
| Changes | Change a booking's time as one step: Voucherboard cancels and rebooks in a safe order |
| Bulk | Select many bookings and planned visits; move them, shift them or cancel them together |
| End early | End a visit that has started by cancelling its vouchers that haven't started yet, with a choice of end times |
| Purchase advice | Works out when a plan needs more vouchers than you have, or when a cheaper mix of voucher lengths would cover it |
| Views | Today (on now, next 7 days), calendar month, day agenda, landscape week board, list with filters |
| Favourites | Search by nickname or plate, suggestions as you type, save a new vehicle as a favourite with its first booking |
| Test mode | Runs every check the council's site makes, without booking anything or using a voucher |
| Safety | Every destructive action asks first; runs stop at the first failure and keep the rest of the plan; Undo for plan edits |
| Diagnostics | A shareable error report with the site's anti-forgery tokens removed |

## 4. What only the iPhone app can do

The council's site is a website. The features below need iOS frameworks that no website can use, or would need a server
that the council's site doesn't have.

| Feature | iOS capability | Why a website can't |
| --- | --- | --- |
| Reminder before a voucher ends, with **Extend 1 hour** in the notification | `UserNotifications`, local notifications with actions | Web push on iPhone needs the site installed to the Home Screen and a push server sending each message. The council's site has neither, and these reminders are built on the phone from the user's bookings |
| Live Activity: plate, countdown and **Extend** on the Lock Screen and in the Dynamic Island, for each visitor parked now | `ActivityKit`, WidgetKit extension | Live Activities are native only |
| Scan a number plate with the camera | VisionKit `DataScannerViewController`, Vision text recognition on the device | A web page can't run Live Text recognition |
| Share a photo of a car from Photos to fill in the plate | Share extension and App Group | A website can't appear in the share sheet |
| Week board when the phone is turned sideways | Orientation handling | |
| Haptics, swipe actions on rows, native sheets | UIKit and SwiftUI | |
| Keeps a booking run going briefly if the user switches away | `beginBackgroundTask` | |
| Dynamic Type, VoiceOver labels, dark mode | SwiftUI accessibility | |

## 5. Original work, not a repackaged website

- **Written from scratch** by Marius Rubin. About 4,500 lines of Swift, 2,300 lines of JavaScript (the planning engine
  and the bridge between the screens and the council view) and 1,900 lines of tests, in 140 automated tests. The planner
  logic is shared with the developer's own Chrome extension.
- **Native UI.** Every Voucherboard screen is SwiftUI. The engine runs in an invisible web view that has no network
  access (`connect-src 'none'`), with every navigation away from the app bundle refused.
- **No council code, content, design or branding.** The app's name, icon, screens and text are its own. It doesn't
  use the council's or NSL's logos, and its listing says it isn't affiliated.
- **The council's own pages appear only when the user needs them**, clearly labelled under a native header bar:
  "Council sign-in. This is Lewisham's own sign-in page. Voucherboard never sees or uses any of your login details."
  The same applies when buying vouchers and when the user chooses Show council site.

## 6. The council's system does every transaction

Voucherboard is a client for the user's own council account. It delegates every transaction to the council's system,
which stays the only record of permits, bookings and vouchers.

| Transaction | Who does it |
| --- | --- |
| Sign in | The council's sign-in page, typed into by the user |
| Book a visitor | The council's booking endpoint, through the same steps as its own form. The council's site validates each booking (zone, times, plate, balance) |
| Cancel, end early | The council's own cancellation endpoint, after the user confirms |
| Add or delete a favourite | The council's favourites form |
| Buy vouchers and pay | The council's Buy Again dialog and payment pages. Voucherboard fills in the voucher type and number; the user presses Buy and pays the council. Voucherboard's code is switched off on payment pages |
| Booking confirmation email | Sent by the council, if the user ticks it |
| The record of bookings and balance | The council's system. Voucherboard reads it fresh each time and keeps it in memory only |

Requests run one at a time, half a second apart, as the user's own session would make them. Voucherboard doesn't book
in the background, doesn't scrape data for anyone else, and doesn't get round any limit: if the council's site refuses
a booking, the run stops and tells the user.

## 7. The council's and its supplier's terms

Apple guideline 5.2.2 asks that an app which accesses a third-party service is "specifically permitted to do so under
the service's terms of use", with authorisation "provided upon request". These are the terms that apply, and what they
say.

| Source | What it covers | On apps, automation or software acting for the user |
| --- | --- | --- |
| The permit site, `parkingpermits.lewisham.gov.uk` | The service itself | There is no public terms-of-use page. Its accessibility statement says "This website is run by NSL" and "(Marston Holdings is the Parent company to NSL.)" (`/Home/AccessibilityInfo`). Sign-up asks only for agreement to the council's data-sharing policy. `robots.txt` doesn't exist (404). **Nothing restricts it.** |
| Lewisham Council website terms, https://lewisham.gov.uk/termsandconditions (published 23 January 2025) | lewisham.gov.uk | "Our website is maintained for your personal use and viewing." Restricts copying the council's logos, which Voucherboard doesn't use. **Nothing on apps, scraping, automation or framing.** |
| lewisham.gov.uk `robots.txt` | lewisham.gov.uk | `User-agent: *` / `Disallow:`: nothing disallowed |
| Visitor parking vouchers terms and conditions, https://lewisham.gov.uk/-/media/services/parking/visitor-parking-vouchers-terms-and-conditions.pdf (September 2025) | Visitor vouchers | "Visitor permits may be paperless (e-permits) and must be activated online in advance or when your visitor arrives"; "Visitor e-permits may be booked 28 days in advance"; "If you wish to park for longer than the permit duration indicated then you will need to use more permits in a consecutive method". Voucherboard follows these rules: it books online, at most 28 days ahead, with consecutive vouchers for longer visits. **Nothing on apps or who may operate the account.** |
| Lewisham's visitor permits page, https://lewisham.gov.uk/myservices/parking/permits/visitor-parking-permits (1 April 2026) | Visitor permits | "You can purchase and send e-vouchers to visitors electronically (including tradespeople and delivery drivers) to populate permit details themselves." The council already expects people other than the resident to enter booking details. |
| Parking privacy notice, https://lewisham.gov.uk/about-this-site/privacy/corporate-resources/privacy-notice---parking-penalty-charge-notices--permits-and-suspensions (10 September 2026) | Personal data | Nothing about third-party apps. |
| Marston Holdings website terms, https://marstonholdings.co.uk/marston-holdings-terms-and-conditions/ (May 2021) | "These terms tell you the rules for using our website https://www.marstonholdings.co.uk/" | Scoped to Marston's own website, not the permit site. Its clauses on interfering with "the proper working of the website", framing and sharing passwords would not be breached anyway: Voucherboard makes the site's normal requests at a human pace, shows the site full screen under its own address and branding rather than embedding it in other content, and never sees or shares the password. |

**What this does and doesn't show.** None of the published terms prohibits a resident from using software of their
choice to manage their own account, and the council's own pages expect others to enter booking details. But no
published document *specifically* grants permission either. The per-permit terms shown when a permit is bought are
only visible after signing in. [OWNER: replace with what they say, for example "The developer has read the terms
shown for their own permits, dated …; they say nothing about apps or software."] [OWNER: if you wrote to the council
and NSL (step 1.5 of docs/APP_STORE.md), add: "The developer wrote to Lewisham Council's parking service and to NSL on …
to ask for written confirmation, and will forward any reply to App Review." Add any reply you received.]

## 8. Not monetised

Free to download and use. No in-app purchases, subscriptions, adverts, sponsorship, affiliate links or sale of data.
The developer receives nothing from the council, its supplier or users. Voucher purchases are between the resident and
the council, at the council's prices, on the council's pages.

## 9. Data

- **No developer servers, accounts, analytics, advertising, crash reporting or third-party SDKs.** App Privacy: Data
  Not Collected.
- **All parking data stays in the council's system.** Permits, bookings, voucher balances and favourites are read from
  the council each time, held in memory, and not saved by the app.
- **Kept on the phone, in the app's private storage, excluded from backup:** the user's plan (visits they haven't sent
  yet), settings, the permit and subzone they chose, and when they accepted the terms. Deleting the app deletes them.
- **Individuals only.** Each user signs in to their own council account, and can only see and change their own
  permits. There are no shared accounts, no organisation features, and no way for the developer or anyone else to see
  a user's data.
- **On-device processing.** Number plate scanning runs on the phone with Vision; images are never saved or sent.
  Reminders and Live Activities are local, with no push token.

## 10. Sign-in and payment are untouched

- The user types their council email and password into the council's own page. Voucherboard's scripts don't run on
  sign-in, account, payment or card pages, or on any page with a password or card field (`council.js`, checked on
  every page). They run in a separate WebKit content world, on the council's host only.
- The app never reads, stores or sends passwords or card details. The council's session cookie is kept by WebKit, as
  Safari keeps it, and **More > Sign out of council site** deletes it.
- Voucherboard never buys anything. It fills in the council's Buy Again form; the user presses Buy and pays on the
  council's pages, including 3-D Secure.

## 11. Not affiliated, and says so

The listing, the first screen (terms, section 5: "Voucherboard is not made, endorsed, supported or checked by
Lewisham Council or its suppliers"), the More screen footer, the privacy policy and the support page all say that
Voucherboard is independent. The council's pages are labelled as the council's whenever they're shown.

## 12. Likely questions

**4.2 Minimum functionality: "a repackaged website".** It isn't one. Sections 3 to 5: a native SwiftUI app with its
own planning engine and iPhone-only features (reminders with actions, Live Activities, plate scanning, share
extension). The council's pages appear only for sign-in and payment, where the user must use the council's own pages.

**5.2.2 Third-party sites.** Section 7. The developer will forward any written reply from the council or NSL.

**4.1 / 5.2.1 Impersonation or third-party marks.** The name, icon and screens are Voucherboard's own, with no
council or NSL logo, and every screen that shows the council's site says it's the council's.

**2.1 Demo account.** A real council account can't be shared: it's tied to a resident's address and permit, and
holds their vouchers and payment history. Demo mode, on the sign-in screen, runs every feature against a made-up council
site inside the app, with bookings placed around today. Nothing is sent anywhere in demo mode, and nothing is kept.

**5.1.1(v) Account deletion.** The app doesn't create accounts. Council accounts are the council's; their registration
page opens in Safari.

**5.1.1(ix) Regulated services.** Visitor parking isn't one of the fields listed, and the app asks for no sensitive
information: plates, dates and times only.

**Data collected through web views.** The council view sends the user's own requests to the user's own council
account. Nothing reaches the developer or any partner of the developer, so it's not "collected" under Apple's
definition. Section 9.
