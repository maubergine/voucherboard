# Voucherboard (beta)

Beta software. A browser extension that replaces the booking screens of Lewisham's visitor parking permit site (`parkingpermits.lewisham.gov.uk`) with a planner. It books several days, vehicles and hours in one go, skips hours outside the zone's controlled times, and shows voucher costs from prices read live from the site. It runs only in the user's own logged-in tab, with no server, and makes the same requests as the council's own pages.

## Layout

| Path | Purpose |
| --- | --- |
| `extension/` | The browser extension, and only what ships: `manifest.json`, `src/`, `icons/`, and the bundled `guide/` (source `guide/README.md`). Chrome's Load unpacked points here. See [`extension/README.md`](extension/README.md), including the request sequence used to book. |
| `apps/mobile/` | The phone apps: the shared engine (`www/`, `council/`, [`BRIDGE.md`](apps/mobile/BRIDGE.md)) and the iOS and Android apps (`ios/`, `android/`). |
| `apps/safari/` | Voucherboard for Safari: the macOS app holding the extension. It copies `extension/` at build time. |
| `site/` | The website's sources (install, privacy, support, accessibility). `pages.yml` builds them with the guide and deploys to https://voucherboard.mariusrubin.com. |
| `docs/` | Developer and release notes. Not published. |
| `scripts/` | Packaging, the website and guide renderers, `dev.sh` for every platform build. |
| `test/` | Node tests, and anonymised saved pages in `fixtures/`. |
| `ci/` | `ci/local.sh`: the CI workflows run locally with act ([`ci/README.md`](ci/README.md)). |
| `dist/` | (Ignored) release files: the zips and `SHA256SUMS`. |
| `build/` | (Ignored) everything else a build makes: Xcode build data, staging folders, logs, the built site. |

Every release on GitHub carries `voucherboard-chrome-<version>.zip` (Chrome Web Store), `voucherboard-chrome-<version>-unpacked.zip`
(Load unpacked), `voucherboard-firefox-<version>.zip` (AMO), `voucherboard-safari-<version>.zip` when the Safari app changed, and
`SHA256SUMS` covering them. See [docs/RELEASING.md](docs/RELEASING.md).

## Getting started

Install steps for every browser and phone are at https://voucherboard.mariusrubin.com/install.html, and the guide is at https://voucherboard.mariusrubin.com/guide/.

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/voucherboard-beta/cldhejnblckejbeebjidikhebdfnncak) (Chrome, Edge or Brave), then log in at `https://parkingpermits.lewisham.gov.uk` and tap **Voucherboard** in the bottom-right corner.

For development, load it unpacked instead:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. Log in at `https://parkingpermits.lewisham.gov.uk` and tap **Voucherboard** in the bottom-right corner.

The extension starts in live mode. Test mode, in Settings, runs every check against the site but never sends the final booking request. Safari and the phone apps: [docs/DEVELOPING.md](docs/DEVELOPING.md).

Develop, from the repository root:

```sh
npm install
npm test          # parsers, planner and UI against saved pages
npm run dist      # dist/: the Chrome and Firefox zips, and SHA256SUMS
npm run site      # build/site: the website
ci/local.sh       # the CI workflows, locally (Docker and act)
```

To build Firefox, Safari, iOS and Android, and run the phone apps in a simulator or emulator, use
`scripts/dev.sh`: see [docs/DEVELOPING.md](docs/DEVELOPING.md).

Do not commit HAR files: they contain session cookies.

## Copyright

© 2026 Marius Rubin. All rights reserved, including all commercial rights. Personal, non-commercial, revocable use of this beta only. Use is entirely at the user's own risk; see [`LICENSE`](LICENSE) and the terms in the extension.
