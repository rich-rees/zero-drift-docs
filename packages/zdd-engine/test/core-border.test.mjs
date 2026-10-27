// The border between the core and the adapters (decision 0036): the core
// knows no stack. The adapters may import the core's helpers; the core finds
// adapters only by name, through lib/catalogue.mjs.
//
// Two rules hold it, and the first is the guarantee:
//
// 1. Imports. A core file imports only Node's built-in modules (`node:…`)
//    and other core files, by a quoted relative path. A computed import
//    (`import(x)`) appears only in the two loaders that turn a name into a
//    module: derive.mjs (adapters) and viewers/index.mjs (viewers).
//    `require` and `createRequire` appear nowhere. And a path into the
//    adapters folder (`adapters/` or `adapters\`) appears in exactly one
//    file, lib/catalogue.mjs, so an import built from pieces, wrapped in
//    `new URL`, or hidden behind a comment still has to spell it out there.
// 2. Words. No core file names a stack, framework, library, platform or
//    vendor, in code or in comments. STACK_WORDS is a tripwire, not a proof:
//    a finite list catches the names ZDD has met, and it lives here because
//    the core may not hold it. Third-party code vendored into a viewer
//    (`vendor/`) is outside both rules: it is not ours to word.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogue, readCatalogue, splitBundleOptions } from "../src/core/lib/catalogue.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(PKG, "src", "core");
const ADAPTERS = join(PKG, "src", "adapters");

const STACK_WORDS = [
  "next.js", "nextjs", "react", "react-router", "expo", "expo-router", "vue", "nuxt", "svelte", "sveltekit", "angular", "remix", "astro", "gatsby", "solidjs",
  "fastapi", "django", "flask", "rails", "laravel", "express", "nestjs", "hono", "spring", "deno",
  "supabase", "supabase-js", "supabase-py", "postgres", "postgresql", "mysql", "sqlalchemy", "prisma", "drizzle", "mongodb", "firebase", "redis",
  "vercel", "railway", "cloudflare", "wrangler", "procfile", "heroku", "netlify", "docker", "fly.io", "aws", "azure", "gcp",
  "sentry", "resend", "mailgun", "stripe", "twilio", "bullmq", "inngest", "kafka", "rabbitmq", "pg_cron",
];
const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A word ends at anything that is not a letter or digit, so `adapter-react`,
// `vendor.react` and `next_js`-style joins are still words (CR-004).
const WORD_RE = new RegExp(`(^|[^a-z0-9])(${STACK_WORDS.map(escape).join("|")})(?=$|[^a-z0-9])`, "gi");
const SOURCE_RE = /\.(mjs|cjs|js|jsx|ts|mts|cts|tsx|css|html|md|json)$/;
const LOADERS = new Set(["src/core/derive.mjs", "src/core/viewers/index.mjs"]);
const BRIDGE = "src/core/lib/catalogue.mjs";

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "vendor") out.push(...files(p));
    } else if (SOURCE_RE.test(name)) out.push(p);
  }
  return out;
}

const rel = (p) => relative(PKG, p).split(sep).join("/");

