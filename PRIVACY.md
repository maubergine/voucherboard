# Voucherboard privacy policy

Last updated: 28 September 2026

Voucherboard is a browser extension, in beta, that adds a visitor parking voucher planner to the council permit site it supports (`parkingpermits.lewisham.gov.uk`). It's made by Marius Rubin, an individual developer, and isn't made or endorsed by the council.

## Summary

Voucherboard has no servers, accounts, analytics or tracking. Nothing about you is sent to the developer or anyone else. It only talks to the permit site you're already signed in to, in your own browser tab.

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

## Contact

Open an issue at https://github.com/maubergine/voucherboard/issues.
