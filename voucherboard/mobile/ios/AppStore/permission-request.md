# Request for written confirmation (council and NSL)

Apple guideline 5.2.2 says an app that uses a third-party service must be "specifically permitted to do so under the
service's terms of use. Authorization must be provided upon request." Nothing published grants or refuses that for
the permit site (see `REVIEW_BRIEF.md`, section 7). A short written reply from the council or NSL is the strongest answer
App Review can be given.

**Before sending, decide.** Asking could get a "no", or a request to stop the Chrome extension as well. Not asking leaves
you relying on the published terms being silent, and Apple may still ask for authorisation. See `docs/APP_STORE.md`,
step 1.5.

**Send to:**

- Lewisham Council parking services: the parking permits contact on https://lewisham.gov.uk/myservices/parking (use the
  web form or email address listed there on the day you send).
- NSL, which runs the site: `lewishamparkingpermits@nslservices.co.uk` (the contact the permit site gives).

Keep a dated copy of what you send and every reply, as a PDF, outside the repo.

---

**Subject:** Permission to use an independent app with the visitor parking permit site

Dear Parking Services,

I'm a Lewisham resident with a visitor parking permit. I've written a free app, Voucherboard, that helps residents
plan their visitor vouchers on parkingpermits.lewisham.gov.uk. It's available as a Chrome extension, and I'd like to
publish it for iPhone on the App Store.

How it works:

- Residents sign in on the council's own sign-in page. The app never sees or stores their password or card details.
- It makes the same requests as the site's own booking, cancellation and favourites pages, in the resident's own
  session, one at a time and half a second apart. Every booking is checked by the site as usual.
- Residents buy vouchers on the council's own pages. The app only fills in the voucher type and number.
- It has no server, collects no data, and is free with no adverts. It says clearly that it isn't made or endorsed by
  the council.

It lets residents book several visits at once, books only the hours their zone controls, and reminds them before a
visitor's time runs out. That should mean fewer wasted vouchers and fewer penalty charges.

Apple asks app developers to confirm that a service's owner permits this kind of use. Could you confirm that residents
may use Voucherboard to manage their own visitor permits on the site? If there are conditions you'd like me to follow,
such as request limits, please tell me.

I'm happy to give a demo or answer any questions.

Yours faithfully,

Marius Rubin
voucherboard@mariusrubin.com
