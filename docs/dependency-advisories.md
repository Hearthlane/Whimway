# Dependency advisory review

Checked 13 October 2026 using npm audit and the official GitHub advisory records; audit counts and published package versions were rechecked on 14 October after aligning Expo to 57.0.29. Advisory counts include propagation through parent packages; they are not counts of independent vulnerabilities. This review does not establish that every reported code path ships in a native application.

| Dependency tree                               | Before                   | After scoped fix                                                      |
| --------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Root full dependency tree                     | 5 high                   | 5 high, all through the unpatched braces dependency in ESLint tooling |
| Root production-only (`npm audit --omit=dev`) | 0                        | 0                                                                     |
| Mobile full dependency tree                   | 31: 20 high, 11 moderate | 20 high, 0 moderate                                                   |

## Applied change

The mobile manifest overrides only `xcode`'s `uuid` dependency to `11.1.1`, the patched release that still provides a CommonJS entry and the `v4()` API used by `xcode@3.0.1`. A smoke check generated 100 unique valid 24-character uppercase Xcode project IDs through `xcode.generateUuid`; Expo dependency alignment also passed. The final native prebuild/config checks validate this tool integration again. No React Native/Expo native SDK major version was forced or downgraded. [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)

TypeScript was aligned to Expo's expected `~6.0.3` in `devDependencies`, removing the conflicting second declaration from production dependencies.

The SDK-57 URI-decoder advisory is addressed using the official patched `decode-uri-component@0.5.0` algorithm under its MIT license, with only its ESM export converted to the synchronous CommonJS function required by `query-string@7.1.3`. The local package is in `packages/decode-uri-component-cjs`; its upstream tarball integrity, exact source provenance and export-only diff are recorded in `UPSTREAM.md`. The mobile dependency/override dedupes the real installed query-string chain to that package. Regression tests pin the source SHA-256 and resolver path before exercising encoded Unicode, literal plus/space behavior, malformed percent sequences and long malformed UTF-8. Full export/browser checks verify Metro compatibility separately. [URI decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)

## Open advisories

- `braces@3.0.3` stack-exhaustion denial of service: currently no patched published release. Root exposure is through Next's ESLint plugin/fast-glob; mobile exposure is through Metro file-map tooling. Whimway does not intentionally feed user outing prompts or provider data into glob patterns. Keep development/build tooling private and review any untrusted repository/glob inputs. This limits application exposure but does not resolve the advisory. [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- `node-forge@1.4.0` RSA signature-verification flaw: currently no patched published release. It is pulled in through Expo CLI/code-signing tooling. Whimway does not implement runtime signature verification with Forge, and EAS Update is not configured. Do not infer that all signing/update paths are safe; review before enabling signed updates or processing untrusted certificates. [Forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)

`npm audit fix --force` suggests old Expo 44 / React Native 0.72 / Next ESLint 14 trees to avoid propagated advisories. Those changes would break the selected native stack and are not valid fixes. Registry checks confirmed the unpatched latest braces/Forge versions. Keep the remaining advisories visible, repeat the audit before distributing builds, and review actual runtime/toolchain reachability. Review these open tooling risks before public release, separately from missing credentials/device verification. The runtime URI concern is fixed by the auditable adapter; this does not establish a zero-advisory toolchain.

Reproduce from the root with `npm audit` and `npm audit --omit=dev`, and from `apps/mobile` with `npm audit`. A nonzero full-tree audit is expected while the documented upstream issues remain open.
