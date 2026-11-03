// The border between the core and the adapters (decisions 0036 and 0048):
// the core knows no stack and holds no adapter. Since 0.14 every adapter a
// repo runs is its own, in its localExtractorDir, and the starters are a
// second package the core depends on nothing in; detection and the preview
// read whichever folder of adapters they are handed (lib/adapter-folder.mjs).
// From the other side an adapter imports nothing of the core (the starter
// library's own suite holds that, test/self-contained.test.mjs there).
//
// Three rules hold it here, and the first is the guarantee:
//
// 1. Imports. A core file imports only Node's built-in modules (`node:…`)
//    and other core files, by a quoted relative path. A computed import
//    (`import(x)`) appears only in the loaders that turn a name or a folder
//    into a module: derive.mjs and lib/adapter-folder.mjs (adapters) and
//    viewers/index.mjs (viewers). `require` and `createRequire` appear
//    nowhere. And no core file spells a path out of src/ into an adapters
//    folder beside it (`../adapters/`), so an import built from pieces,
//    wrapped in `new URL`, or hidden behind a comment still has to spell it.
// 2. Words. No core file names a stack, framework, library, platform or
//    vendor, in code or in comments; nor do the engine's own test-only
//    adapters and test fixture. STACK_WORDS (./stack-words.mjs) is a
//    tripwire, not a proof: a finite list catches the names ZDD has met,
//    and it lives here because the core may not hold it. Third-party code
//    vendored into a viewer (`vendor/`) is outside both rules: it is not
//    ours to word.
// 3. No adapter in the package. The engine ships no adapter folder and its
//    published files hold none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readAdapterFolder, folderModules } from "../src/core/lib/adapter-folder.mjs";
import { ioProblems, moduleReach } from "../src/core/lib/suite.mjs";
import { WORD_RE as WORD_RE_OF } from "./stack-words.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(PKG, "src", "core");

const WORD_RE = WORD_RE_OF();
const SOURCE_RE = /\.(mjs|cjs|js|jsx|ts|mts|cts|tsx|css|html|md|json)$/;
const LOADERS = new Set(["src/core/derive.mjs", "src/core/lib/adapter-folder.mjs", "src/core/viewers/index.mjs"]);

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
  if (/\.\.[\\/](?:[^"'`\s]*[\\/])?adapters[\\/]/.test(text)) problems.push(`${path}: names a path into an adapters folder beside the core`);
  return problems;
}

test("core files import only node: built-ins and other core files, and spell no path into an adapters folder beside them", () => {
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
  assert.ok(caught(`const where = "..\\\\adapters\\\\fastapi";`), "backslash path");
  assert.ok(!caught(`import { join } from "node:path";\nimport { a } from "./lib/paths.mjs";\nconst t = "a from 'x'";`), "the allowed forms pass");
  assert.ok(!borderProblems("src/core/derive.mjs", `return import(pathToFileURL(p).href);`).length, "the adapter loader may compute");
  assert.ok(!borderProblems("src/core/lib/adapter-folder.mjs", `await import(pathToFileURL(entry).href)`).length, "so may the folder reader");
  assert.ok(!caught(`// the starter library's adapters/, or zdd/extractors in an app`), "naming an app's adapters folder is no path out of the core");
});

test("no core file names a stack, in code or in comments; nor do the engine's test-only adapters and fixture", () => {
  const offenders = [];
  for (const p of [...files(CORE), ...files(join(PKG, "test", "adapters")), ...files(join(PKG, "test", "fixture"))]) {
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

// ---- the reach a copy is made from (decision 0048 point 4) ----

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

test("reach resolves an import as Node does: a query, a fragment and an escaped name reach the file Node loads (CR-284)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-reach-url-"));
  try {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "_shared"));
    writeFileSync(join(dir, "a", "index.mjs"), `import { x } from "../_shared/x.mjs?v=1";\nimport { y } from "../_shared/y.mjs#part";\nimport { z } from "../_shared/a%20b.mjs";\nimport { "odd-name" as o } from "../_shared/odd.mjs";\nexport const hint = 'from "./never.mjs"';\nexport const all = x + y + z + o;\n`);
    writeFileSync(join(dir, "_shared", "odd.mjs"), `const o = 4;\nexport { o as "odd-name" };\n`);
    writeFileSync(join(dir, "_shared", "x.mjs"), `export const x = 1;\n`);
    writeFileSync(join(dir, "_shared", "y.mjs"), `export const y = 2;\n`);
    writeFileSync(join(dir, "_shared", "a b.mjs"), `export const z = 3;\n`);
    const r = moduleReach(join(dir, "a", "index.mjs"), dir);
    assert.deepEqual(r.files.map((f) => relative(dir, f).split(sep).join("/")), ["_shared/a b.mjs", "_shared/odd.mjs", "_shared/x.mjs", "_shared/y.mjs", "a/index.mjs"]);
    assert.deepEqual([r.outside, r.missing, r.limit], [[], [], null], "a string holding `from \"./x\"` is not an import; a quoted name before `from` is (CR-289)");
    assert.equal((await import(pathToFileURL(join(dir, "a", "index.mjs")).href)).all, 10, "Node loads the same files");
    writeFileSync(join(dir, "a", "fs.mjs"), `import { "readFileSync" as r } from "node:fs";\nexport const x = r;\n`);
    assert.deepEqual(ioProblems(join(dir, "a", "fs.mjs"), dir), ["a/fs.mjs imports node:fs"], "check 5 reads the same imports");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reach never goes through a link, and stops at its limits (CR-278, CR-279)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-reach-link-"));
  const away = mkdtempSync(join(tmpdir(), "zdd-reach-away-"));
  try {
    mkdirSync(join(dir, "a"));
    mkdirSync(join(dir, "_shared"));
    writeFileSync(join(away, "h.mjs"), `export const h = 1;\n`);
    writeFileSync(join(dir, "a", "index.mjs"), `import { h } from "../_shared/link/h.mjs";\n`);
    let linked = true;
    try {
      symlinkSync(away, join(dir, "_shared", "link"), "junction");
    } catch {
      linked = false;
    }
    if (linked) {
      const r = moduleReach(join(dir, "a", "index.mjs"), dir);
      assert.deepEqual(r.files.map((f) => relative(dir, f).split(sep).join("/")), ["a/index.mjs"], "nothing behind the link is read");
      assert.deepEqual(r.outside, ["a/index.mjs imports ../_shared/link/h.mjs, through a link"]);
    } else t.diagnostic("this machine cannot create links: the link case is not run");
    writeFileSync(join(dir, "a", "index.mjs"), `import { big } from "../_shared/big.mjs";\n`);
    writeFileSync(join(dir, "_shared", "big.mjs"), `export const big = "${"x".repeat(1024 * 1024)}";\n`);
    const r = moduleReach(join(dir, "a", "index.mjs"), dir);
    assert.match(r.limit, /_shared\/big\.mjs is over 1048576 bytes/);
    // A long chain is walked without recursion: no stack to overflow.
    for (let i = 0; i < 3000; i++) writeFileSync(join(dir, "_shared", `c${i}.mjs`), i < 2999 ? `import "./c${i + 1}.mjs";\n` : `export {};\n`);
    writeFileSync(join(dir, "a", "index.mjs"), `import "../_shared/c0.mjs";\n`);
    assert.equal(moduleReach(join(dir, "a", "index.mjs"), dir).files.length, 3001);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(away, { recursive: true, force: true });
  }
});

// ---- the folder of adapters (CR-001, CR-002) ----

const inside = (abs, dir) => abs === dir || abs.startsWith(dir + sep);

function fixtureFolder(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "zdd-adapters-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const adapter = (name) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "index.mjs"), "export function derive() { return { records: [], diagnostics: [] }; }\n");
  };
  adapter("alpha");
  adapter("beta");
  build(dir, adapter);
  return dir;
}

