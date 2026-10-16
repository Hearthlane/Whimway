import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const helper = readFileSync(
  path.join(root, "scripts/sign-ios-simulator-test-app.sh"),
  "utf8",
);
const parser = helper.match(
  /node --input-type=module - "\$runtime_app\/Whimway" "\$output" <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/,
)?.[1];
if (!parser)
  throw new Error(
    "The actual Simulator entitlement-section parser is missing.",
  );
const identityPolicy = helper.match(
  /const hostEntitlements = [\s\S]*?(?=const runtimeHash =)/,
)?.[0];
if (!identityPolicy)
  throw new Error(
    "The actual Simulator identity validation policy is missing.",
  );
const finalizer = helper.match(
  /node --input-type=module - "\$repo" "\$output" "\$source_app" "\$source_archive" <<'NODE'\r?\n([\s\S]*?)\r?\nNODE/,
)?.[1];
if (!finalizer)
  throw new Error("The actual final provenance validation is missing.");
const temporary: string[] = [];
const xml = Buffer.from(
  '<?xml version="1.0"?><plist version="1.0"><dict><key>application-identifier</key><string>com.example.whimway</string></dict></plist>',
);
const der = Buffer.from("3003020101", "hex");
type Section = { name: string; bytes: Buffer; segment?: string };

