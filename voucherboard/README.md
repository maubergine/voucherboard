# Voucherboard (beta)

Voucherboard is beta software. A browser extension that replaces the booking screens of Lewisham's visitor parking permit site (`parkingpermits.lewisham.gov.uk`) with a planner:

- Book several days, vehicles and hours in one go. Plans are additive, and each planned booking has its own ×.
- Hours outside your zone's controlled times are skipped, using the council's published zone hours and bank holidays.
- Day, week, 28-day and list views of every vehicle's bookings. Tap or drag to add.
- Change planned or booked times to the minute. A booking that hasn't started is cancelled and rebooked at the new time. A booking in progress can be ended early (beta, off by default).
- The list view sorts by date or name, filters by picking vehicles, and has bulk manage: change the time of, or cancel, several items at once.
- Save any previously booked plate as a favourite, or delete favourites.
- Optional confirmation email per booking, or for all of them.
- Searchable vehicles with plates shown inline. A new plate can be kept as a one-off or saved as a favourite.
- Each plan shows what its vouchers cost, using prices read live from the site's buy page. When shorter vouchers would be cheaper, it suggests what to buy.
- A progress bar tracks every request sent to the site. You can stop after the current voucher.
- Built for phones first.

It runs only in your own logged-in browser tab. There's no server, and it never reads, stores or sends your password. It makes the same requests the council's own pages make.

## Install (Chrome, Edge, Brave)

1. Install Voucherboard from the [Chrome Web Store](https://chromewebstore.google.com/detail/voucherboard-beta/cldhejnblckejbeebjidikhebdfnncak).
2. Go to `https://parkingpermits.lewisham.gov.uk`, log in, and tap the **Voucherboard** button in the bottom-right corner.

## Install unpacked (developers)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Go to `https://parkingpermits.lewisham.gov.uk`, log in, and tap the **Voucherboard** button in the bottom-right corner.

## Install (Safari)

This needs full Xcode (not only the command line tools).

```sh
xcrun safari-web-extension-converter . --app-name Voucherboard --bundle-identifier <your.bundle.id>
```

Build and run the generated Xcode project, then enable the extension in Safari's settings. Publishing to the App Store needs an Apple developer account.

## Test mode

Voucherboard starts in live mode. Turn on **test mode** in Settings to try a plan safely. Every check runs against the council site: the form, controlled hours, date and time, and the confirmation. The final booking request is never sent, so no vouchers are used. A "Test mode" tag shows in the top panel while it's on. You still review every booking first.

## How it books

For each voucher, in order, with a 0.5 second pause between requests:

1. `GET /Permit/VisitorPermit`: the booking form (security token, voucher period).
2. `POST /Permit/GetNonEnforceableCoverage`: the site refuses times outside controlled hours.
3. `GET /Permit/VerifyDateTimeOfVisitorVoucher`: the date and time check (skipped when starting now, as the site does).
4. `POST /Permit/GetVisitorVoucherConfirmation`: the plate and date shown must match, or the run stops.
5. `POST /Permit/VisitorPermit`: the booking itself. This step isn't sent in test mode.

Cancelling uses `/Permit/CancelVoucherConfirmationPopup` then `POST /Permit/CancelVisitorVoucher`. Prices come from `POST /VoucherBuyAgain/VoucherSelect`, the same request as the site's Buy Again button.

Voucherboard doesn't run on payment, buy or sign-in pages (`/PermitPayment`, `/VoucherBuyAgain`, `/Account`), or on any page with card or password fields.

"Buy" checks the purchase with `POST /VoucherBuyAgain/ValidateBuyAgainLimits`, then goes to the council's permits page (`/Home/ApplicantPermits`). There it presses the permit's own **Buy Again** button and fills in the period and number in the council's dialog. You check them, press **Buy**, and pay in the council's own payment window. The planner reopens afterwards with your plan kept.

## Copyright and terms

© 2026 Marius Rubin. All rights reserved, including all commercial rights. Voucherboard is wholly the intellectual property and copyright of Marius Rubin. The only permission to use it is a personal, non-commercial, revocable licence to use this beta version, which can be ended at any time. No licence is granted to copy, modify, distribute or commercialise it. See [`LICENSE`](LICENSE).

Voucherboard is an independent tool, not made or endorsed by Lewisham Council. Use of it is entirely at the user's own risk. The full terms, including the exclusion of liability, are in [`src/terms.js`](src/terms.js). Users must accept them in the extension before it reads anything from the council site, and again whenever they change (bump `VERSION` in that file).

## Develop

```sh
npm install
npm test          # parsers, planner, and the UI against saved pages
npm run package   # dist/voucherboard-<version>.zip
node scripts/make-icons.py
```

`test/fixtures` holds pages saved from the site with names, plates, addresses and security tokens replaced. Don't commit HAR files: they contain session cookies. `.gitignore` excludes them.

## Not yet covered

- 5-hour and day vouchers are planned from the council's rules, but haven't been tried on a live account.
- Week vouchers are shown in the balance but not planned.
- Permits that need a car park choosing, or that are limited to one vehicle, stop with a message to book on the council site.
- Starting a booking "now" sends the site's Activate Now flag. It's covered by tests but hasn't been tried live.
