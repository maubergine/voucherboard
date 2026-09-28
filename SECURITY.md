# Security

Voucherboard runs in your logged-in browser tab against the council's own site and stores
your plan locally; there's no server. If you've found a security issue — for example a way
the extension could leak credentials, tokens, or make requests to anything other than
`parkingpermits.lewisham.gov.uk` — please report it privately rather than opening a public issue.

Use GitHub's private vulnerability reporting for this repository:
https://github.com/maubergine/voucherboard/security/advisories/new

Please don't test destructive actions (cancel, delete a favourite, buy) against the live
council site as part of a report.
