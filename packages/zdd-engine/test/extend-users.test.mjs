// Who uses an `extend` blessing's code (ZDD-10, finding 1 of PressPlay's
// move to 0.11.0; decision 0046): render reads the source's imports of the
// exemplar's file, through the readers the repo's own adapters carry
// (`IMPORTS`: JavaScript/TypeScript with tsconfig `paths` and workspace
// packages, and Python), one user per file, and says why when it cannot
// tell. Before, a user was only a record that referenced the exemplar's
// records, so a lib file with no record was "unknown" and one imported
// through `@/` was "used by nothing".
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { IMPORTS as JS } from "../src/adapters/js/imports.mjs";
import { IMPORTS as PY } from "../src/adapters/python/imports.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { importersOf, importReaders } from "../src/core/lib/importers.mjs";
import { buildBlessingIndex } from "../src/core/lib/blessing-index.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");
const FASTAPI = join(PKG, "test", "fixture-fastapi");

const tmp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-users-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const put = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
};
const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const resolverOver = (root, reader) => reader.resolver(makeExtractorIo(root, "test"));
const bless = (id, where, extra = "") => `---\nwhere: ${where}\nkind: extend\n${extra}---\n\n${id}? Extend it, because the tests cover it.\n`;
const lineOf = (index, question) => index.split("\n").find((l) => l.includes(`[${question}?]`)) ?? `(no line for ${question})`;

