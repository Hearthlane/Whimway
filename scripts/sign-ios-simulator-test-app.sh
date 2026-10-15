#!/usr/bin/env bash
# Verify Xcode's ad-hoc simulator product and prepare a separate runtime copy.
# Never re-sign the compiler output: Simulator iOS entitlements belong in the
# linker-created __TEXT sections, distinct from the host macOS code signature.
set -euo pipefail

fail() { echo "Simulator signing refused: $1" >&2; exit 1; }
[[ "${CI:-}" == true ]] || fail 'CI=true is required.'
[[ "$(uname -s)" == Darwin ]] || fail 'The Apple simulator toolchain is required.'
[[ $# == 3 ]] || fail 'Usage: sign-ios-simulator-test-app.sh release|debug source.app source.tar.gz'
case "$1" in release|debug) configuration=$1 ;; *) fail 'Unknown configuration.' ;; esac
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
output="$repo/native-test-artifacts/ios-simulator-runtime/$configuration"
runtime_app="$output/Whimway.app"
export WHIMWAY_BINARY_SOURCE_SHA="${WHIMWAY_BINARY_SOURCE_SHA:-}"

# Resolve and fence every input/output before creating anything. Symlinked
# output ancestors and pre-existing runtime copies are deliberately refused.
node --input-type=module - "$repo" "$configuration" "$2" "$3" <<'NODE'
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [root, configuration, inputApp, inputArchive] = process.argv.slice(2);
const mode = configuration === 'release' ? 'Release' : 'Debug';
const app = realpathSync(inputApp), archive = realpathSync(inputArchive);
const expectedApp = path.join(root, 'apps/mobile/ios/build/Build/Products', `${mode}-iphonesimulator`, 'Whimway.app');
const expectedArchive = path.join(root, 'apps/mobile/ios', `whimway-ios-simulator${configuration === 'debug' ? '-debug' : ''}.tar.gz`);
if (app !== expectedApp || archive !== expectedArchive || lstatSync(inputApp).isSymbolicLink() || lstatSync(inputArchive).isSymbolicLink())
  throw Error('Only the expected original simulator compiler product and archive are accepted.');
if (!lstatSync(app).isDirectory() || !lstatSync(archive).isFile() || !lstatSync(archive).size)
  throw Error('The original simulator app/archive is unavailable.');
const binarySha = process.env.WHIMWAY_BINARY_SOURCE_SHA;
if (binarySha && !/^[a-f0-9]{40}$/.test(binarySha)) throw Error('Invalid binary source SHA.');
let output = root;
for (const part of ['native-test-artifacts', 'ios-simulator-runtime']) {
  output = path.join(output, part);
  if (existsSync(output)) {
    const stat = lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(output) !== output)
      throw Error('Runtime output must remain inside the repository.');
  } else mkdirSync(output);
}
output = path.join(output, configuration);
if (existsSync(output)) throw Error('Refusing to replace an existing simulator runtime/evidence directory.');
mkdirSync(output);
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function treeHash(base) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const absolute = path.join(base, relative), stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(absolute);
      if (target !== base && !target.startsWith(base + path.sep)) throw Error('App symlink escapes its bundle.');
      hash.update(JSON.stringify([relative, 'link', readlinkSync(absolute)]));
    } else if (stat.isDirectory()) {
      hash.update(JSON.stringify([relative, 'directory']));
      for (const entry of readdirSync(absolute).sort()) await visit(path.join(relative, entry));
    } else if (stat.isFile()) hash.update(JSON.stringify([relative, 'file', await fileHash(absolute)]));
    else throw Error('Unsupported entry in simulator app.');
  }
  await visit('');
  return hash.digest('hex');
}
const checkout = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const checkoutSha = checkout.status === 0 ? checkout.stdout.trim() : '';
if (!/^[a-f0-9]{40}$/.test(checkoutSha)) throw Error('Checkout provenance is unavailable.');
writeFileSync(path.join(output, 'signing-evidence.json'), JSON.stringify({
  simulator_only: true,
  signing_mode: 'xcode-ad-hoc-verified-copy',
  configuration,
  checkout_sha: checkoutSha,
  binary_source_sha: binarySha || null,
  original_app: path.relative(root, app),
  original_archive: path.relative(root, archive),
  original_app_tree_sha256: await treeHash(app),
  original_archive_sha256: await fileHash(archive),
  runtime_app: path.relative(root, path.join(output, 'Whimway.app')),
  signature_verified: false,
  originals_unchanged: false,
}, null, 2) + '\n');
NODE

