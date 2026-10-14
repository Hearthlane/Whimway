# Mobile visual evidence

Browser captures were created locally on 13–14 October 2026 with Playwright Chromium. Native simulator captures are separately identified below. These are development/QA evidence, not store screenshots. The source audit and outstanding device checks are in [mobile-audit.md](../mobile-audit.md) and [mobile-checklist.md](../mobile-checklist.md).

`baseline/` contains the retained Next.js frontend at 390 × 844, with explicit synthetic development fixtures where needed. `observations.json` records original page height and horizontal overflow measurements. Reproduce with the fixture backend running and `node scripts/capture-web-audit.mjs`.

`mobile-preview/` contains the actual React Native screen source rendered through RN Web from an official development export. The local QA server forwards same-origin API requests to the existing backend. Discovery, generation, successful hydration and edits use its explicit synthetic fixture adapter; no live Places/photos/routes or AI success is implied. The complete-prompt test mocks a validated `/api/intent` response because OpenAI credentials are absent. The separate missing-intent test exercises the actual unavailable-service response. Recovery tests additionally hold/abort requests or mock explicit `LOCK_CONFLICT` and provider-timeout failures; successful unlocked retry returns to the actual fixture backend. These mocks exercise UI failure/cancellation behavior, not provider availability.

| Evidence                                               | Capture                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Explore hierarchy and persistent navigation            | `explore-375.png`, `explore-360.png`, `explore-390.png`, `explore-412.png`, `explore-430.png` |
| Focused search with the single lavender focus ring     | `explore-search-focused-375.png`                                                              |
| Adaptive questions and supplied prompt facts           | `planner-interests-390.png`, `planner-energy-390.png`, `planner-prompt-prefill-390.png`       |
| 200% browser text approximation at 375 × 667           | `planner-large-text-top-preview-375.png`, `planner-large-text-preview-375.png`                |
| Itinerary summary, stop cards and selected marker      | `plan-390.png`, `itinerary-stops-390.png`, `itinerary-selected-stop-390.png`                  |
| Explicit native-map limitation and stop selection      | `plan-map-preview-390.png`, `plan-map-selected-390.png`                                       |
| Active outing and persistent progress                  | `day-390.png`                                                                                 |
| Guest collection and real hydrated favorite references | `saved-empty-430.png`, `saved-plan-390.png`, `favorite-places-390.png`                        |
| Profile preferences and optional account               | `profile-430.png`                                                                             |
| Opt-in reminders and recoverable errors                | `reminders-390.png`, `generation-error-390.png`, `location-denied-preview-390.png`            |
| Device-only personal preferences and avoided places    | `profile-personal-preferences-390.png`                                                        |
| Allowlisted local diagnostics without private input    | `diagnostics-privacy-390.png`                                                                 |
| Hard zero-budget fixture plan                          | `free-plan-390.png`                                                                           |
| Network retry and explicit locked-stop recovery        | `saved-reopen-network-error-390.png`, `saved-lock-conflict-390.png`                           |
| Field-specific validation inside the active edit sheet | `editing-field-error-390.png`                                                                 |
| Portrait canvas and sheet inside a wide browser window | `explore-portrait-canvas-1280.png`, `profile-portrait-sheet-1280.png`                         |

RN Web uses an internal scroll view, so these captures show the viewport or selected scroll position rather than measuring the entire native screen's content height. Enlarged browser text is a layout sample, not an Android/iOS fontScale or VoiceOver/TalkBack test. Placeholder stop photographs are explicitly labeled synthetic; map fallback lists are not live maps. Real device checks must cover native safe areas, keyboards, maps/attribution, OS location and notification dialogs, hardware back, gestures, process recovery and performance.

The portrait revision adds `explore-portrait-canvas-1280.png` and `profile-portrait-sheet-1280.png`: the native-source web canvas and modal remain centered and at most 430 pixels wide in a 1280-pixel window. The phone Explore set now presents place/idea entry modes. At 375 × 667, the complete primary CTA appears above the tabs with space to spare. These 32 Playwright captures were refreshed by source `99228dd`'s successful 18-case local run; `portrait-preview-375-cua.png` is an additional settled in-app-browser capture of that preview. Successful native baseline captures below predate this layout revision.

## Initial actual iOS simulator capture

