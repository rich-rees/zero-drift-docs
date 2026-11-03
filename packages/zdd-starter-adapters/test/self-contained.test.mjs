// Self-contained starters (decision 0048 point 4): an adapter imports
// nothing of the core. Its one link to ZDD is the contract, the `io` it is
// handed and what it returns. Code starters share is in `_shared/`, and a
// starter's reach is its own folder plus `_shared/`, so copying it brings
// exactly the files its imports reach. Moved here from the engine's border
// test with the starters (0.14).
//
// - No file under adapters/ imports the engine, by any spelling, nor a
//   package, nor anything computed.
// - Every file in a starter's folder reaches, by static relative imports,
//   only its own folder and `_shared/`; a `_shared/` file reaches only
//   `_shared/`. And the reach is the copy: each starter's reached files,
//   copied alone into an empty folder in the layout an app holds them in,
//   import and run.
// - A starter's own tests (adapters/<name>/test/) import node: built-ins,
//   its own files, the `_shared/` files they reach, and ZDD only through the
//   kit, `@rich-rees/zdd` (the engine's public entry): nothing of the core.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { importSpecs, lexJs, moduleReach } from "../../zdd-engine/src/core/lib/suite.mjs";
import { makeExtractorIo } from "../../zdd-engine/src/core/lib/extractor-io.mjs";
import { ADAPTERS, ENGINE, PKG } from "./starters.mjs";

const CORE = join(ENGINE, "src");
const SOURCE_RE = /\.(mjs|cjs|js|jsx|ts|mts|cts|tsx|css|html|md|json|sql|py|txt|toml|yml|yaml)$/;
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (SOURCE_RE.test(name) || !name.includes(".")) out.push(p);
  }
  return out;
}
const rel = (p) => relative(PKG, p).split(sep).join("/");
const starterNames = () => readdirSync(ADAPTERS).filter((n) => readdirSync(join(ADAPTERS, n)).includes("index.mjs")).sort();

const SHARED = join(ADAPTERS, "_shared");
const inside = (abs, dir) => abs === dir || abs.startsWith(dir + sep);
const adapterFolders = () => readdirSync(ADAPTERS).filter((n) => n !== "_shared" && statSync(join(ADAPTERS, n)).isDirectory()).sort();
const tests = (dir) => join(dir, "test");
// A starter's code: its .mjs files, not its own tests, its suite fixture or
// its preview example (those are sample repos, read as data).
const NOT_CODE = /[\\/](?:test|example|fixture[^\\/]*)[\\/]/;
const mjs = (dir) => files(dir).filter((p) => p.endsWith(".mjs") && !NOT_CODE.test(relative(dir, p).replace(/^/, sep)));

