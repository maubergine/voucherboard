# Google Play material

Everything Play Console asks for, kept in the repo so it's reviewed like code. The steps that use it are in
[`docs/GOOGLE_PLAY.md`](../../../../docs/GOOGLE_PLAY.md). `test/playstore.test.js` checks the listing's lengths and
wording. The iOS listing is in [`../../ios/AppStore/`](../../ios/AppStore/README.md); keep the two saying the same thing.

| File | Goes in Play Console at | Notes |
| --- | --- | --- |
| `metadata/android/en-GB/title.txt` | Grow users > Store presence > Main store listing > App name | 30 characters |
| `metadata/android/en-GB/short_description.txt` | Main store listing > Short description | 80 characters |
| `metadata/android/en-GB/full_description.txt` | Main store listing > Full description | 4,000 characters. Names its sources and says it doesn't represent the council (government information policy). Never says "beta" |
| `metadata/android/en-GB/changelogs/default.txt` | Release > Release notes (en-GB) | 500 characters. CI uploads it with each draft |
| `metadata/android/en-GB/images/icon.png` | Main store listing > App icon | 512 × 512, from the iOS icon (`screenshots.md`) |
| `category.txt` | Store settings > App category | |
| `contact_email.txt`, `website_url.txt` | Store settings > Store listing contact details | The email is shown publicly on the listing |
| `privacy_url.txt` | Policy and programs > App content > Privacy policy | GitHub Pages, built from `site/PRIVACY.md` |
| `support_url.txt` | Not a Play field; the listing's website and the app's More screen link to it | |
| `review_information/app_access.txt` | App content > App access > instructions | Demo mode, no credentials. Trim to the field's counter if Play limits it |
| `data-safety.md` | App content > Data safety | No data collected or shared, and why |
| `content-rating.md` | App content > Content rating (IARC questionnaire) | Expect PEGI 3 |
| `screenshots.md` | Main store listing > Graphics | Shot list, sizes, feature graphic |

Shared with iOS, not copied:

- `../../ios/AppStore/REVIEW_BRIEF.md`: the full case (features, original work, the council's terms). Play has no
  attachment field; keep it ready to paste from if Play's review asks.
- `../../ios/AppStore/permission-request.md`: the letter to the council and NSL. One reply covers both stores.

The `metadata/android/` layout matches fastlane's `supply`, in case uploading the listing is automated later.

When the app changes, check the description and screenshots still match it: Play rejects listings that show
features the app doesn't have (Misleading Claims, and Metadata policy).
