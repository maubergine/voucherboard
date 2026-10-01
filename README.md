# Voucherboard (beta)

Beta software. A browser extension that replaces the booking screens of Lewisham's visitor parking permit site (`parkingpermits.lewisham.gov.uk`) with a planner. It books several days, vehicles and hours in one go, skips hours outside the zone's controlled times, and shows voucher costs from prices read live from the site. It runs only in the user's own logged-in tab, with no server, and makes the same requests as the council's own pages.

## Layout

The extension lives in `voucherboard/`. See [`voucherboard/README.md`](voucherboard/README.md) for full details, including the request sequence used to book.

| Path | Purpose |
| --- | --- |
| `voucherboard/manifest.json` | Manifest V3. Content scripts run on the permit site, excluding payment, buy and sign-in pages. |
| `voucherboard/src/content.js` | Entry point. Adds the "Voucherboard" button and opens the planner. |
| `voucherboard/src/app.js`, `app.css` | Planner UI, rendered in a shadow root over the site. |
| `voucherboard/src/planner.js` | Pure planning logic: turns requested visits into voucher activations. |
| `voucherboard/src/portal.js` | Parsers and same-origin requests to the permit site. |
| `voucherboard/src/zones.js` | Controlled parking zones and operating times. |
| `voucherboard/src/terms.js` | Terms and conditions, accepted before first use. |
| `voucherboard/test/` | Node tests and anonymised saved pages in `fixtures/`. |
| `voucherboard/scripts/` | Packaging and icon generation. |
| `voucherboard/dist/` | Packaged zip. |

## Getting started

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/voucherboard-beta/cldhejnblckejbeebjidikhebdfnncak) (Chrome, Edge or Brave), then log in at `https://parkingpermits.lewisham.gov.uk` and tap **Voucherboard** in the bottom-right corner.

For development, load it unpacked instead:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `voucherboard/` folder.
3. Log in at `https://parkingpermits.lewisham.gov.uk` and tap **Voucherboard** in the bottom-right corner.

The extension starts in live mode. Test mode, in Settings, runs every check against the site but never sends the final booking request. Safari steps (requires full Xcode) are in the extension README.

Develop:

```sh
cd voucherboard
npm install
npm test          # parsers, planner and UI against saved pages
npm run package   # dist/voucherboard-<version>.zip
```

Do not commit HAR files: they contain session cookies.

## Copyright

© 2026 Marius Rubin. All rights reserved, including all commercial rights. Personal, non-commercial, revocable use of this beta only. Use is entirely at the user's own risk; see [`voucherboard/LICENSE`](voucherboard/LICENSE) and the terms in the extension.
