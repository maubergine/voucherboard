# Voucherboard privacy policy

Last updated: 17 October 2026

Voucherboard is a visitor parking voucher planner for the council permit site it supports (`parkingpermits.lewisham.gov.uk`). It comes as a browser extension, for Chrome, Edge and Firefox, and as apps for iPhone and Android. It's made by Marius Rubin, an individual developer, and isn't made or endorsed by the council or its suppliers.

This policy covers all of them. Where the apps differ from the extension, [the phone apps](#the-phone-apps) section says how.

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

The following is stored in your browser's own extension storage (`storage.local`, in Chrome, Edge and Firefox alike) and never leaves your device:

- your plans for each permit: plates, dates, times, planned changes and whether to email a confirmation
- the permit you last chose
- your settings, such as test mode, the beta option and view preferences
- when you accepted the terms, and which version
- for a few minutes during a purchase, the voucher type and number to fill in on the site's Buy dialog

To delete it, remove the extension, or clear a plan in the planner.

In Firefox, Voucherboard declares that it collects no data, and addons.mozilla.org shows this on its listing.

## What it sends, and to whom

Voucherboard sends requests only to the permit site, and only to do what you ask: book, cancel, change a favourite, check a purchase amount, or reload your details. These requests use your existing session, and are the same requests the site's own pages send. The council's own privacy policy covers how it handles them.

Nothing is sent to the developer, analytics services, advertisers or any other third party. User data isn't sold, transferred or used for any purpose other than the planner.

**Safari only.** Chrome, Edge and Firefox update the extension themselves. Voucherboard for Safari is a download from GitHub, so at most once a day it asks GitHub's public API (`api.github.com`) for the latest release, to tell you when a newer version is out. The request is the same for everyone: it carries no cookies and nothing about you, your permits or your bookings. GitHub sees your IP address, as any website does, under its own privacy policy. The latest version number and when it was checked are kept in the extension's storage.

## Error reports

If a booking fails, you can choose **Copy error details** to copy a plain-text report to your clipboard, with anti-forgery tokens removed. Nothing is sent automatically. If you paste it into a GitHub issue, it's public on GitHub. Check it first and remove anything you don't want to share, such as plates.

## Links

The **Guide** button opens a page bundled inside the extension. **Report issue** opens the project's GitHub issues page, which GitHub's own privacy policy covers.

## Changes

If this policy changes, the updated version will be published here with a new date. If a change affects what data is handled, the extension's terms will also change, and you'll be asked to accept them again.

## The phone apps

The iPhone and Android apps read, send and store the same things as the extension, with these differences.

- **Signing in.** You sign in on the council's own sign-in page, shown inside the app. Voucherboard's code doesn't run on sign-in, account, payment or card pages, and never reads your password or card details. The council's session cookie is kept by the phone's web view, as Safari or Chrome would keep it, so you stay signed in. **More > Sign out of council site** deletes it.
- **Where data is stored.** Plans, settings, the permit you chose and your acceptance of the terms are kept in the app's private storage on your phone, and never synced. On iPhone that's one file, excluded from iCloud and device backups. On Android it's the app's private preferences, excluded from Google backups and from device-to-device transfer. Deleting the app deletes it.
- **Reminders and live visits.** Reminders are local notifications scheduled on your phone. While a visitor is parked, the app can show their plate and end time on your lock screen: a Live Activity on iPhone, a Live Update on Android (a countdown in the status bar and on the lock screen). None of these is sent from anywhere, and the apps don't use push notifications. You can turn them off in **More**, or in the phone's settings.
- **Number plate scanning.** If you scan a plate with the camera, choose a photo, or share a photo to Voucherboard, the phone reads its text on the device: with Apple's text recognition on iPhone, and with the text recognition model built into the Android app (Google's ML Kit, bundled in the app, so nothing is downloaded and Google Play services aren't used). ML Kit's usage reporting to Google is removed from the Android app, so it doesn't send anything. The picture isn't saved, uploaded or kept. Only the text read from it is used. On iPhone, a photo you share passes its text to the app through a small file in the app's private shared storage, which the app deletes when it reads it; on Android, the app reads the shared picture in memory from the app that shared it. Photos you choose come through the system photo picker, so the apps have no access to your photo library. Camera access is asked for only when you first scan with the camera.
- **Error details.** **Share last error details** opens the phone's share sheet with a plain-text report, with anti-forgery tokens removed. Nothing is sent unless you choose where to share it.
- **Links.** Links in Voucherboard's own screens, such as Report issue, and links on the council site that lead elsewhere, open in your phone's browser (Safari, or your default browser on Android).
- **What Apple and Google collect.** The App Store, Google Play, iOS and Android may collect information under Apple's or Google's own privacy policies, such as crash and performance reports if you've chosen to share usage and diagnostics data with developers (shown to developers in App Store Connect and Google Play Console). Voucherboard adds no analytics or crash reporting of its own.

To delete everything Voucherboard keeps on your phone, sign out of the council site in **More**, then delete the app.

## Contact

See [SUPPORT.md](SUPPORT.md).
