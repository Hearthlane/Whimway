# Official Maestro conversion evidence

Recorded 15 October 2026 using the official Maestro CLI 2.11.0 classes. These compact original logs establish YAML-to-command conversion, not execution on Android or iOS.

- `original-ad9-full-conversion.log`: six of twelve graphs fail when imported dynamic swipe coordinates are eagerly converted to numbers. The nested exception names `${output.whimwayPlanViewport.swipe.start}` at `helpers/scroll-ios-plan.yaml:7:3`.
- `current-full-conversion.log`: all twelve corrected graphs convert successfully.
- `original-ad9-shallow-check.log`: the shallow CLI check incorrectly reports `OK` for the broken graph. It is not the compilation gate.
- `parser-provenance.json`: exact commands, official release and tool hashes, converter source hash and input-flow hashes. Paths under `native-results/` identify local reproduction inputs; downloaded binaries and generated classes are deliberately excluded from this retained evidence.
- `java-version.log` and `maestro-version.log`: actual tool versions used.
- `hosted-conversion-excerpt.log`: selected unmodified lines from [syntax job 116663699890](https://github.com/Hearthlane/Whimway/actions/runs/38805051576/job/116663699890), showing CLI 2.11.0, the official converter and twelve successful graphs before platform compilation. This is an excerpt, not the full job log.

The original graph is from `ad9b7819415ddbbf8c2eb607bcc37b8aa0eb02a3`; the corrected graph is included in `2983b7bd344d6673c34c4fdb0b4e3d19e38ffe5f`. The corrected native gestures and viewport checks still require actual hosted runtime evidence.
