# Screenshots and preview

Real screens from the app, running in demo mode (pinned to Monday 28 September 2026, 10:30, with the test fixtures), so
no real plates, permit numbers or council pages appear. Same order on every device size. Captions are short, sentence case,
and state what the user gets.

| # | Screen | Caption | Shows |
| --- | --- | --- | --- |
| 1 | Today | Who's parked now, and what's next | On now card with countdown and Extend, next 7 days, favourites |
| 2 | Book a visitor (days) | A week of visits in one go | Quick picks (Rest of this week, Every Wednesday for 4 weeks), several days ticked |
| 3 | Review run | Check it, then book it all | The review sheet: N vouchers, controlled hours only, test mode note |
| 4 | Lock Screen Live Activity | Extend from your Lock Screen | Live Activity with plate, countdown and Extend |
| 5 | Reminder notification | A nudge before a voucher runs out | "VW55 XYZ: voucher ends at 11:00", Extend 1 hour action |
| 6 | Scan with camera | Scan a number plate | The live scanner highlighting a plate (use a demo plate, not a real car's) |
| 7 | Board (landscape) | Your whole week at a glance | The week board with controlled hours shaded |
| 8 | Calendar | Every booking and plan | Calendar month with booked and planned days |
| 9 | Plan with purchase advice | Know when to buy, and what | Purchase advice "Buy 2 × 5 hours on council site" |
| 10 | More | Test mode, reminders and your zone | Settings with Test mode and zone hours |

Rules that keep review simple:

- **No council branding.** Don't show the council's logo or its site in any screenshot. The sign-in screen is the
  council's own page, so leave it out.
- **No real data.** Fixture plates only (`TU44 VWX`, `VW55 XYZ` and so on), never a real person's plate.
- **Status bar.** Use the Simulator's clean status bar:
  `xcrun simctl status_bar booted override --time 10:30 --batteryState charged --batteryLevel 100 --cellularBars 4`.
- **Accurate.** Apple rejects screenshots that show features the app doesn't have (guideline 2.3.3). Every caption above
  matches a feature in this build.

## Sizes

App Store Connect needs one set for the largest iPhone and scales it down for smaller ones. Check the current
"Screenshot specifications" page before capturing, as Apple changes the required sizes.

- **iPhone 6.9"** (the largest current iPhone Simulator): 1320 × 2868 portrait, or 2868 × 1320 landscape for screenshot 7.
- **iPad 13"**: needed only if the app ships for iPad (`TARGETED_DEVICE_FAMILY` includes 2). The first release is
  iPhone only (see `docs/APP_STORE.md`), so none.

## Capturing

1. Build the app for the largest iPhone Simulator with demo mode on.
2. Set the clean status bar (above).
3. `xcrun simctl io booted screenshot 01-today.png`, and so on.
4. For the Live Activity and notification, lock the Simulator (Device > Lock) after a Book now in demo mode.

An optional App Preview video (15 to 30 seconds) can show the run: Book a visitor, Review, the progress, then the Live
Activity. Record with `xcrun simctl io booted recordVideo preview.mov`.
