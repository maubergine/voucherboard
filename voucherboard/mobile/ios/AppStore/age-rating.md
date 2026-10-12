# Age rating answers (App Store Connect > App Information > Age Rating)

Expected result: **4+**.

Apple's questionnaire has grown since 2025: the 13+, 16+ and 18+ ratings were added, with new questions on in-app
controls, capabilities, medical or wellness topics and violent themes (https://developer.apple.com/news/?id=ks775ehf).
Social media capability questions became required for new apps and updates from September 2026
(https://developer.apple.com/news/?id=tlur8uvi). Answer what the screen shows; the questions below are grouped as Apple
groups them, and every answer is the most restrictive "none" or "no".

| Group | Question | Answer | Why |
| --- | --- | --- | --- |
| Content | Cartoon or fantasy violence, realistic violence, prolonged graphic or sadistic violence | None | |
| Content | Profanity or crude humour, mature or suggestive themes, horror or fear themes | None | |
| Content | Sexual content or nudity, graphic sexual content | None | |
| Content | Alcohol, tobacco or drug use or references | None | |
| Content | Simulated gambling, contests | None | |
| Medical or wellness | Medical or treatment information, health or wellness topics | None / No | |
| Violent themes | Guns or other weapons | None | |
| In-app controls | Parental controls, age assurance | No | Not needed at 4+ |
| Capabilities | **Unrestricted web access** | **No** | See below |
| Capabilities | User-generated content | No | Nothing a user writes is shown to anyone else |
| Capabilities | Messaging and chat | No | |
| Capabilities | Advertising | No | |
| Social media | Is the app a social media app, or does it have social features (profiles, following, feeds, public posts) | No | |
| Gambling | Gambling (real money) | No | |
| Loot boxes | Loot boxes | No | |

## Unrestricted web access: why "No" needs a code change first

Apple's definition: "Users can navigate to any webpage within the app or freely browse the web"
(https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/).
That alone puts an app at 16+.

Today, while the council view is shown, `CouncilController.decidePolicyFor` allows any https page (so card and
3-D Secure pages load). A user who taps the council site's footer link to Marston's cookie policy can then browse
anywhere. Before submitting, the council view must:

- open links the user taps that lead off the council host in Safari, not in the app;
- still allow the redirects and form posts that payment and 3-D Secure use, only while the Buy flow is showing;
- open the council's account registration page in Safari as well, so the app doesn't appear to support account
  creation (guideline 5.1.1(v)).

With that in place, "No" is accurate: the app shows one site, plus the payment pages that site sends you to.
