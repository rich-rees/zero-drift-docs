// The border between the core and the adapters (decision 0036): the core
// knows no stack, and finds adapters only by name, through lib/catalogue.mjs.
// From the other side (decision 0048 point 4) an adapter imports nothing of
// the core: its one link to ZDD is the contract, the `io` it is handed and
// what it returns. Code adapters share is in `_shared/`, and an adapter's
// reach is its own folder plus `_shared/`, so copying it brings exactly the
// files its imports reach (3 below).
//
// Three rules hold it, and the first is the guarantee:
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
//    vendor, in code or in comments. STACK_WORDS (./stack-words.mjs) is a tripwire, not a proof:
//    a finite list catches the names ZDD has met, and it lives here because
//    the core may not hold it. Third-party code vendored into a viewer
//    (`vendor/`) is outside both rules: it is not ours to word.
// 3. Self-contained adapters. No file under src/adapters imports src/core,
//    by any spelling. Every file in an adapter's folder reaches, by static
//    relative imports, only its own folder and `_shared/`; a `_shared/` file
//    reaches only `_shared/`. And the reach is the copy: each adapter's
//    reached files, copied alone into an empty folder in the layout an app
//    holds them in, import and run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { catalogue, readCatalogue, splitBundleOptions } from "../src/core/lib/catalogue.mjs";
import { lexJs, moduleReach } from "../src/core/lib/suite.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { WORD_RE as WORD_RE_OF } from "./stack-words.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(PKG, "src", "core");
const ADAPTERS = join(PKG, "src", "adapters");

const WORD_RE = WORD_RE_OF();
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

// ---- self-contained adapters (decision 0048 point 4) ----

const SHARED = join(ADAPTERS, "_shared");
const inside = (abs, dir) => abs === dir || abs.startsWith(dir + sep);
const adapterFolders = () => readdirSync(ADAPTERS).filter((n) => n !== "_shared" && statSync(join(ADAPTERS, n)).isDirectory()).sort();
const mjs = (dir) => files(dir).filter((p) => p.endsWith(".mjs"));

// Every import in an adapter-side file that is not a node: built-in. Read
// as check 5 reads one (an adapter's code is full of import-shaped strings
// and regexes): static imports from the code view, a dynamic import or a
// require from the view with strings blanked too, so one is caught however
// its argument is spelt. A bare package is a problem: a copied adapter runs
// under npx with no packages of its own (check 5 says the same).
const STATIC_IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
export function adapterImportProblems(path, text) {
  const problems = [];
  const { code, mask } = lexJs(text);
  for (const m of code.matchAll(STATIC_IMPORT)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith("node:")) continue;
    if (!spec.startsWith(".")) problems.push(`${path}: imports '${spec}', not a relative file`);
    else if (inside(resolve(dirname(join(PKG, path)), spec), CORE)) problems.push(`${path}: imports ${spec}, inside src/core`);
  }
  if (/\bimport\s*\(/.test(mask)) problems.push(`${path}: imports dynamically`);
  if (/\brequire\s*\(|\bcreateRequire\b/.test(mask)) problems.push(`${path}: uses require/createRequire`);
  return problems;
}

test("no file under src/adapters imports src/core, a package, or anything computed", () => {
  const problems = [];
  for (const p of mjs(ADAPTERS)) problems.push(...adapterImportProblems(rel(p), readFileSync(p, "utf8")));
  assert.deepEqual(problems, []);
});

test("the adapter-side guard catches core imports in every spelling", () => {
  const p = "src/adapters/x/index.mjs";
  const caught = (src) => adapterImportProblems(p, src).length > 0;
  assert.ok(caught(`import { a } from "../../core/lib/paths.mjs";`), "plain");
  assert.ok(caught(`export { a } from "../../core/lib/paths.mjs";`), "re-export");
  assert.ok(caught(`import {\n  a,\n} from "../../core/lib/paths.mjs";`), "multi-line");
  assert.ok(caught(`import "../../core/derive.mjs";`), "bare");
  assert.ok(caught(`import("../../core/derive.mjs");`), "dynamic");
  assert.ok(caught(`import("../../" + "core");`), "computed");
  assert.ok(caught(`import { a } from "../_shared/../../core/lib/paths.mjs";`), "through _shared");
  assert.ok(caught(`import { a } from "some-lib";`), "a package");
  assert.ok(!caught(`import { a } from "../_shared/paths.mjs";\n// import x from "../../core/derive.mjs";\nimport { join } from "node:path";`), "the allowed forms pass, a comment is not an import");
});

test("every adapter reaches only its own folder and _shared/; _shared/ reaches only itself", () => {
  const problems = [];
  const judge = (p, allowed) => {
    const r = moduleReach(p, ADAPTERS);
    for (const m of r.missing) problems.push(`${rel(p)}: reaches ${m}, which is not there`);
    for (const o of r.outside) problems.push(`${rel(p)}: ${o}, outside the adapters`);
    for (const f of r.files) if (!allowed.some((d) => inside(f, d))) problems.push(`${rel(p)}: reaches ${rel(f)}`);
  };
  for (const name of adapterFolders()) for (const p of mjs(join(ADAPTERS, name))) judge(p, [join(ADAPTERS, name), SHARED]);
  for (const p of mjs(SHARED)) judge(p, [SHARED]);
  assert.deepEqual(problems, []);
});

test("the reach guard catches a reach into another adapter or past the folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-reach-"));
  try {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "b"));
    mkdirSync(join(dir, "_shared"));
    writeFileSync(join(dir, "a", "index.mjs"), `import { x } from "../_shared/x.mjs";\nimport { y } from "../b/y.mjs";\nimport { z } from "../../z.mjs";\nimport { w } from "./gone.mjs";\n// import { v } from "../b/v.mjs";\n`);
    writeFileSync(join(dir, "_shared", "x.mjs"), `export const x = 1;\n`);
    writeFileSync(join(dir, "b", "y.mjs"), `export const y = 1;\n`);
    const r = moduleReach(join(dir, "a", "index.mjs"), dir);
    assert.deepEqual(r.files.map((f) => relative(dir, f).split(sep).join("/")), ["_shared/x.mjs", "a/index.mjs", "b/y.mjs"]);
    assert.deepEqual(r.outside, ["a/index.mjs imports ../../z.mjs"]);
    assert.deepEqual(r.missing, ["a/gone.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("_shared/ holds no adapter, and its name is one no config can select", () => {
  assert.ok(!readdirSync(SHARED).includes("index.mjs"));
  assert.ok(!catalogue().names.has("_shared"));
  assert.ok(!/^[a-z][a-z0-9-]*$/.test("_shared"), "derive's NAME_RE refuses it, so it can never be or shadow an adapter");
});