// A structural Mach-O fixture, never executable native code. This verifies the
// real CI parser's extraction/refusal boundaries, not Apple entitlement policy.
function binary(
  sections: Section[] = [
    { name: "__entitlements", bytes: xml },
    { name: "__ents_der", bytes: der },
  ],
) {
  const commandSize = 72 + sections.length * 80;
  const result = Buffer.alloc(
    32 +
      commandSize +
      sections.reduce((sum, section) => sum + section.bytes.length, 0),
  );
  result.writeUInt32LE(0xfeedfacf, 0);
  result.writeUInt32LE(0x100000c, 4);
  result.writeUInt32LE(1, 16);
  result.writeUInt32LE(commandSize, 20);
  result.writeUInt32LE(0x19, 32);
  result.writeUInt32LE(commandSize, 36);
  result.write("__TEXT", 40);
  result.writeUInt32LE(sections.length, 96);
  let start = 32 + commandSize;
  sections.forEach((section, index) => {
    const entry = 104 + index * 80;
    result.write(section.name, entry);
    result.write(section.segment ?? "__TEXT", entry + 16);
    result.writeBigUInt64LE(BigInt(section.bytes.length), entry + 40);
    result.writeUInt32LE(start, entry + 48);
    section.bytes.copy(result, start);
    start += section.bytes.length;
  });
  return result;
}
function extract(bytes: Buffer) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "whimway-simulator-sections-"),
  );
  temporary.push(directory);
  const file = path.join(directory, "Whimway");
  writeFileSync(file, bytes);
  return {
    directory,
    result: spawnSync(
      process.execPath,
      ["--input-type=module", "-", file, directory],
      { input: parser, encoding: "utf8", timeout: 5000 },
    ),
  };
}
function validateIdentity(
  embedded: Record<string, unknown>,
  host: Record<string, unknown> = {},
) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "whimway-simulator-sections-"),
  );
  temporary.push(directory);
  writeFileSync(
    path.join(directory, "embedded-entitlements.json"),
    JSON.stringify(embedded),
  );
  writeFileSync(
    path.join(directory, "runtime-entitlements.json"),
    JSON.stringify(host),
  );
  return spawnSync(process.execPath, ["--input-type=module", "-", directory], {
    input:
      "import {readFileSync} from 'node:fs'; import path from 'node:path'; const output=process.argv[2];\n" +
      identityPolicy,
    encoding: "utf8",
    timeout: 5000,
  });
}
function finalizeFixture(mutate?: "source" | "runtime") {
  const directory = mkdtempSync(
    path.join(tmpdir(), "whimway-simulator-sections-"),
  );
  temporary.push(directory);
  const app = path.join(directory, "Original.app"),
    output = path.join(directory, "evidence"),
    archive = path.join(directory, "original.tar.gz");
  mkdirSync(app);
  mkdirSync(output);
  const files = {
    "Info.plist": "synthetic plist fixture",
    Whimway: "synthetic executable fixture",
  };
  const tree = createHash("sha256");
  tree.update(JSON.stringify(["", "directory"]));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(app, name), content);
    tree.update(
      JSON.stringify([
        name,
        "file",
        createHash("sha256").update(content).digest("hex"),
      ]),
    );
  }
  const originalTreeHash = tree.digest("hex");
  writeFileSync(archive, "synthetic retained archive fixture");
  cpSync(app, path.join(output, "Whimway.app"), { recursive: true });
  const evidence = {
    original_app_tree_sha256: originalTreeHash,
    original_archive_sha256: createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex"),
  };
  writeFileSync(
    path.join(output, "signing-evidence.json"),
    JSON.stringify(evidence),
  );
  writeFileSync(path.join(output, "signature.txt"), "Signature=adhoc\n");
  writeFileSync(path.join(output, "runtime-entitlements.json"), "{}");
  writeFileSync(
    path.join(output, "embedded-entitlements.json"),
    JSON.stringify({
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "aps-environment": "development",
    }),
  );
  writeFileSync(path.join(output, "embedded-sections.json"), "{}");
  if (mutate)
    writeFileSync(
      path.join(
        mutate === "source" ? app : path.join(output, "Whimway.app"),
        "Whimway",
      ),
      "changed bytes",
    );
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-", directory, output, app, archive],
    { input: finalizer, encoding: "utf8", timeout: 5000 },
  );
  return { result, output, originalTreeHash, archive, app };
}
afterEach(() => {
  const base = realpathSync(tmpdir()) + path.sep;
  for (const directory of temporary.splice(0)) {
    const resolved = realpathSync(directory);
    if (
      !resolved.startsWith(base) ||
      !path.basename(resolved).startsWith("whimway-simulator-sections-")
    )
      throw new Error("Refusing cleanup outside owned temporary fixtures.");
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe("Xcode Simulator entitlement evidence", () => {
  it("finalizes the actual observed Simulator identity only after confirming unchanged original/archive/runtime bytes", () => {
    const fixture = finalizeFixture();
    expect(fixture.result.status, fixture.result.stderr).toBe(0);
    expect(
      JSON.parse(
        readFileSync(
          path.join(fixture.output, "signing-evidence.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      signature_verified: true,
      originals_unchanged: true,
      runtime_copy_unchanged: true,
      runtime_app_tree_sha256: fixture.originalTreeHash,
      host_signature_entitlements: {},
      simulator_embedded_entitlements: {
        "application-identifier": "FAKETEAMID.com.example.whimway",
      },
    });
    expect(readFileSync(fixture.archive, "utf8")).toBe(
      "synthetic retained archive fixture",
    );
    expect(readFileSync(path.join(fixture.app, "Whimway"), "utf8")).toBe(
      "synthetic executable fixture",
    );
  });
  it.each(["source", "runtime"] as const)(
    "rejects changed %s bytes even when the observed Simulator identity is allowed",
    (mutate) => {
      expect(finalizeFixture(mutate).result.status).not.toBe(0);
    },
  );
  it.each(["com.example.whimway", "FAKETEAMID.com.example.whimway"])(
    "accepts only the observed Simulator identity %s with absent or matching default group",
    (identifier) => {
      for (const groups of [undefined, [identifier]]) {
        const result = validateIdentity({
          "application-identifier": identifier,
          ...(groups ? { "keychain-access-groups": groups } : {}),
        });
        expect(result.status, result.stderr).toBe(0);
      }
    },
  );
  it("accepts the exact fresh Xcode Release metadata and the documented host Debug entitlement without modifying either", () => {
    // Observed 02ab71e Release artifact: empty host entitlements and an embedded
    // Simulator placeholder prefix; this is a guard test, not runtime proof.
    const embedded = {
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "aps-environment": "development",
    };
    expect(validateIdentity(embedded).status).toBe(0);
    expect(
      validateIdentity(embedded, { "com.apple.security.get-task-allow": true })
        .status,
    ).toBe(0);
    expect(embedded).toEqual({
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "aps-environment": "development",
    });
  });
  it.each([
    {},
    { "application-identifier": "REALTEAMID.com.example.whimway" },
    { "application-identifier": "FAKETEAMID.com.example.other" },
    { "application-identifier": "FAKETEAMID.com.example.whimway.foreign" },
    { "application-identifier": "faketeamid.com.example.whimway" },
    { "application-identifier": "FAKETEAMID..com.example.whimway" },
    {
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "keychain-access-groups": ["com.example.whimway"],
    },
    {
      "application-identifier": "com.example.whimway",
      "keychain-access-groups": ["FAKETEAMID.com.example.whimway"],
    },
    {
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "keychain-access-groups": [
        "FAKETEAMID.com.example.whimway",
        "foreign.group",
      ],
    },
    {
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "keychain-access-groups": [],
    },
    {
      "application-identifier": "FAKETEAMID.com.example.whimway",
      "keychain-access-groups": null,
    },
  ])(
    "refuses foreign/malformed identities and nonmatching or additional keychain groups %#",
    (embedded) => {
      expect(validateIdentity(embedded).status).not.toBe(0);
    },
  );
  it.each([
    { "get-task-allow": true },
    { "application-identifier": "FAKETEAMID.com.example.whimway" },
    { "keychain-access-groups": ["FAKETEAMID.com.example.whimway"] },
    { "com.apple.security.get-task-allow": 1 },
  ])(
    "continues rejecting iOS capability keys or non-boolean values in the host signature %#",
    (host) => {
      expect(
        validateIdentity(
          { "application-identifier": "FAKETEAMID.com.example.whimway" },
          host,
        ).status,
      ).not.toBe(0);
    },
  );
  it("extracts the exact compiler-created XML/DER bytes and hashes without changing the input", () => {
    const bytes = binary(),
      { directory, result } = extract(bytes);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(directory, "Whimway"))).toEqual(bytes);
    expect(
      readFileSync(path.join(directory, "embedded-entitlements.plist")),
    ).toEqual(xml);
    expect(
      readFileSync(path.join(directory, "embedded-entitlements.der")),
    ).toEqual(der);
    expect(
      JSON.parse(
        readFileSync(path.join(directory, "embedded-sections.json"), "utf8"),
      ),
    ).toEqual({
      __entitlements: {
        bytes: xml.length,
        sha256: createHash("sha256").update(xml).digest("hex"),
      },
      __ents_der: {
        bytes: der.length,
        sha256: createHash("sha256").update(der).digest("hex"),
      },
    });
  });
  it.each(
    (
      [
        [{ name: "__entitlements", bytes: xml }],
        [{ name: "__ents_der", bytes: der }],
        [
          { name: "__entitlements", bytes: xml },
          { name: "__entitlements", bytes: xml },
          { name: "__ents_der", bytes: der },
        ],
        [
          { name: "__entitlements", bytes: xml, segment: "__DATA" },
          { name: "__ents_der", bytes: der },
        ],
        [
          { name: "__entitlements", bytes: Buffer.from("not a plist") },
          { name: "__ents_der", bytes: der },
        ],
      ] satisfies Section[][]
    ).map((sections) => ({ sections })),
  )(
    "refuses missing, duplicate, misplaced, or invalid section data %#",
    ({ sections }) => {
      expect(extract(binary(sections)).result.status).not.toBe(0);
    },
  );
  it("refuses non-arm64, truncated, oversized, and out-of-bounds Mach-O metadata", () => {
    const wrongArchitecture = binary();
    wrongArchitecture.writeUInt32LE(0x1000007, 4);
    const truncatedCommands = binary();
    truncatedCommands.writeUInt32LE(0xffffffff, 20);
    const truncatedSectionTable = binary();
    truncatedSectionTable.writeUInt32LE(0xffffffff, 96);
    const oversized = binary();
    oversized.writeBigUInt64LE(262145n, 144);
    const escaped = binary();
    escaped.writeUInt32LE(0xffffffff, 152);
    for (const bytes of [
      Buffer.alloc(16),
      wrongArchitecture,
      truncatedCommands,
      truncatedSectionTable,
      oversized,
      escaped,
    ])
      expect(extract(bytes).result.status).not.toBe(0);
  });
  it("never re-signs a product or confuses host signature entitlements with embedded iOS identity", () => {
    expect(helper).not.toMatch(
      /codesign\s+--force|codesign\s+--sign|codesign\s+.*--entitlements\s+"/,
    );
    expect(helper).toContain("codesign --verify --deep --strict");
    expect(helper).toContain("host_signature_entitlements: hostEntitlements");
    expect(helper).toContain("simulator_embedded_entitlements: embedded");
    expect(helper).toContain(
      "runtimeHash !== evidence.original_app_tree_sha256",
    );
  });
});
