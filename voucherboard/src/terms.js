// Terms of use. Shown before first use and whenever VERSION changes; acceptance is stored on the device only.
(function (root) {
  "use strict";
  const VERSION = "2026-10-08";
  const OWNER = "Marius Rubin";
  const SUPPORT_EMAIL = "voucherboard@mariusrubin.com";
  const PRIVACY_URL = "https://maubergine.github.io/voucherboard/privacy.html";
  const SUPPORT_URL = "https://maubergine.github.io/voucherboard/support.html";

  const html = `
<p class="t-lead">Please read these terms. You must accept them before using Voucherboard. If you don't accept them, don't use it.</p>

<h4>1. Ownership</h4>
<p>Voucherboard, including its code, design, look and feel, screens, text, documentation, name and logo, is wholly the intellectual property and copyright of ${OWNER}. © 2026 ${OWNER}. All rights reserved. All intellectual property rights in it, anywhere in the world, belong to ${OWNER}, and nothing in these terms transfers any of them to you.</p>
<p>${OWNER} reserves all commercial rights, including the exclusive right to sell, license, rent, subscribe, host, distribute or otherwise commercialise Voucherboard or any product or service based on it, now or in the future.</p>

<h4>2. Your licence</h4>
<p>${OWNER} gives you a limited, personal, non-exclusive, non-transferable, revocable, free licence to install and use this version in your own browser or on your own phone, only to manage your own or your household's visitor parking permits, and not for any commercial purpose. The licence lasts until it ends under section 4. All rights not expressly given to you are reserved.</p>
<p>You must not, and must not help, allow or ask anyone else to:</p>
<ul>
  <li>copy or reproduce Voucherboard or any part of it, except the copying that happens automatically when you install and run it;</li>
  <li>modify, adapt, translate or build on it, or make any product, service or work based on or derived from it;</li>
  <li>reverse engineer, decompile, disassemble or extract its source code, except to the extent the law expressly allows and doesn't let this be excluded;</li>
  <li>share, publish, distribute, sell, rent, lease, lend, sublicense, host or otherwise make it available to anyone else, including by uploading it to any website, code repository, extension store or app store;</li>
  <li>use it for or on behalf of anyone else for payment or reward, or in any business;</li>
  <li>use it, its design, features or way of working, or any knowledge gained from using or inspecting it, to create, help create or improve any product or service that competes with it;</li>
  <li>use it or its code to train or improve any artificial intelligence or machine learning system;</li>
  <li>remove, hide or change any copyright, ownership or terms notice in it;</li>
  <li>get around, disable or interfere with any limit, update, notice or other control in it.</li>
</ul>
<p>If you send ${OWNER} any suggestion, idea or feedback, ${OWNER} may use it freely, for any purpose including commercial ones, without owing you anything.</p>
<p>If you break this section, your licence ends immediately and without notice. You must then stop using Voucherboard and delete every copy you hold. ${OWNER} may take any action available in law, including seeking an injunction to stop the breach, damages or an account of profits, and costs.</p>

<h4>3. A product still being developed</h4>
<p>Voucherboard is provided free of charge, and it is still being developed. It may be incomplete, contain errors, change, or not work as described. Features marked as experimental are the least tested.</p>

<h4>4. Ending or replacing this version</h4>
<p>${OWNER} may, at any time and for any reason, with or without notice:</p>
<ul>
  <li>end or suspend your licence, or everyone's licence;</li>
  <li>withdraw, change or stop providing this version;</li>
  <li>make this version stop working, including by an update;</li>
  <li>tell you to stop using this version, whether through Voucherboard, the place you got it from, or directly.</li>
</ul>
<p>When your licence ends, or you are told to stop using this version, you must stop using it and uninstall and delete it. Future versions may be offered on different terms, including for a fee or subscription. You have no right to keep using this version, to receive any future version, or to any future version being free. Nothing obliges ${OWNER} to release any future version, and no compensation is payable when this version ends. Sections 1, 2 (apart from your right to use Voucherboard), 4, 6 to 9, 11 and 13 continue to apply after your licence ends.</p>

<h4>5. Independent tool</h4>
<p>Voucherboard is not made, endorsed, supported or checked by Lewisham Council or its suppliers. It works with the council's website using your own logged-in session, in your browser or in the Voucherboard app. Every booking, cancellation, change and purchase is made on your council account and is subject to the council's own terms and conditions.</p>

<h4>6. Use entirely at your own risk</h4>
<p>Voucherboard is provided "as is" and "as available", without any warranty of any kind, express or implied, including any warranty that it is accurate, complete, reliable, fit for a particular purpose or free of errors. Use of Voucherboard is entirely at your own risk.</p>

<h4>7. No liability</h4>
<p>To the fullest extent permitted by law, ${OWNER} accepts absolutely no liability whatsoever, in contract, tort (including negligence) or otherwise, for any loss, damage, cost or expense of any kind, direct or indirect, that may occur in association with use of, or inability to use, Voucherboard. This includes penalty charge notices, fines, clamping, removal or storage fees, lost, wasted or unnecessary vouchers, payments, bank charges and time. It includes, but is not limited to, loss due to:</p>
<ul>
  <li>incorrect booking of vouchers, including the wrong vehicle, number plate, permit, date, start time or length;</li>
  <li>failure to cancel or modify bookings, or cancelling or changing bookings you meant to keep;</li>
  <li>incorrect allocation of hours, or of different voucher types, including using more expensive vouchers than needed;</li>
  <li>any other malfunction, error, bug or unexpected behaviour of Voucherboard;</li>
  <li>any of the above in the event of a partial transaction, where a booking run, change, cancellation or purchase completes only in part (for example, an old booking is cancelled but its replacement isn't booked);</li>
  <li>incorrect, incomplete or outdated information about zones, controlled hours, bank holidays or prices, and bookings for times that aren't in fact covered on the street;</li>
  <li>changes to, errors in, or unavailability of the council's website, or the council refusing, delaying, changing or reversing a booking, cancellation or purchase;</li>
  <li>timing problems, including a wrong clock or time zone on your device, or a booking starting later than planned because its start time had passed;</li>
  <li>loss of connection, or your browser, phone, the Voucherboard app or the council's website closing, pausing, logging you out or failing part-way through;</li>
  <li>cost, saving or purchase suggestions being wrong, and any purchase you make on the council's website;</li>
  <li>adding, changing or deleting favourite vehicles on your council account;</li>
  <li>booking confirmation emails not being sent, received or correct;</li>
  <li>test mode results differing from what happens when booking for real;</li>
  <li>Voucherboard still being developed, and any feature marked as experimental, such as ending a booking in progress early;</li>
  <li>this version, or your licence, ending, being withdrawn or stopping working under section 4;</li>
  <li>plans, settings or other data stored in your browser or on your phone being lost or wrong;</li>
  <li>the council suspending, restricting or closing your account, or taking any other action, because you used Voucherboard;</li>
  <li>any change to the council's website, or to its terms and conditions, that allows, restricts or prohibits use of Voucherboard, or that stops it working in whole or in part;</li>
  <li>Voucherboard not being supported, updated, fixed or made available, or stopping working at any time.</li>
</ul>

<h4>8. Support</h4>
<p>You can ask for help by email at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. Help is given on a best-effort basis. There is no service level or other commitment for help, fixes, updates, maintenance or compatibility. ${OWNER} has no obligation to correct errors, respond to reports, keep Voucherboard working with the council's website, or keep it available. It may stop working, or be changed or withdrawn, at any time without notice.</p>

<h4>9. The council's website and terms</h4>
<p>It is your responsibility to check that the council's website terms and conditions allow you to use Voucherboard, now and whenever they change. ${OWNER} makes no statement that they do, and accepts no liability for any change to the council's website or its terms that allows, restricts or prohibits use of Voucherboard, or for any consequence of using it where they don't allow it.</p>

<h4>10. Your responsibilities</h4>
<p>You are responsible for every booking, change, cancellation and purchase made with Voucherboard. Check the result of each one on the council's website (its Active permits list) before relying on it. You remain responsible for making sure every vehicle is correctly covered, and for following street signs and parking rules.</p>

<h4>11. What these terms don't limit</h4>
<p>Nothing in these terms excludes or limits any liability that can't be excluded or limited by law, such as liability for death or personal injury caused by negligence, or for fraud.</p>

<h4>12. Your data</h4>
<p>Voucherboard runs only on your device: in your browser, or in the Voucherboard app on your phone. It talks only to the council's website, using your own session. It never reads, stores or sends your password or card details. Your plans, settings and reminders are stored on your device. Reminders are notifications your phone shows; they aren't sent from anywhere. If you scan a number plate, the picture is read on your phone and isn't kept or sent anywhere. Nothing is sent to ${OWNER} or anyone else. The privacy policy is at <a href="${PRIVACY_URL}">${PRIVACY_URL}</a>.</p>

<h4>13. Changes and law</h4>
<p>These terms may change. If they do, you'll be asked to accept them again before using Voucherboard. These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.</p>
<p class="t-ver">Version ${VERSION}.</p>`;

  const api = { VERSION, OWNER, SUPPORT_EMAIL, PRIVACY_URL, SUPPORT_URL, html };
  root.VB = root.VB || {};
  root.VB.terms = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