// Every import-shaped thing in a text, with what it imports. `from` and a
// bare `import "x"` take a quoted specifier; `import(` takes anything, and a
// non-literal argument is reported as computed.
export function importsIn(text) {
  const found = [];
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
  // `from` counts only as the tail of an import/export clause: names, braces,
  // commas and `as`, never a quote or a semicolon before it.
  for (const m of noComments.matchAll(/^[ \t]*(?:import|export)\s[^;"'`]*?\bfrom\s*(["'`])([^"'`]+)\1/gm)) found.push({ spec: m[2] });
  for (const m of noComments.matchAll(/\bimport\s*(["'`])([^"'`]+)\1/g)) found.push({ spec: m[2] });
  for (const m of noComments.matchAll(/\bimport\s*\(\s*([^)]*)/g)) {
    const lit = /^(["'`])([^"'`$]+)\1\s*$/.exec(m[1].trim());
    found.push(lit ? { spec: lit[2] } : { computed: m[1].trim() });
  }
  if (/\brequire\s*\(|\bcreateRequire\b/.test(noComments)) found.push({ require: true });
  return found;
}

export function borderProblems(path, text) {
  const problems = [];
  for (const i of importsIn(text)) {
    if (i.require) problems.push(`${path}: uses require/createRequire`);
    else if (i.computed !== undefined) {
      if (!LOADERS.has(path)) problems.push(`${path}: computed import(${i.computed})`);
    } else if (i.spec.startsWith("node:")) continue;
    else if (!i.spec.startsWith(".")) problems.push(`${path}: imports package '${i.spec}' (core imports node: built-ins only)`);
    else {
      const target = resolve(dirname(join(PKG, path)), i.spec);
      if (!(target === CORE || target.startsWith(CORE + sep))) problems.push(`${path}: imports ${i.spec}, outside src/core`);
    }
  }
  if (path !== BRIDGE && /adapters[\\/]/.test(text)) problems.push(`${path}: names a path into the adapters folder`);
  return problems;
}

test("core files import only node: built-ins and other core files; the adapters folder is reached only through lib/catalogue.mjs", () => {
  const problems = [];
  for (const p of files(CORE)) problems.push(...borderProblems(rel(p), readFileSync(p, "utf8")));
  assert.deepEqual(problems, []);
});

test("the import guard catches the bypasses (CR-003)", () => {
  const p = "src/core/render.mjs";
  const caught = (src) => borderProblems(p, src).length > 0;
  assert.ok(caught(`import x from "../adapters/fastapi/index.mjs";`), "plain");
  assert.ok(caught(`import /* c */ ("../../adapters/fastapi/index.mjs");`), "comment-separated");
  assert.ok(caught(`await import(new URL("../adapters/fastapi/index.mjs", import.meta.url));`), "new URL");
  assert.ok(caught(`await import("../" + "adapters/fastapi/index.mjs");`), "computed");
  assert.ok(caught(`import "hono";`), "bare package");
  assert.ok(caught(`import { x } from "some-lib";`), "package specifier");
  assert.ok(caught(`import { x } from "/abs/path.mjs";`), "absolute");
  assert.ok(caught(`const r = createRequire(import.meta.url);`), "createRequire");
  assert.ok(caught(`const m = require("../adapters/x");`), "require");
  assert.ok(caught(`const where = "adapters\\\\fastapi";`), "backslash path");
  assert.ok(!caught(`import { join } from "node:path";\nimport { a } from "./lib/paths.mjs";\nconst t = "a from 'x'";`), "the allowed forms pass");
  assert.ok(!borderProblems("src/core/derive.mjs", `return import(pathToFileURL(p).href);`).length, "the adapter loader may compute");
});

test("no core file names a stack, in code or in comments", () => {
  const offenders = [];
  for (const p of files(CORE)) {
    readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(WORD_RE)) offenders.push(`${rel(p)}:${i + 1}: ${m[2]}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("the word tripwire catches joined spellings and spares ordinary words (CR-004)", () => {
  const hits = (s) => [...s.matchAll(WORD_RE)].map((m) => m[2].toLowerCase());
  assert.deepEqual(hits("a Next.js route and a FastAPI `/v1`"), ["next.js", "fastapi"]);
  assert.deepEqual(hits("// commit a railway.toml"), ["railway"]);
  assert.deepEqual(hits("adapter-react vendor.react supabase_client"), ["react", "react", "supabase"]);
  assert.deepEqual(hits("expressive, reaction, supabased, external-services, springs"), []);
});

// ---- the catalogue itself (CR-001, CR-002) ----

function fixtureCatalogue(build) {
  const dir = mkdtempSync(join(tmpdir(), "zdd-catalogue-"));
  const adapter = (name) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "index.mjs"), "export function derive() { return { records: [], diagnostics: [] }; }\n");
  };
  adapter("alpha");
  adapter("beta");
  writeFileSync(join(dir, "catalogue.json"), JSON.stringify({ aliases: {}, bundles: {} }));
  build(dir, adapter);
  return dir;
}

function readFixture(build) {
  const dir = fixtureCatalogue(build);
  try {
    return readCatalogue(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the shipped catalogue: every adapter folder is a name, and catalogue.json names only real adapters", () => {
  const { names, aliases, bundles } = catalogue();
  const adapters = readdirSync(ADAPTERS).filter((n) => statSync(join(ADAPTERS, n)).isDirectory() && readdirSync(join(ADAPTERS, n)).includes("index.mjs"));
  assert.deepEqual([...names.keys()].sort(), adapters.sort());
  for (const now of Object.values(aliases)) assert.ok(names.has(now));
  for (const b of Object.values(bundles)) for (const n of b.extractors) assert.ok(names.has(n));
});

test("a helpers folder with no index.mjs is not an adapter", () => {
  const { names } = readFixture((dir) => mkdirSync(join(dir, "shared")));
  assert.deepEqual([...names.keys()], ["alpha", "beta"]);
});

test("CR-002: catalogue.json naming an adapter that is not there fails loudly, never falls through", () => {
  const bad = (data) =>
    assert.throws(() => readFixture((dir) => writeFileSync(join(dir, "catalogue.json"), JSON.stringify(data))), /catalogue is broken/, JSON.stringify(data));
  bad({ aliases: { old: "gone" } });
  bad({ aliases: { "..": "alpha" } });
  bad({ aliases: { __proto__x: "alpha" } });
  bad({ aliases: { beta: "alpha" } });
  bad({ bundles: { legacy: { extractors: ["alpha", "gone"] } } });
  bad({ bundles: { legacy: { extractors: [] } } });
  bad({ bundles: { legacy: { extractors: ["alpha"], options: { gone: {} } } } });
  bad({ bundles: { legacy: { extractors: ["alpha"], rest: "gone" } } });
  assert.throws(() => readFixture((dir) => writeFileSync(join(dir, "catalogue.json"), "{not json")), /catalogue is broken/);
  const ok = readFixture((dir) => writeFileSync(join(dir, "catalogue.json"), JSON.stringify({ aliases: { old: "alpha" }, bundles: { legacy: { extractors: ["alpha", "beta"], options: { alpha: { k: [] } }, rest: "beta" } } })));
  assert.equal(ok.aliases.old, "alpha");
});

test("CR-002: an adapter folder whose name config could never select fails loudly", () => {
  assert.throws(() => readFixture((dir, adapter) => adapter("Foo.bar")), /not a selectable adapter name/);
});

test("CR-001: a symlinked adapter folder or index.mjs is refused", (t) => {
  let made = true;
  const outside = mkdtempSync(join(tmpdir(), "zdd-outside-"));
  writeFileSync(join(outside, "index.mjs"), "export function derive() {}\n");
  try {
    assert.throws(
      () =>
        readFixture((dir) => {
          try {
            symlinkSync(outside, join(dir, "gamma"), "junction");
          } catch {
            made = false;
          }
        }),
      /is a symlink/,
    );
  } catch (e) {
    if (made) throw e;
  }
  let fileLink = true;
  try {
    assert.throws(
      () =>
        readFixture((dir) => {
          mkdirSync(join(dir, "delta"));
          try {
            symlinkSync(join(outside, "index.mjs"), join(dir, "delta", "index.mjs"), "file");
          } catch {
            fileLink = false;
          }
        }),
      /not a regular file/,
    );
  } catch (e) {
    if (fileLink) throw e;
  }
  rmSync(outside, { recursive: true, force: true });
  if (!made && !fileLink) t.skip("this machine cannot create symlinks");
});

// ---- the pre-1.0 bundle split (CR-008) ----

test("CR-008: the bundle split takes defaults exactly as the old destructuring did, and never shares the catalogue's arrays", () => {
  const { bundles } = catalogue();
  const b = bundles["nextjs-supabase"];
  const owner = Object.keys(b.options)[0];
  const ownedKeys = Object.keys(b.options[owner]);
  const empty = Object.fromEntries(ownedKeys.map((k) => [k, []]));
  assert.deepEqual(splitBundleOptions(b, undefined), { [owner]: empty, [b.rest]: {} }, "no adapterOptions at all");
  assert.deepEqual(splitBundleOptions(b, {}), { [owner]: empty, [b.rest]: {} }, "empty adapterOptions");
  const one = splitBundleOptions(b, { [ownedKeys[0]]: ["x"], appDir: "src/app" });
  assert.deepEqual(one, { [owner]: { ...empty, [ownedKeys[0]]: ["x"] }, [b.rest]: { appDir: "src/app" } }, "one owned key omitted");
  assert.deepEqual(splitBundleOptions(b, { [ownedKeys[0]]: undefined })[owner], empty, "explicit undefined takes the default");
  const first = splitBundleOptions(b, {});
  first[owner][ownedKeys[0]].push("mutated");
  assert.deepEqual(splitBundleOptions(b, {})[owner][ownedKeys[0]], [], "a returned default is a copy");
});