source_app=$(cd -- "$2" && pwd -P)
source_archive=$(cd -- "$(dirname -- "$3")" && pwd -P)/$(basename -- "$3")
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Info.plist")" == com.example.whimway ]] || fail 'Unexpected app bundle identifier.'
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$source_app/Info.plist")" == Whimway ]] || fail 'Unexpected app executable.'
plutil -extract CFBundleSupportedPlatforms json -o - "$source_app/Info.plist" | node --input-type=module -e '
let text="";for await(const chunk of process.stdin)text+=chunk;
const values=JSON.parse(text);if(!Array.isArray(values)||values.length!==1||values[0]!=="iPhoneSimulator")throw Error("Expected an iPhoneSimulator bundle only.");'
xcrun vtool -show-build "$source_app/Whimway" > "$output/source-platform.txt"
awk '/^[[:space:]]*platform[[:space:]]/ { count++; if ($2 != "IOSSIMULATOR") bad=1 } END { exit(count > 0 && !bad ? 0 : 1) }' "$output/source-platform.txt" || fail 'The executable is not exclusively an iOS Simulator Mach-O.'

ditto "$source_app" "$runtime_app"
# Refuse unknown nested applications/extensions; granting this app's identity to
# a different executable target would need its own reviewed signing contract.
while IFS= read -r -d '' nested; do
  [[ "$nested" == "$runtime_app" ]] || fail 'Nested app/extension targets are unsupported.'
done < <(find "$runtime_app" -type d \( -name '*.app' -o -name '*.appex' -o -name '*.xpc' \) -print0)

codesign --verify --deep --strict --verbose=2 "$runtime_app" > "$output/verification.txt" 2>&1
codesign --display --verbose=4 "$runtime_app" > "$output/signature.txt" 2>&1
codesign --display --entitlements - --xml "$runtime_app" > "$output/runtime-entitlements.plist" 2> "$output/entitlements-display.txt"
# Release signing may contain no host entitlements at all.
if [[ -s "$output/runtime-entitlements.plist" ]]; then
  plutil -convert json -o "$output/runtime-entitlements.json" "$output/runtime-entitlements.plist"
else
  printf '{}\n' > "$output/runtime-entitlements.json"
fi

# Read the compiler-created sections without modifying any Mach-O bytes. The
# arm64-only compile contract permits only a thin 64-bit little-endian binary.
node --input-type=module - "$runtime_app/Whimway" "$output" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [file, output] = process.argv.slice(2), binary = readFileSync(file);
if (binary.length < 32 || binary.readUInt32LE(0) !== 0xfeedfacf || binary.readUInt32LE(4) !== 0x100000c)
  throw Error('Expected the arm64 thin Simulator executable.');
