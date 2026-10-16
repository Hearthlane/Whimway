# Maestro gesture transport fault proof

Recorded 15 October 2026 with the official Maestro 2.11.0 GraalJS/HTTP adapter, real loopback observer/broker servers and a simulated XCTest driver. This checks transport behavior; it does not execute a simulator gesture, UI journey or native Keychain call.

The preceding direct transport sends two `/swipeV2` POSTs when the simulated driver returns HTTP 408, despite rejecting a later manual script replay. The corrected broker sends one driver POST on both success and HTTP 408; the latter exposes an explicit script failure and rejects manual replay. The broker deduplicates the observation identity before dispatch. This deliberately injected fault was not observed in the current hosted native run.

`pre-broker-report.json` and `pre-broker-http408-jvm.log` retain the baseline. `report.json`, `success-jvm.log` and `http408-jvm.log` retain the corrected adapter results. `provenance.json` records exact source and tool hashes. All six files are copied without editing; downloaded tools and compiled classes are excluded. Actual native outcomes must remain independently verified.

The two small reproduction sources are retained byte-for-byte as `GraalHttpCheck.java.txt` and `run-check.mjs.txt`. Their hashes match the original filenames recorded in provenance. Restore those original names under the recorded ignored reproduction directory to use the exact local command; the saved Windows tool paths and downloaded runtime archives are prerequisites, not bundled files.
