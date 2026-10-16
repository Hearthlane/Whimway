# Upstream provenance

This is a local CommonJS adapter of **decode-uri-component 0.5.0**, by Sam Verschueren, distributed under its original MIT license in `LICENSE`.

Source: [upstream source at npm gitHead a12fabaa28303cc8b5b07e93d128f4fc09fc31e5](https://github.com/SamVerschueren/decode-uri-component/blob/a12fabaa28303cc8b5b07e93d128f4fc09fc31e5/index.js).

Downloaded and verified with `npm pack decode-uri-component@0.5.0 --ignore-scripts` on 13 October 2026. The registry tarball is `https://registry.npmjs.org/decode-uri-component/-/decode-uri-component-0.5.0.tgz`, SHA-1 `4592fa1e1d640ec5e2760e2e168ad2ab5f2c9da1`, npm integrity `sha512-1BiQVoK8C9gUbQU6NzAtO/tkz2qOFpEObMWpcFvhx4fYnj4Oc5yzaJN/LD36ihkVUdXyh5ZekzX+yM+ty/SrPg==`.

`index.cjs` preserves the upstream algorithm and text exactly, with one module-format substitution:

```diff
-export default function decodeUriComponent(encodedURI) {
+module.exports = function decodeUriComponent(encodedURI) {
```

The declaration exposes that synchronous CommonJS function. Package metadata points to it rather than the upstream ESM entry. This permits Expo Router 57's existing `query-string@7.1.3` to use the patched decoder without a Router/Expo major migration. The mobile npm override is scoped to `query-string`'s dependency. The native build uploads the repository, including this directory; do not copy only `apps/mobile` for EAS or CI installation.

The mobile manifest declares this local directory as a direct file dependency and overrides only `query-string`'s decoder version to `0.5.0`. npm deduplicates that requirement to the local package. This avoids npm's ambiguous relative file resolution inside nested override rules. A fresh `npm ci --ignore-scripts`, `npm ls decode-uri-component query-string --all`, and a CommonJS query-string smoke test verified the committed lockfile arrangement on Windows. Cross-platform CI installs the same lockfile and tests the actual resolved decoder path.

SHA-256 verification with LF line endings: upstream `index.js` is `9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa`; adapted `index.cjs` is `684ba79779327ba789733a3a563050370a928a57eb7dd33d19b346f43b32cbb7`; original MIT license is `ed7a9a0f74e43951b2520efe1a4349cb9ed5f3dff0b0f268e2e51a4d38df7ea4`. The local `.gitattributes` preserves these two files' LF endings. To reproduce the adapter, pack the pinned upstream version into a temporary directory, extract `package/index.js` and `package/license`, apply the single substitution above, and verify all three hashes. Re-run the regression tests and all-platform Expo export after any upstream refresh.

The upstream release addresses [GHSA-vcc3-ghjq-m6fr / CVE-2026-45822](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), replacing the exponential malformed-input decoding path. This adapter does not claim to fix unrelated dependency advisories. Regression tests exercise the installed `query-string` dependency, valid Unicode and malformed percent encodings. Replace this adapter when an upstream supported CommonJS-compatible dependency chain becomes available; do not modify the decoding algorithm locally without reviewing and testing it.