test("the engine ships no adapter: no adapters folder, none in its published files (decision 0048)", () => {
  assert.ok(!statSync(join(PKG, "src"), { throwIfNoEntry: false }) || !readdirSync(join(PKG, "src")).includes("adapters"), "src/adapters is gone");
  const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
  const published = manifest.files.flatMap((f) => (statSync(join(PKG, f)).isDirectory() ? files(join(PKG, f)) : [join(PKG, f)]));
  assert.ok(!published.some((p) => /[\\/](?:index|detect)\.mjs$/.test(p) && !inside(p, CORE) && !inside(p, join(PKG, "bin"))), "no adapter module outside the core and the bin");
  assert.ok(!published.some((p) => /catalogue\.(?:mjs|json)$/.test(p)), "no catalogue");
});

test("a folder of adapters: a name with an index.mjs is an adapter; a helpers folder, _shared/ and a name config could never select are not", (t) => {
  const dir = fixtureFolder(t, (dir, adapter) => {
    mkdirSync(join(dir, "shared"));
    adapter("_shared");
    adapter("Foo.bar");
    writeFileSync(join(dir, "loose.mjs"), "export {};\n");
  });
  assert.deepEqual([...readAdapterFolder(dir).keys()], ["alpha", "beta"]);
  assert.ok(!/^[a-z][a-z0-9-]*$/.test("_shared"), "derive's NAME_RE refuses it, so it can never be an adapter");
});

test("a folder of adapters that is not there, or not a folder, is said plainly", (t) => {
  const dir = fixtureFolder(t, () => {});
  assert.throws(() => readAdapterFolder(join(dir, "missing")), /the adapter folder .* does not exist/);
  assert.throws(() => readAdapterFolder(join(dir, "alpha", "index.mjs")), /is a link or not a folder/);
});

test("CR-001: a linked adapter folder or index.mjs is refused, never followed", (t) => {
  const outside = mkdtempSync(join(tmpdir(), "zdd-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "index.mjs"), "export function derive() {}\n");
  let made = true;
  const linked = fixtureFolder(t, (dir) => {
    try {
      symlinkSync(outside, join(dir, "gamma"), "junction");
    } catch {
      made = false;
    }
  });
  if (made) assert.throws(() => readAdapterFolder(linked), /gamma in the adapter folder .* is a link/);
  let fileLink = true;
  const fileLinked = fixtureFolder(t, (dir) => {
    mkdirSync(join(dir, "delta"));
    try {
      symlinkSync(join(outside, "index.mjs"), join(dir, "delta", "index.mjs"), "file");
    } catch {
      fileLink = false;
    }
  });
  if (fileLink) assert.throws(() => readAdapterFolder(fileLinked), /delta\/index\.mjs in the adapter folder .* is not a regular file/);
  if (!made && !fileLink) t.skip("this machine cannot create symlinks");
});

test("folderModules loads every adapter of the folder it is given, in name order, with its entry", async (t) => {
  const dir = fixtureFolder(t, () => {});
  const got = await folderModules(dir);
  assert.deepEqual(got.map((m) => [m.name, m.entry, typeof m.mod.derive]), [["alpha", join(dir, "alpha", "index.mjs"), "function"], ["beta", join(dir, "beta", "index.mjs"), "function"]]);
});
