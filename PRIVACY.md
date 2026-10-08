# Voucherboard privacy policy

Last updated: 8 October 2026

Voucherboard is a visitor parking voucher planner for the council permit site it supports (`parkingpermits.lewisham.gov.uk`). It comes as a browser extension and as an app for iPhone. It's made by Marius Rubin, an individual developer, and isn't made or endorsed by the council or its suppliers.

This policy covers both. Where they differ, the [iPhone app](#the-iphone-app) section says how.

## Summary

Voucherboard has no servers, accounts, analytics, advertising or tracking. Nothing about you is sent to the developer or anyone else. It only talks to the permit site you're signed in to, in your own session: in your browser tab, or in the app on your phone.

## What it reads

When you open Voucherboard on the permit site, it reads pages from that site using your existing session, as the site's own pages do:

- your permits and your unused vouchers
- the parking zone on your permit, used to show its controlled hours
- your visitor bookings: vehicle plates, dates, times and booking references
- your favourite vehicles: plates and nicknames
- voucher prices from the site's buy page

This is used only to show your planner and to make the bookings, cancellations and favourite changes you ask for. It's kept in memory while the page is open and isn't saved, except as listed below.

Voucherboard never reads, stores or sends your password or card details. It doesn't run on payment, card or account pages.

## What it stores

The following is stored in your browser with Chrome's extension storage (`chrome.storage.local`) and never leaves your device:

- your plans for each permit: plates, dates, times, planned changes and whether to email a confirmation
- the permit you last chose
- your settings, such as test mode, the beta option and view preferences
- when you accepted the terms, and which version
- for a few minutes during a purchase, the voucher type and number to fill in on the site's Buy dialog

To delete it, remove the extension, or clear a plan in the planner.

## What it sends, and to whom

Voucherboard sends requests only to the permit site, and only to do what you ask: book, cancel, change a favourite, check a purchase amount, or reload your details. These requests use your existing session, and are the same requests the site's own pages send. The council's own privacy policy covers how it handles them.

Nothing is sent to the developer, analytics services, advertisers or any other third party. User data isn't sold, transferred or used for any purpose other than the planner.

## Error reports

If a booking fails, you can choose **Copy error details** to copy a plain-text report to your clipboard, with anti-forgery tokens removed. Nothing is sent automatically. If you paste it into a GitHub issue, it's public on GitHub. Check it first and remove anything you don't want to share, such as plates.

## Links

The **Guide** button opens a page bundled inside the extension. **Report issue** opens the project's GitHub issues page, which GitHub's own privacy policy covers.

## Changes

If this policy changes, the updated version will be published here with a new date. If a change affects what data is handled, the extension's terms will also change, and you'll be asked to accept them again.

## The iPhone app

The app reads, sends and stores the same things as the extension, with these differences.

- **Signing in.** You sign in on the council's own sign-in page, shown inside the app. Voucherboard's code doesn't run on sign-in, account, payment or card pages, and never reads your password or card details. The council's session cookie is kept by the phone's web view, as Safari would keep it, so you stay signed in. **More > Sign out of council site** deletes it.
- **Where data is stored.** Plans, settings, the permit you chose and your acceptance of the terms are kept in one file in the app's private storage on your phone. It's excluded from iCloud and device backups, and never synced. Deleting the app deletes it.
- **Reminders and Live Activities.** Reminders are local notifications scheduled on your phone, and a Live Activity shows a visitor's plate and end time on your Lock Screen. Neither is sent from anywhere, and the app doesn't use push notifications. You can turn both off in **More**, or in the phone's Settings.
- **Number plate scanning.** If you scan a plate with the camera, choose a photo, or share a photo to Voucherboard, the phone reads its text with Apple's on-device text recognition. The picture isn't saved, uploaded or kept. When you share a photo, only the text read from it is passed to the app, through a small file in the app's private shared storage that the app deletes when it reads it. Photos you choose come through the system photo picker, so the app has no access to your photo library. Camera access is asked for only when you first scan with the camera.
- **Error details.** **Share last error details** opens the phone's share sheet with a plain-text report, with anti-forgery tokens removed. Nothing is sent unless you choose where to share it.
- **Links.** Links in Voucherboard's own screens, such as Report issue, open in Safari.
- **What Apple collects.** The App Store and iOS may collect information under Apple's own privacy policy, such as crash reports if you've chosen to share them with developers. Voucherboard adds no analytics or crash reporting of its own.

To delete everything Voucherboard keeps on your phone, sign out of the council site in **More**, then delete the app.

## Contact

See [SUPPORT.md](SUPPORT.md).
