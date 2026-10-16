# Android reset snapshots, hosted run 38670492664

These four files are unmodified bytes from Android native job `116212272483`,
artifact `11944133898`, source revision `1bc`, API 34 / Android 14. Both resets
failed before launching the app, with no package process, task, or activity.
The sole Whimway reference is an AppWarnings package-dialog dismissal queued
after data clearing. The matching reset evidence reported `prepared: false`,
no observations, and `Unrecognized package-specific Android task state.`

Original artifact paths are relative to `native-test-artifacts/android-reset/`:

| Fixture                   | Original path                        | SHA-256                                                            |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `smoke/processes.txt`     | `smoke/004-processes.stdout.txt`     | `5cceb8282290a8583245c83bab255ef6c2d43faf416f42ec581802a66efaed55` |
| `smoke/tasks.txt`         | `smoke/005-tasks.stdout.txt`         | `05bd28582beefb51437f51c448a52975362633c6f2a089e291efb28c106fec07` |
| `reminders/processes.txt` | `reminders/004-processes.stdout.txt` | `21382ce43bab279892f88b39be14d94d0bc52a015d5289b8301931145fe0e06a` |
| `reminders/tasks.txt`     | `reminders/005-tasks.stdout.txt`     | `85391c77ae96af10b122bb72870e4f6f69fa1e9e796c616cf0e24281560723f6` |

The smoke queue row has index 11, `when=-87ms`, and `what=4`; reminders has
index 12, `when=-142ms`, and `what=4`. The queue index is separate from the
handler message type. [AOSP Android 14 MessageQueue.java, lines 850–861](https://github.com/aosp-mirror/platform_frameworks_base/blob/android14-release/core/java/android/os/MessageQueue.java#L850-L861)
prints each message with its queue ordinal. [AOSP Android 14 AppWarnings.java,
lines 411–473](https://github.com/aosp-mirror/platform_frameworks_base/blob/android14-release/services/core/java/com/android/server/wm/AppWarnings.java#L411-L473)
defines handler type 4 as `MSG_HIDE_DIALOGS_FOR_PACKAGE`, takes a package-name
string, and dispatches warning dismissal. Its
[`onPackageDataCleared` / `removePackageAndHideDialogs` path, lines 209–240](https://github.com/aosp-mirror/platform_frameworks_base/blob/android14-release/services/core/java/com/android/server/wm/AppWarnings.java#L209-L240)
enqueues that action.

The helper excludes only this exact observed queue-row form from the unknown
package-reference check. It still observes original process/task/activity and
pending-kill data and requires two continuous quiet seconds. Changed message
types, handlers, callbacks, payloads, unknown timing/fields, or extra text fail
closed; an ActivityRecord payload still counts as a live activity. These are
recorded host fixtures, not evidence of a subsequent device run passing.