// Every import in an adapter-side file that is not a node: built-in. Read
// as check 5 reads one (an adapter's code is full of import-shaped strings
// and regexes): static imports from the code view, a dynamic import or a
// require from the view with strings blanked too, so one is caught however
// its argument is spelt. A bare package is a problem: a copied adapter runs
// under npx with no packages of its own (check 5 says the same).
export function adapterImportProblems(path, text) {
  const problems = [];
  const { mask } = lexJs(text);
  for (const spec of importSpecs(text)) {
    if (spec.startsWith("node:")) continue;
    if (!spec.startsWith(".")) problems.push(`${path}: imports '${spec}', not a relative file`);
    else if (inside(resolve(dirname(join(PKG, path)), spec), CORE) || !inside(resolve(dirname(join(PKG, path)), spec), ADAPTERS)) problems.push(`${path}: imports ${spec}, outside the adapters`);
  }
  if (/\bimport\s*\(/.test(mask)) problems.push(`${path}: imports dynamically`);
  if (/\brequire\s*\(|\bcreateRequire\b/.test(mask)) problems.push(`${path}: uses require/createRequire`);
  return problems;
}

test("no file under adapters/ imports the engine, a package, or anything computed", () => {
  const problems = [];
  for (const name of [...starterNames(), "_shared"]) for (const p of mjs(join(ADAPTERS, name))) problems.push(...adapterImportProblems(rel(p), readFileSync(p, "utf8")));
  assert.deepEqual(problems, []);
});

test("the adapter-side guard catches core imports in every spelling", () => {
  const p = "adapters/x/index.mjs";
  const caught = (src) => adapterImportProblems(p, src).length > 0;
  assert.ok(caught(`import { a } from "../../../zdd-engine/src/core/lib/paths.mjs";`), "plain");
  assert.ok(caught(`export { a } from "../../../zdd-engine/src/core/lib/paths.mjs";`), "re-export");
  assert.ok(caught(`import {\n  a,\n} from "../../../zdd-engine/src/core/lib/paths.mjs";`), "multi-line");
  assert.ok(caught(`import "../../../zdd-engine/src/core/derive.mjs";`), "bare");
  assert.ok(caught(`import("../../core/derive.mjs");`), "dynamic");
  assert.ok(caught(`import("../../" + "core");`), "computed");
  assert.ok(caught(`import { a } from "../_shared/../../../zdd-engine/src/core/lib/paths.mjs";`), "through _shared");
  assert.ok(caught(`import { a } from "some-lib";`), "a package");
  assert.ok(caught(`import { "odd-name" as a } from "../../../zdd-engine/src/core/lib/paths.mjs";`), "a quoted name before from (CR-289)");
  assert.ok(!caught(`import { a } from "../_shared/paths.mjs";\n// import x from "../../core/derive.mjs";\nimport { join } from "node:path";`), "the allowed forms pass, a comment is not an import");
});

test("every adapter reaches only its own folder and _shared/; _shared/ reaches only itself", () => {
  const problems = [];
  const judge = (p, allowed) => {
    const r = moduleReach(p, ADAPTERS);
    for (const m of r.missing) problems.push(`${rel(p)}: reaches ${m}, which is not there`);
    for (const o of r.outside) problems.push(`${rel(p)}: ${o}, outside adapters/`);
    for (const f of r.files) if (!allowed.some((d) => inside(f, d))) problems.push(`${rel(p)}: reaches ${rel(f)}`);
  };
  for (const name of adapterFolders()) for (const p of mjs(join(ADAPTERS, name))) judge(p, [join(ADAPTERS, name), SHARED]);
  for (const p of files(SHARED).filter((f) => f.endsWith(".mjs"))) judge(p, [SHARED]);
  assert.deepEqual(problems, []);
});

test("_shared/ holds no adapter, and its name is one no config can select", () => {
  assert.ok(!readdirSync(SHARED).includes("index.mjs"));
  assert.ok(!starterNames().includes("_shared"));
  assert.ok(!/^[a-z][a-z0-9-]*$/.test("_shared"), "derive's NAME_RE refuses it, so it can never be an adapter or take a name an app might want");
});

// The files one adapter's copy brings, as an app holds them (`<name>/…`,
// `_shared/…`): its folder without `example/` (the preview's data) and every
// `_shared/` file its modules reach. Its own tests travel with it.
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
    for (const name of starterNames()) {
      // Each starter alone in a folder of its own, which plays the app's
      // localExtractorDir: `<to>/<name>/index.mjs` beside `<to>/_shared/`.
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

// A starter's own tests travel with it: node: built-ins, its own files and
// the `_shared/` files they reach, and ZDD only through the kit by the
// package's name, which `zdd-engine test` resolves to the engine running
// them. Nothing of the core directly, so they run the same in an app.
test("a starter's own tests reach ZDD only through @rich-rees/zdd, the kit", () => {
  const problems = [];
  let count = 0;
  for (const name of starterNames()) {
    const dir = tests(join(ADAPTERS, name));
    if (!readdirSync(join(ADAPTERS, name)).includes("test")) continue;
    for (const p of files(dir).filter((f) => f.endsWith(".mjs"))) {
      count++;
      for (const spec of importSpecs(readFileSync(p, "utf8"))) {
        if (spec.startsWith("node:") || spec === "@rich-rees/zdd") continue;
        const target = resolve(dirname(p), spec);
        if (!spec.startsWith(".") || !(inside(target, join(ADAPTERS, name)) || inside(target, SHARED))) problems.push(`${rel(p)}: imports ${spec}`);
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(count >= 5, "the travelling tests are found where they live");
});
