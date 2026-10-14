# Browser visual evidence

Captured locally on 13 October 2026 with Playwright Chromium. These images are browser artifacts, not device or store screenshots. The source audit and outstanding device checks are in [mobile-audit.md](../mobile-audit.md) and [mobile-checklist.md](../mobile-checklist.md).

`baseline/` contains the retained Next.js frontend at 390 × 844, with explicit synthetic development fixtures where needed. `observations.json` records original page height and horizontal overflow measurements. Reproduce with the fixture backend running and `node scripts/capture-web-audit.mjs`.

`mobile-preview/` contains the actual React Native screen source rendered through RN Web from an official development export. The local QA server forwards same-origin API requests to the existing backend. Discovery, generation, hydration and edits use its explicit synthetic fixture adapter; no live Places/photos/routes or AI success is implied. Only the complete-prompt test mocks a validated `/api/intent` response because OpenAI credentials are absent. The separate missing-intent test exercises the actual unavailable-service response.

| Evidence                                               | Capture                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Explore hierarchy and persistent navigation            | `explore-375.png`, `explore-360.png`, `explore-390.png`, `explore-412.png`, `explore-430.png` |
| Adaptive questions and supplied prompt facts           | `planner-interests-390.png`, `planner-energy-390.png`, `planner-prompt-prefill-390.png`       |
| 200% browser text approximation at 375 × 667           | `planner-large-text-top-preview-375.png`, `planner-large-text-preview-375.png`                |
| Itinerary summary, stop cards and selected marker      | `plan-390.png`, `itinerary-stops-390.png`, `itinerary-selected-stop-390.png`                  |
| Explicit native-map limitation and stop selection      | `plan-map-preview-390.png`, `plan-map-selected-390.png`                                       |
| Active outing and persistent progress                  | `day-390.png`                                                                                 |
| Guest collection and real hydrated favorite references | `saved-empty-430.png`, `saved-plan-390.png`, `favorite-places-390.png`                        |
| Profile preferences and optional account               | `profile-430.png`                                                                             |
| Opt-in reminders and recoverable errors                | `reminders-390.png`, `generation-error-390.png`, `location-denied-preview-390.png`            |

RN Web uses an internal scroll view, so these captures show the viewport or selected scroll position rather than measuring the entire native screen's content height. Enlarged browser text is a layout sample, not an Android/iOS fontScale or VoiceOver/TalkBack test. Placeholder stop photographs are explicitly labeled synthetic; map fallback lists are not live maps. Real device checks must cover native safe areas, keyboards, maps/attribution, OS location and notification dialogs, hardware back, gestures, process recovery and performance.