// The files one adapter's copy brings, as an app holds them (`<name>/…`,
// `_shared/…`): its folder without `example/` (the detection test's data)
// and every `_shared/` file its modules reach.
export function copySet(name) {
  const own = join(ADAPTERS, name);
  const out = new Set(files(own).filter((p) => !inside(p, join(own, "example"))));
  for (const p of mjs(own)) for (const f of moduleReach(p, ADAPTERS).files) out.add(f);
  return [...out].sort().map((p) => relative(ADAPTERS, p).split(sep).join("/"));
}

test("an adapter copied alone, with the _shared/ files its imports reach, loads and runs in an empty folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-copy-"));
  const repo = mkdtempSync(join(tmpdir(), "zdd-copy-repo-"));
  try {
    for (const name of [...catalogue().names.keys()]) {
      const to = join(dir, name);
      for (const r of copySet(name)) {
        mkdirSync(dirname(join(to, ...r.split("/"))), { recursive: true });
        cpSync(join(ADAPTERS, ...r.split("/")), join(to, ...r.split("/")));
      }
      const mod = await import(pathToFileURL(join(to, name, "index.mjs")).href);
      assert.equal(typeof mod.derive, "function", name);
      const out = mod.derive({ repoRoot: repo, options: {}, io: makeExtractorIo(repo, name) });
      assert.ok(Array.isArray(out.records), `${name} derives on an empty repo from its copy`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("the copy set is computed from imports alone: a _shared/ file no import reaches does not travel", () => {
  assert.ok(!copySet("generic").some((r) => r.startsWith("_shared/")), "generic imports no shared code");
  const js = copySet("components");
  for (const f of ["_shared/js/source.mjs", "_shared/template-paths.mjs", "_shared/paths.mjs"]) assert.ok(js.includes(f), f);
  assert.ok(!js.some((r) => r.startsWith("_shared/python/") || r.startsWith("_shared/background/")), "a JS adapter brings no Python or background code");
});

// The adapter tests that travel with their adapter: each imports node:
// built-ins, its own adapter's files and the `_shared/` files they reach,
// and ./adapter-kit.mjs, the one seam to ZDD, which an app provides beside
// them. Nothing of the core directly.
const TRAVELLING_TESTS = { "sql-replay.test.mjs": "supabase", "supabase-formats.test.mjs": "supabase", "supabase.test.mjs": "supabase", "fastapi.test.mjs": "fastapi", "wrapper-resolution.test.mjs": "nextjs" };

test("an adapter's travelling tests reach ZDD only through adapter-kit.mjs", () => {
  const problems = [];
  const TEST = join(PKG, "test");
  for (const [file, name] of Object.entries(TRAVELLING_TESTS)) {
    const text = readFileSync(join(TEST, file), "utf8");
    const { code } = lexJs(text);
    for (const m of code.matchAll(STATIC_IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith("node:") || spec === "./adapter-kit.mjs") continue;
      const target = resolve(TEST, spec);
      if (!spec.startsWith(".") || !(inside(target, join(ADAPTERS, name)) || inside(target, SHARED))) problems.push(`test/${file}: imports ${spec}`);
    }
  }
  assert.deepEqual(problems, []);
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