`native-ios/explore-869a8fb.png` is a 1206 × 2622 screenshot from the actual installed iOS Release simulator app in [native run 38489794771](https://github.com/Hearthlane/Whimway/actions/runs/38489794771), commit `869a8fb3dc033bd6180c292aad89d5e458c98353`. The `ios-native-simulator-app` artifact (ID `11862510795`) includes this image, the unsigned `.app` archive and `launch.txt` showing `com.example.whimway: 83217`. Compile, install, launch and upload succeeded before the overall job was cancelled during post-setup-node cleanup.

This capture proves the initial native Explore launch, including its actual safe area and persistent tabs. It exposed Apple rendering the text asterisk as a green emoji badge; current source replaces that glyph with a coral vector icon and permits header wrapping. The screenshot intentionally preserves the observed older source. It does not prove the subsequent brand fix, complete native journeys, live providers, signed device distribution or final-source runtime behavior.

## Corrected-brand native iOS baseline

`native-ios/explore-b14ea069.png` is the reviewed 1206 × 2622 native Release simulator capture from [run 38493548057](https://github.com/Hearthlane/Whimway/actions/runs/38493548057), commit `b14ea069d0ac405451eef728f91f50ee24b4a19d`, artifact `ios-native-simulator-app` / `11864120308`. Installation/launch succeeded (`com.example.whimway: 89985`); the coral vector now renders correctly. App/configuration/contracts/runtime-flow sources are identical to quality-verified `17db8ee`; only workflow job gating and its detection helper differ.

This is corrected-brand first-launch/visual evidence. It predates the later question-scroll fix and does not establish complete native outings, live-provider maps, notification delivery or signed-device release. Final iOS development-client journey reports remain pending at this update.

## Android native journey captures

`native-android/explore-77d776a.png` is an actual 1080 × 2400 Android development-client capture from [run 38498340854](https://github.com/Hearthlane/Whimway/actions/runs/38498340854), commit `77d776ab22661b848380136130d3a6f99104b57e`, artifact `android-native-runtime` / `11863834151`. The API 34 Android 14 emulator reports density 420. The reviewed image shows the current coral vector and real native controls; it was taken immediately after entering the app, before the tab layout settled. Later trace/taps confirm Saved/Profile and a later screenshot shows the tabs.

That attempt exercised denied location, Saved/Profile and a native keyboard edit, then failed because the test dismissed the keyboard twice and navigated back. It is partial native evidence, superseded by the settled main-smoke set below; the image is not a store screenshot or a live-provider claim.

`native-android/9c2b782/` contains the subsequently completed Android main-smoke captures from [run 38499232558](https://github.com/Hearthlane/Whimway/actions/runs/38499232558), artifact `11864984178`: settled Explore with tabs, local preferences, fixture itinerary, actual software keyboard, in-sheet validation error, reminder denial, Day progress and progress after process restart. The main flow completed without a failed command. The independent reminder-cancellation and actual `font_scale=2.0` flows still required focused fixes; this set does not imply those follow-ups or live providers passed.

## Android c405 baseline: real large text and standalone Release

`native-android/c4059b8/` is retained from [run 38505573662](https://github.com/Hearthlane/Whimway/actions/runs/38505573662), commit `c4059b80fec8c28cc6cb83ccba093bf4b31ec677`, runtime artifact `11869161796`. Its product source matches `26107a6`; these captures predate the subsequent portrait/progress revision. Actual Android 14/API 34 emulator output is 1080 × 2400 at density 420 (approximately 411 × 914 logical pixels).

| Retained files                   | Observed evidence                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/` (nine PNGs)              | Settled Explore/Profile, selected energy, itinerary, keyboard, in-sheet validation, reminder denial, Day progress and process restore; 129 commands completed, seven branches skipped, none failed |
| `font-2/` (five PNGs)            | Actual OS `font_scale=2.0`: Explore, energy, itinerary, sheet and Day; 63 commands completed, five skipped, none failed. Long text wraps and sheet controls remain scroll-reachable                |
| `release/` (four PNGs)           | Standalone embedded-source Release Explore/Profile/Saved, without Metro or fixture controls; 24 completed, one skipped, none failed                                                                |
| `native-reminders-scheduled.png` | Actual fixture scheduling count of five. The later Cancel target was below the viewport and the test failed; this image does not establish successful cancellation or delivery                     |
| `android-planning-motion.mp4`    | 73.87-second native Debug recording of location entry, question/Back/energy transitions and itinerary reveal. The low bitrate causes visible blockiness; use PNGs for visual fidelity              |

The recording and frame/memory diagnostics came from a hosted SwiftShader software emulator, not a physical phone. They are not proof of 60 fps, battery use or haptics. Native maps remain explicitly unavailable because SDK keys are absent. The independent reminder test and all three iOS flows failed their test helpers, so the overall workflow is not recorded as passed. Exact binary provenance, counts, failures and measured limits are in [mobile-checklist.md](../mobile-checklist.md).
