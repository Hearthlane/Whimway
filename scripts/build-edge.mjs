// Bundles the Whimway API into one file for a Supabase Edge Function (Deno):
//   node scripts/build-edge.mjs   →   supabase/functions/api/index.js
// npm packages are bundled in; Node built-ins stay as node:* imports, which Deno provides.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fn = path.join(root, "supabase/functions/api");
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

const shims = {
  name: "whimway-edge",
  setup(b) {
    b.onResolve({ filter: /^next\/server$/ }, () => ({ path: path.join(fn, "shims/next-server.ts") }));
    b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: path.join(fn, "shims/next-headers.ts") }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve(`./${a.path.slice(2)}`, { resolveDir: root, kind: a.kind }));
    // Deno needs the node: prefix on built-ins.
    b.onResolve({ filter: /.*/ }, (a) => (builtins.has(a.path) ? { path: a.path.startsWith("node:") ? a.path : `node:${a.path}`, external: true } : undefined));
  },
};

const result = await build({
  entryPoints: [path.join(fn, "entry.ts")],
  outfile: path.join(fn, "index.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  conditions: ["worker", "deno", "import", "default"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  plugins: [shims],
  // Supabase's runtime doesn't allow changing environment variables, so the API reads (and
  // sets its defaults on) a plain copy of them, made before anything else runs.
  define: { "process.env.NODE_ENV": '"production"', "process.env": "globalThis.__whimwayEnv" },
  // Libraries that still read globals like Buffer get them from node: modules.
  banner: { js: 'globalThis.__whimwayEnv ??= { ...(globalThis.Deno?.env?.toObject?.() ?? globalThis.process?.env ?? {}) }; import { Buffer } from "node:buffer"; globalThis.Buffer ??= Buffer; import __process from "node:process"; globalThis.process ??= __process;' },
  logLevel: "warning",
});
const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`supabase/functions/api/index.js  ${(bytes / 1024).toFixed(0)} KB`);