test("JS reader: relative, tsconfig `paths` (with baseUrl and extends), workspace packages by `exports`, re-exports, require and import(); type-only and commented imports too, a string is not one", (t) => {
  const root = tmp(t);
  put(root, {
    "tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "~shared/*": ["packages/shared/src/*"] } } }),
    // A child's `paths` replace its parent's (TypeScript's rule); its own
    // baseUrl puts them under its folder.
    "apps/web/tsconfig.json": "// comments and trailing commas are allowed in a tsconfig\n" + '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], "#config": ["./src/config/index.ts"], }, }, }\n',
    // No options of its own: the base's paths, under the base's baseUrl.
    "packages/tool/tsconfig.json": '{ "extends": "../../tsconfig.base" }\n',
    "apps/web/src/lib/upload.ts": "export function upload() {}\n",
    "apps/web/src/lib/index.ts": "export * from './upload';\n",
    "apps/web/src/config/index.ts": "export const config = {};\n",
    "packages/shared/package.json": JSON.stringify({ name: "@acme/shared", exports: { "./clients": "./clients.ts", ".": { import: "./index.ts" } } }),
    "packages/shared/clients.ts": "export const c = 1;\n",
    "packages/shared/index.ts": "export const i = 1;\n",
    "packages/shared/src/util.ts": "export const u = 1;\n",
  });
  const importsOf = resolverOver(root, JS);
  const text = [
    'import { upload } from "@/lib/upload";',
    "import type { X } from '../lib/upload';",
    'export { upload as up } from "@/lib";',
    'const c = require("@acme/shared/clients");',
    'const i = await import("@acme/shared");',
    'import "#config";',
    'import { u } from "~shared/util";', // the base's alias: replaced here, so nothing
    'import React from "react";',
    '// import { gone } from "@/lib/gone-in-a-comment";',
    'const s = "import x from \\"@/config/index\\"";',
  ].join("\n");
  assert.deepEqual(importsOf("apps/web/src/components/Picker.tsx", text), [
    "apps/web/src/config/index.ts",
    "apps/web/src/lib/index.ts",
    "apps/web/src/lib/upload.ts",
    "packages/shared/clients.ts",
    "packages/shared/index.ts",
  ]);
  assert.deepEqual(importsOf("packages/tool/run.ts", 'import { u } from "~shared/util";\nimport { c } from "@/lib/upload";\n'), ["packages/shared/src/util.ts"]);
  assert.ok(JS.extensions.includes(".tsx") && JS.extensions.includes(".mjs"));
  assert.ok(JS.isTest("apps/web/src/lib/upload.test.ts") && JS.isTest("apps/web/src/__tests__/x.ts") && JS.isTest("types/x.d.ts") && !JS.isTest("apps/web/src/lib/upload.ts"));
});

test("JS reader, toolchain cases (campaign CR-201–204, 213, 214): exact alias before a catch-all; the effective baseUrl rebases inherited paths (TypeScript's rule); an extends loop ends; exports by condition order and import form, a target outside the repo passed over; wildcard exports and main; `.js` names `.ts` from TypeScript; backslashes in a config", (t) => {
  const root = tmp(t);
  put(root, {
    // CR-202: `foo` is exact, `*` a catch-all; both targets exist.
    "a/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "*": ["fallback/*"], foo: ["exact"] } } }),
    "a/fallback/foo.ts": "", "a/exact.ts": "",
    // CR-201 (verified against TypeScript, kept): the child's baseUrl is the
    // effective one, so the parent's paths resolve under it.
    "b/tsconfig.base.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["shared/*"] } } }),
    "b/app/tsconfig.json": JSON.stringify({ extends: "../tsconfig.base.json", compilerOptions: { baseUrl: "." } }),
    "b/app/shared/x.ts": "", "b/shared/x.ts": "",
    // A parent declaring paths with no baseUrl anywhere: its own folder.
    "c/tsconfig.base.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["lib/*"] } } }),
    "c/app/tsconfig.json": JSON.stringify({ extends: "../tsconfig.base.json" }),
    "c/lib/y.ts": "",
    // CR-203: a loop of extends ends, paths and all.
    "d/tsconfig.json": JSON.stringify({ extends: "./other.json", compilerOptions: { paths: { "#d": ["./d.ts"] } } }),
    "d/other.json": JSON.stringify({ extends: "./tsconfig.json" }),
    "d/d.ts": "",
    // CR-214: a config written on Windows.
    "e/tsconfig.json": '{ "extends": ".\\\\base\\\\tsconfig.json" }',
    "e/base/tsconfig.json": '{ "compilerOptions": { "paths": { "@e/*": ["..\\\\src\\\\*"] } } }',
    "e/src/z.ts": "",
    // CR-204: conditions in the manifest's order, by import form; a dist
    // target git ignores is not in the repo, so the source branch is taken.
    "packages/p/package.json": JSON.stringify({ name: "@acme/p", exports: { ".": { require: "./cjs.cts", import: "./esm.ts" }, "./tools/*": { source: "./src/tools/*.ts", default: "./dist/tools/*.js" } } }),
    "packages/p/cjs.cts": "", "packages/p/esm.ts": "", "packages/p/src/tools/fmt.ts": "",
    "packages/q/package.json": JSON.stringify({ name: "@acme/q", main: "./lib/main.js" }),
    "packages/q/lib/main.ts": "",
    "packages/r/package.json": JSON.stringify({ name: "@acme/r" }),
    "packages/r/index.ts": "",
    // CR-213: both files present.
    "f/shared.ts": "", "f/shared.js": "",
  });
  const importsOf = resolverOver(root, JS);
  assert.deepEqual(importsOf("a/x.ts", 'import "foo";'), ["a/exact.ts"]);
  assert.deepEqual(importsOf("b/app/x.ts", 'import "@/x";'), ["b/app/shared/x.ts"]);
  assert.deepEqual(importsOf("c/app/x.ts", 'import "~/y";'), ["c/lib/y.ts"]);
  assert.deepEqual(importsOf("d/x.ts", 'import "#d";'), ["d/d.ts"]);
  assert.deepEqual(importsOf("e/x.ts", 'import "@e/z";'), ["e/src/z.ts"]);
  assert.deepEqual(importsOf("apps/x.mjs", 'import "@acme/p";'), ["packages/p/esm.ts"]);
  assert.deepEqual(importsOf("apps/x.cjs", 'const p = require("@acme/p");'), ["packages/p/cjs.cts"]);
  assert.deepEqual(importsOf("apps/x.ts", 'import "@acme/p/tools/fmt";'), ["packages/p/src/tools/fmt.ts"]);
  assert.deepEqual(importsOf("apps/x.ts", 'import "@acme/q";\nimport "@acme/r";'), ["packages/q/lib/main.ts", "packages/r/index.ts"]);
  assert.deepEqual(importsOf("f/a.ts", 'import "./shared.js";'), ["f/shared.ts"]);
  assert.deepEqual(importsOf("f/a.mjs", 'import "./shared.js";'), ["f/shared.js"], "from JavaScript the file as named");
});

test("Python reader: absolute imports from the package's root folder, relative imports, `from pkg import module`, `import a.b as c`; a string or a comment is not one", (t) => {
  const root = tmp(t);
  put(root, {
    "apps/api/app/__init__.py": "",
    "apps/api/app/audit.py": "def record(): ...\n",
    "apps/api/app/auth/__init__.py": "",
    "apps/api/app/auth/gate.py": "def gate(): ...\n",
    "apps/api/app/jobs/generators/__init__.py": "",
    "apps/api/app/jobs/__init__.py": "",
    "apps/api/app/routes/__init__.py": "",
    "apps/api/app/routes/helpers.py": "",
  });
  const importsOf = resolverOver(root, PY);
  const text = [
    "from app.audit import record",
    "import app.auth.gate as gate",
    "from app.jobs import generators",
    "from . import helpers",
    "from ..auth import gate as g2",
    "import os, json",
    "# from app.gone import x",
    "s = 'from app.audit import nothing'",
    "from app.routes.helpers import (",
    "    a,",
    ")",
  ].join("\n");
  // Campaign CR-205: after a `;`, and in a one-line suite.
  assert.deepEqual(importsOf("apps/api/app/x.py", "setup(); from app.audit import record\nif TYPE_CHECKING: from app.auth import gate\ntry: import app.jobs\nexcept ImportError: pass\n"), [
    "apps/api/app/__init__.py",
    "apps/api/app/audit.py",
    "apps/api/app/auth/__init__.py",
    "apps/api/app/auth/gate.py",
    "apps/api/app/jobs/__init__.py",
  ]);
  assert.deepEqual(importsOf("apps/api/app/routes/jobs.py", text), [
    "apps/api/app/__init__.py",
    "apps/api/app/audit.py",
    "apps/api/app/auth/__init__.py",
    "apps/api/app/auth/gate.py",
    "apps/api/app/jobs/__init__.py",
    "apps/api/app/jobs/generators/__init__.py",
    "apps/api/app/routes/__init__.py",
    "apps/api/app/routes/helpers.py",
  ]);
  assert.ok(PY.isTest("apps/api/tests/test_audit.py") && PY.isTest("apps/api/app/audit_test.py") && !PY.isTest("apps/api/app/audit.py"));
});

test("render: an extend blessing's users are the files that import its exemplar (one per file, a record's name where one holds the file); a test is not a user; a file no reader reads says why", (t) => {
  const repo = tmp(t);
  cpSync(FIXTURE, repo, { recursive: true });
  put(repo, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    "src/lib/upload-client.ts": "// Uploads straight to storage.\nexport async function uploadMedia() {}\n",
    "src/components/MediaPicker.tsx": 'import { uploadMedia } from "@/lib/upload-client";\nexport function MediaPicker() { return <div />; }\n',
    "src/components/Toolbar.tsx": 'import { uploadMedia } from "../lib/upload-client";\nimport { MediaPicker } from "./MediaPicker";\nexport function Toolbar() { return <MediaPicker />; }\nexport function ToolbarButton() { return <button />; }\n',
    "scripts/seed.mjs": 'import { uploadMedia } from "../src/lib/upload-client.ts";\n',
    "src/lib/upload-client.test.ts": 'import { uploadMedia } from "./upload-client";\n',
    "src/lib/orphan.ts": "export const nobody = 1;\n",
    ".github/actions/creds/action.yml": "runs: { using: composite }\n",
    "zdd/blessings/adding-an-upload.md": bless("Adding an upload", "src/lib/upload-client.ts (uploadMedia)"),
    "zdd/blessings/reusing-the-orphan.md": bless("Reusing the orphan", "src/lib/orphan.ts"),
    "zdd/blessings/reading-creds.md": bless("Reading creds", ".github/actions/creds/action.yml"),
    "zdd/blessings/using-the-picker.md": bless("Using the picker", "src/components/MediaPicker.tsx"),
  });
  // The fixture's bundle, spelled out, plus `components` (records for the
  // pickers, so a user can be named by its record).
  const { adapter: _bundle, adapterOptions: { migrationNamespaces, externalBuckets, ...nextjs }, ...config } = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  config.extractors = ["supabase", "supabase-js", "nextjs", "components"];
  config.extractorOptions = { supabase: { migrationNamespaces, externalBuckets }, nextjs };
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config, null, 2));
  assert.equal(run(repo, ["derive"]).status, 0);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  const index = readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8");
  assert.match(lineOf(index, "Adding an upload"), /used by 3: MediaPicker, Toolbar, scripts\/seed\.mjs ·/, index);
  assert.match(lineOf(index, "Reusing the orphan"), /`src\/lib\/orphan\.ts`, used by nothing ZDD sees ·/);
  assert.match(lineOf(index, "Reading creds"), /`\.github\/actions\/creds\/action\.yml`, users unknown to ZDD \(it reads the imports of JavaScript and TypeScript files only\) ·/);
  assert.match(lineOf(index, "Using the picker"), /used by 1: Toolbar ·/, "a file with two components is one user, named once");
  assert.match(lineOf(index, "Saving a thing"), /used by 1: \/api\/things\/\[id\] ·/, "a record that references the exemplar's records still counts");
  // The human index carries the same users.
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  const bundle = JSON.parse(/window\.BUNDLE = (.*);\n/.exec(html)[1]);
  const upload = bundle.docs.blessings.find((x) => x.id === "adding-an-upload");
  assert.equal(upload.usedBy.count, 3);
  assert.deepEqual(upload.usedBy.shown.map((u) => u.title), ["MediaPicker", "Toolbar", "scripts/seed.mjs"]);
  assert.equal(upload.usedBy.shown[2].node, null, "a file no record holds links nowhere");
  assert.equal(run(repo, ["render", "--check"]).status, 0, "deterministic: a second read of the same bytes is the same index");
});

test("render: a Python repo's extend blessing is used by the modules that import it", (t) => {
  const repo = tmp(t);
  cpSync(FASTAPI, repo, { recursive: true });
  put(repo, {
    "api/__init__.py": "",
    "api/audit.py": "def record(): ...\n",
    "api/routes/__init__.py": "",
    "api/routes/billing.py": "from api.audit import record\n",
    "tests/test_audit.py": "from api.audit import record\n",
    "zdd/blessings/recording-an-audit.md": bless("Recording an audit", "api/audit.py"),
  });
  writeFileSync(join(repo, "api", "routes", "jobs.py"), "from ..audit import record\n" + readFileSync(join(FASTAPI, "api", "routes", "jobs.py"), "utf8"));
  assert.equal(run(repo, ["derive"]).status, 0);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  const line = lineOf(readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8"), "Recording an audit");
  assert.match(line, /`api\/audit\.py`, used by 2: [^·]*api\/routes\/billing\.py/, line);
  assert.doesNotMatch(line, /test_audit/);
});

test("importers (campaign CR-200, 215, 217): a scan cut short is incomplete, never a confident zero; every reader for an ending reads it, answers joined; a test is a user of a test fixture", (t) => {
  const root = tmp(t);
  put(root, {
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": 'import { a } from "./a";\n',
    "src/c.ts": "// a big file\n" + "x".repeat(4096) + '\nimport { a } from "./a";\n',
    "test/fixture.ts": "export const f = 1;\n",
    "test/one.test.ts": 'import { f } from "./fixture";\n',
    "src/d.ts": 'import { f } from "../test/fixture";\n', // product code using a fixture: still a user
    "src/e.ts": "// #uses src/a.ts\n",
  });
  const full = importersOf(root, [JS], ["src/a.ts", "test/fixture.ts"]);
  assert.equal(full.incomplete, null);
  assert.deepEqual(full.users.get("src/a.ts").importers, ["src/b.ts", "src/c.ts"]);
  assert.deepEqual(full.users.get("test/fixture.ts").importers, ["src/d.ts", "test/one.test.ts"], "a test file uses a test fixture");
  // The read budget runs out before every file is read.
  const cut = importersOf(root, [JS], ["src/a.ts"], { limits: { maxTotalBytes: 200 } });
  assert.match(cut.incomplete, /ran out of budget/);
  assert.equal(cut.users.get("src/a.ts").incomplete, cut.incomplete);
  // The index never says "used by nothing" of a scan cut short.
  const b = { id: "x", kind: "extend", where: { path: "src/a.ts" }, adrs: [], shape: { question: "Extending a?", visible: "", because: "because" } };
  const line = (users, incomplete) => buildBlessingIndex([b], { adrHref: () => null, blessingHref: () => "b.md", mapPage: () => null, usersOf: () => users, incomplete: () => incomplete }).text.split("\n").find((l) => l.includes("Extending a?"));
  assert.match(line([], "ZDD's read of the source ran out of budget"), /users unknown to ZDD \(ZDD's read of the source ran out of budget\)/);
  assert.match(line([{ id: "src/b.ts", title: "src/b.ts" }], "ZDD's read of the source ran out of budget"), /used by 1 or more: src\/b\.ts \(ZDD's read of the source ran out of budget\)/);
  // Two readers claiming `.ts`: both read every file, answers joined.
  const marker = { label: "markers", extensions: [".ts"], skipDirs: [], isTest: () => false, resolver: () => (rel, text) => [...text.matchAll(/#uses (\S+)/g)].map((m) => m[1]) };
  assert.deepEqual(importersOf(root, [JS, marker], ["src/a.ts"]).users.get("src/a.ts").importers, ["src/b.ts", "src/c.ts", "src/e.ts"]);
  assert.deepEqual(importersOf(root, [marker, JS], ["src/a.ts"]).users.get("src/a.ts").importers, ["src/b.ts", "src/c.ts", "src/e.ts"], "order does not matter");
  assert.equal(importReaders([{ IMPORTS: JS }, { IMPORTS: JS }, {}, { IMPORTS: marker }]).length, 2, "a reader shared by adapters is one reader");
});

test("render (campaign CR-217): a local adapter's own IMPORTS names the users of a blessing on a file only it reads", (t) => {
  const repo = tmp(t);
  cpSync(FIXTURE, repo, { recursive: true });
  put(repo, {
    "zdd/extractors/cfg.mjs": [
      "export const CONTRACT = 1;",
      "export const COMMENT = { '.cfg': '#' };",
      "export function derive() { return { records: [], diagnostics: [] }; }",
      "export const IMPORTS = { label: 'cfg', extensions: ['.cfg'], skipDirs: [], isTest: () => false,",
      "  resolver: () => (rel, text) => [...text.matchAll(/^include (\\S+)$/gm)].map((m) => m[1]) };",
      "",
    ].join("\n"),
    "conf/base.cfg": "key = 1\n",
    "conf/prod.cfg": "include conf/base.cfg\n",
    "zdd/blessings/sharing-config.md": bless("Sharing config", "conf/base.cfg"),
  });
  const p = join(repo, "zdd", "config.json");
  const config = JSON.parse(readFileSync(p, "utf8"));
  config.localExtractorDir = "zdd/extractors";
  const { adapter: _bundle, adapterOptions: { migrationNamespaces, externalBuckets, ...nextjs }, ...rest } = config;
  writeFileSync(p, JSON.stringify({ ...rest, extractors: ["supabase", "supabase-js", "nextjs", "cfg"], extractorOptions: { supabase: { migrationNamespaces, externalBuckets }, nextjs } }, null, 2));
  assert.equal(run(repo, ["derive"]).status, 0, run(repo, ["derive"]).stderr);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(lineOf(readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8"), "Sharing config"), /`conf\/base\.cfg`, used by 1: conf\/prod\.cfg ·/);
});

test("verify pass 1 (CR-219, 220, 203): the exports fallback never crosses import and require; a reader's test verdict is its own; an extends chain past the guard is an incomplete read", (t) => {
  const root = tmp(t);
  put(root, {
    // CR-219: the import target is built output (not in the repo); the
    // require target is; a custom `source` branch is the fallback.
    "packages/p/package.json": JSON.stringify({ name: "@acme/p", exports: { ".": { import: "./dist/esm.js", require: "./cjs.cts" }, "./s": { import: "./dist/s.js", source: "./src/s.ts", require: "./s.cts" } } }),
    "packages/p/cjs.cts": "", "packages/p/src/s.ts": "", "packages/p/s.cts": "",
    "src/a.ts": "",
    "src/one.test.ts": 'import "./a";\n// #uses src/a.ts\n',
  });
  const importsOf = resolverOver(root, JS);
  assert.deepEqual(importsOf("apps/x.mjs", 'import "@acme/p";'), [], "an import never lands on the require target");
  assert.deepEqual(importsOf("apps/x.mjs", 'import "@acme/p/s";'), ["packages/p/src/s.ts"]);
  assert.deepEqual(importsOf("apps/x.cjs", 'require("@acme/p/s");'), ["packages/p/s.cts"]);
  // CR-220: a second reader that does not call the file a test keeps it.
  const marker = { label: "markers", extensions: [".ts"], skipDirs: [], isTest: () => false, resolver: () => (rel, text) => [...text.matchAll(/#uses (\S+)/g)].map((m) => m[1]) };
  assert.deepEqual(importersOf(root, [JS, marker], ["src/a.ts"]).users.get("src/a.ts").importers, ["src/one.test.ts"]);
  assert.deepEqual(importersOf(root, [JS], ["src/a.ts"]).users.get("src/a.ts").importers, [], "the JS reader alone: a test is not a user");
  // CR-203: a chain longer than the guard.
  const deep = tmp(t);
  const files = { "src/b.ts": "", "src/c.ts": 'import "@/b";\n' };
  for (let k = 0; k < 70; k++) files[`cfg/t${k}.json`] = JSON.stringify(k === 69 ? { compilerOptions: { baseUrl: "..", paths: { "@/*": ["src/*"] } } } : { extends: `./t${k + 1}.json` });
  files["src/tsconfig.json"] = JSON.stringify({ extends: "../cfg/t0.json" });
  put(deep, files);
  const found = importersOf(deep, [JS], ["src/b.ts"]);
  assert.match(found.incomplete ?? "", /extends/);
});
