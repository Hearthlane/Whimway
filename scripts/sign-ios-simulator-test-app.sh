#!/usr/bin/env bash
# Prepare a separate, locally signed simulator test copy. Never sign the retained
# compiler product or archive: those remain the binary-reuse source of truth.
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
  signing_mode: 'ad-hoc-local',
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

cat > "$output/simulator-test.entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>com.example.whimway</string>
  <key>keychain-access-groups</key><array><string>com.example.whimway</string></array>
</dict></plist>
PLIST
plutil -lint "$output/simulator-test.entitlements"
# Never use --deep to sign: frameworks receive no application entitlements.
while IFS= read -r -d '' nested; do
  codesign --force --sign - --timestamp=none "$nested"
done < <(find "$runtime_app" -depth \( \( -type d -name '*.framework' \) -o \( -type f -name '*.dylib' \) \) -print0)
codesign --force --sign - --timestamp=none --generate-entitlement-der --entitlements "$output/simulator-test.entitlements" "$runtime_app"
codesign --verify --deep --strict --verbose=2 "$runtime_app" > "$output/verification.txt" 2>&1
codesign --display --verbose=4 "$runtime_app" > "$output/signature.txt" 2>&1
codesign --display --entitlements - --xml "$runtime_app" > "$output/runtime-entitlements.plist" 2> "$output/entitlements-display.txt"
plutil -convert json -o "$output/runtime-entitlements.json" "$output/runtime-entitlements.plist"

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
const entitlements = JSON.parse(readFileSync(path.join(output, 'runtime-entitlements.json'), 'utf8'));
if (Object.keys(entitlements).length !== 2 || entitlements['application-identifier'] !== 'com.example.whimway' ||
    JSON.stringify(entitlements['keychain-access-groups']) !== JSON.stringify(['com.example.whimway']))
  throw Error('The runtime entitlements do not match the simulator-only contract.');
Object.assign(evidence, {
  signature_verified: true,
  originals_unchanged: true,
  runtime_app_tree_sha256: await treeHash(path.join(output, 'Whimway.app')),
  runtime_entitlements: entitlements,
});
writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
NODE
