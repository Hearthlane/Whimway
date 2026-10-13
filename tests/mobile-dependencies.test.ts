import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const mobileRequire = createRequire(fileURLToPath(new URL("../apps/mobile/package.json", import.meta.url)));
const queryPath = mobileRequire.resolve("query-string");
const queryRequire = createRequire(queryPath);
const decoderPath = queryRequire.resolve("decode-uri-component");
const expectedPath = fileURLToPath(new URL("../packages/decode-uri-component-cjs/index.cjs", import.meta.url));
const adaptedHash = "684ba79779327ba789733a3a563050370a928a57eb7dd33d19b346f43b32cbb7";
function verifyPatchedDecoder() {
  expect(decoderPath).toBe(expectedPath);
  expect(createHash("sha256").update(readFileSync(decoderPath)).digest("hex")).toBe(adaptedHash);
}

describe("installed Expo Router query decoder security adapter", () => {
  it("uses the patched local CommonJS function through the real installed query-string", () => {
    verifyPatchedDecoder();
    expect(typeof queryRequire("decode-uri-component")).toBe("function");
    const query = mobileRequire("query-string");
    expect(query.parse("city=Montr%C3%A9al&vibe=caf%C3%A9%20date&plus=a%2Bb&spaces=a+b"))
      .toEqual({ city: "Montréal", vibe: "café date", plus: "a+b", spaces: "a b" });
    expect(query.stringify({ city: "東京", vibe: "a+b c" }))
      .toBe("city=%E6%9D%B1%E4%BA%AC&vibe=a%2Bb%20c");
  });

  it("preserves valid text and handles malformed percent input without throwing", () => {
    verifyPatchedDecoder();
    const query = mobileRequire("query-string");
    expect(query.parse("plain=100%&bad=%G0&mixed=%41%C3%42"))
      .toEqual({ plain: "100%", bad: "%G0", mixed: "A%C3B" });
  });

  it("handles long malformed UTF-8 through the patched adapter without recursion failure", () => {
    // Assert the patched path before invoking this regression input. Never
    // exercise the exponentially slow vulnerable decoder with this payload.
    verifyPatchedDecoder();
    const query = mobileRequire("query-string");
    const malformed = "%C3".repeat(20000);
    expect(query.parse(`value=${malformed}`).value).toBe(malformed);
  });
});