const commandCount = binary.readUInt32LE(16), commandEnd = 32 + binary.readUInt32LE(20);
if (commandCount > 4096 || commandEnd > binary.length) throw Error('Invalid Mach-O load commands.');
const sections = new Map();
const name = offset => binary.subarray(offset, offset + 16).toString('utf8').replace(/\0.*$/s, '');
let offset = 32;
for (let i = 0; i < commandCount; i++) {
  if (offset + 8 > commandEnd) throw Error('Truncated Mach-O command.');
  const command = binary.readUInt32LE(offset), size = binary.readUInt32LE(offset + 4);
  if (size < 8 || offset + size > commandEnd) throw Error('Invalid Mach-O command length.');
  if (command === 0x19) {
    if (size < 72) throw Error('Truncated Mach-O segment.');
    const count = binary.readUInt32LE(offset + 64);
    if (72 + count * 80 > size) throw Error('Truncated Mach-O section table.');
    for (let j = 0; j < count; j++) {
      const entry = offset + 72 + j * 80, section = name(entry);
      if (name(offset + 8) !== '__TEXT' || name(entry + 16) !== '__TEXT' || !['__entitlements', '__ents_der'].includes(section)) continue;
      const start = binary.readUInt32LE(entry + 48), length = binary.readBigUInt64LE(entry + 40);
      if (sections.has(section) || length < 1n || length > 262144n || BigInt(start) + length > BigInt(binary.length))
        throw Error('Invalid or duplicate embedded Simulator entitlement section.');
      sections.set(section, binary.subarray(start, start + Number(length)));
    }
  }
  offset += size;
}
if (offset !== commandEnd || sections.size !== 2) throw Error('Xcode must embed both XML and DER Simulator entitlement sections; unsigned compiler products cannot be repaired by re-signing.');
const xml = sections.get('__entitlements').toString('utf8').replace(/\0+$/s, '');
if (!xml.startsWith('<?xml') || !xml.includes('<plist')) throw Error('Invalid embedded Simulator entitlement plist.');
writeFileSync(path.join(output, 'embedded-entitlements.plist'), xml);
writeFileSync(path.join(output, 'embedded-entitlements.der'), sections.get('__ents_der'));
writeFileSync(path.join(output, 'embedded-sections.json'), JSON.stringify(Object.fromEntries([...sections].map(([section, bytes]) => [section, {
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
}])), null, 2) + '\n');
NODE
plutil -convert json -o "$output/embedded-entitlements.json" "$output/embedded-entitlements.plist"

node --input-type=module - "$repo" "$output" "$source_app" "$source_archive" <<'NODE'
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [root, output, app, archive] = process.argv.slice(2);
const evidenceFile = path.join(output, 'signing-evidence.json');
const evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function treeHash(base) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const absolute = path.join(base, relative), stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) hash.update(JSON.stringify([relative, 'link', readlinkSync(absolute)]));
    else if (stat.isDirectory()) {
      hash.update(JSON.stringify([relative, 'directory']));
      for (const entry of readdirSync(absolute).sort()) await visit(path.join(relative, entry));
    } else if (stat.isFile()) hash.update(JSON.stringify([relative, 'file', await fileHash(absolute)]));
    else throw Error('Unsupported entry in simulator app.');
  }
  await visit('');
  return hash.digest('hex');
}
if (await treeHash(app) !== evidence.original_app_tree_sha256 || await fileHash(archive) !== evidence.original_archive_sha256)
  throw Error('The original compiler product/archive changed during runtime preparation.');
if (!/^Signature=adhoc$/m.test(readFileSync(path.join(output, 'signature.txt'), 'utf8')))
  throw Error('The runtime signature is not ad hoc.');
const hostEntitlements = JSON.parse(readFileSync(path.join(output, 'runtime-entitlements.json'), 'utf8'));
if (Object.entries(hostEntitlements).some(([key, value]) => key !== 'com.apple.security.get-task-allow' || typeof value !== 'boolean'))
  throw Error('Unexpected host signature entitlements; iOS capabilities must be linker-embedded for Simulator.');
const embedded = JSON.parse(readFileSync(path.join(output, 'embedded-entitlements.json'), 'utf8'));
// The actual no-team Xcode Simulator product (02ab71e) embeds FAKETEAMID.
// Accept those existing bytes only; never inject a team or re-sign the product.
const simulatorIdentifier = embedded['application-identifier'];
if (!['com.example.whimway', 'FAKETEAMID.com.example.whimway'].includes(simulatorIdentifier) ||
    (embedded['keychain-access-groups'] !== undefined && JSON.stringify(embedded['keychain-access-groups']) !== JSON.stringify([simulatorIdentifier])))
  throw Error('The Xcode-embedded Simulator identity does not match the placeholder app.');
const runtimeHash = await treeHash(path.join(output, 'Whimway.app'));
if (runtimeHash !== evidence.original_app_tree_sha256) throw Error('The runtime copy must exactly match the Xcode compiler product.');
Object.assign(evidence, {
  signature_verified: true,
  originals_unchanged: true,
  runtime_copy_unchanged: true,
  runtime_app_tree_sha256: runtimeHash,
  host_signature_entitlements: hostEntitlements,
  simulator_embedded_entitlements: embedded,
  simulator_embedded_sections: JSON.parse(readFileSync(path.join(output, 'embedded-sections.json'), 'utf8')),
});
writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
NODE
