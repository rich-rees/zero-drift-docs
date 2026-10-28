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
