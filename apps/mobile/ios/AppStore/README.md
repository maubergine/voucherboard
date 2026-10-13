# App Store material

Everything App Store Connect asks for, kept in the repo so it's reviewed like code. The steps that use it are in
[`docs/APP_STORE.md`](../../../../docs/APP_STORE.md). `test/appstore.test.js` checks the listing's lengths and wording.

| File | Goes in App Store Connect at | Notes |
| --- | --- | --- |
| `metadata/en-GB/name.txt`, `subtitle.txt` | App Information | 30 characters each |
| `metadata/en-GB/primary_category.txt`, `secondary_category.txt` | App Information > Category | |
| `metadata/en-GB/description.txt` | Version > Description | 4,000 characters. Never says "beta" (guideline 2.2) |
| `metadata/en-GB/promotional_text.txt` | Version > Promotional Text | 170 characters. Can change without a new review |
| `metadata/en-GB/keywords.txt` | Version > Keywords | 100 characters, commas, no spaces |
| `metadata/en-GB/release_notes.txt` | Version > What's New | Updates only |
| `metadata/en-GB/support_url.txt`, `marketing_url.txt` | Version > Support URL, Marketing URL | GitHub Pages, built from `SUPPORT.md` |
| `metadata/en-GB/privacy_url.txt` | App Privacy > Privacy Policy URL | GitHub Pages, built from `PRIVACY.md` |
| `review_information/notes.txt` | App Review Information > Notes | 4,000 characters |
| `REVIEW_BRIEF.md` | App Review Information > Attachment, as a PDF | The full case: features, iPhone capabilities, original work, terms, data. Remove the `[OWNER: …]` notes first |
| `privacy-labels.md` | App Privacy | Data Not Collected, and why |
| `age-rating.md` | App Information > Age Rating | 4+, once the council view is locked to the council site |
| `screenshots.md` | Version > Previews and Screenshots | Shot list, sizes, how to capture in demo mode |
| `permission-request.md` | Not uploaded | Letter asking the council and NSL for written permission (guideline 5.2.2) |

The `metadata/` layout matches fastlane's `deliver`, in case uploading the listing is automated later.

When the app changes, check the description, `REVIEW_BRIEF.md` sections 3 and 4, and the screenshots still match it.
Apple rejects listings that show features the app doesn't have (guideline 2.3).
