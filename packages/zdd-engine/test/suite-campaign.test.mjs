// The slice 5 campaign's findings on the standard suite (CR-118 to CR-148,
// the suite's own items): one test per finding, each shown red without its
// fix. The local adapter here is the one suite-local.test.mjs uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { commentOut, blankOut, ioProblems } from "../src/core/lib/suite.mjs";
import { narrateSuite } from "../src/core/suite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "bin", "zdd-engine.mjs");

const GOOD = `export const CONTRACT = 1;
export const COMMENT = { ".txt": "#" };
export const SUITE = { options: { roots: ["routes"] } };
export function derive({ options, io }) {
  const records = [];
  const diagnostics = [];
  for (const root of options.roots ?? ["routes"]) {
    const walked = io.walk(root, (rel) => {
      if (!rel.endsWith(".txt")) return;
      const got = io.read(rel);
      if (!got.ok) return diagnostics.push(got.reason);
      for (const line of got.text.split("\\n")) {
        const m = /^GET (\\/\\S*)$/.exec(line.replace(/#.*$/, "").trim());
        if (m) records.push({ kind: "route", id: "route:" + m[1], title: m[1], description: "", resource: [rel], refs: [], facts: {}, filename: m[1].replace(/\\//g, "-") + ".json" });
      }
    });
    if (!walked.exists) diagnostics.push(root + " is missing — nothing to inventory");
  }
  return { records, diagnostics };
}
`;
const FIXTURE = { "routes/things.txt": "GET /things\n# GET /old\n", "routes/notes.md": "not read\n" };

function scratch(t, { adapter = GOOD, name = "acme-routes", suiteChecks = 5, fixture = FIXTURE, files = {}, extractors } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-suite-cr-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const write = (rel, text) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  const config = { name: "acme", extractors: extractors ?? [name], extractorOptions: { [name]: { roots: ["routes"] } }, localExtractorDir: "zdd/extractors", render: { storeChanges: false } };
  if (suiteChecks !== null) config.suiteChecks = suiteChecks;
  write("zdd/config.json", JSON.stringify(config, null, 2));
  write(`zdd/extractors/${name}/index.mjs`, adapter);
  for (const [rel, text] of Object.entries(fixture)) write(`zdd/extractors/${name}/fixture/${rel}`, text);
  for (const [rel, text] of Object.entries(files)) write(`zdd/extractors/${name}/${rel}`, text);
  return repo;
}
function suite(repo, ...args) {
  const r = spawnSync(process.execPath, [BIN, "suite", "--json", `--root=${repo}`, ...args], { encoding: "utf8", timeout: 300_000 });
  return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}
const check = (json, n) => json.adapters[0].checks.find((c) => c.n === n);
const failing = (json) => json.adapters[0].checks.filter((c) => !c.ok).map((c) => c.n);

test("CR-118: check 4 fails when the adapter reads a file COMMENT does not classify; an explicit null (no line comment) is a classification; a file it never reads needs none", (t) => {
  const none = suite(scratch(t, { adapter: GOOD.replace('export const COMMENT = { ".txt": "#" };', "export const COMMENT = {};") }));
  assert.equal(none.status, 1);
  assert.deepEqual(failing(none.json), [4]);
  assert.match(check(none.json, 4).detail, /COMMENT does not say how to comment out routes\/things\.txt/);
  const explicit = suite(scratch(t, { adapter: GOOD.replace('export const COMMENT = { ".txt": "#" };', 'export const COMMENT = { ".txt": null };') }));
  assert.equal(explicit.status, 0, JSON.stringify(explicit.json?.adapters));
  assert.match(check(explicit.json, 4).detail, /takes no line comment/);
  // The .md file is in the fixture but never read: no classification needed.
  assert.equal(suite(scratch(t)).status, 0);
});

test("CR-121: check 5 sees banned calls inside template interpolations and after a regex holding //", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-io-scan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scan = (text) => {
    writeFileSync(join(dir, "index.mjs"), text);
    return ioProblems(join(dir, "index.mjs"), dir);
  };
  assert.match(scan("export const a = `${process.env.CI}`;").join(), /reads process\.env/);
  assert.match(scan("export const a = `x ${`y ${fetch(u)}`}`;").join(), /calls fetch/);
  assert.match(scan("const r = /[//]/; export const h = process.env.HOME;").join(), /reads process\.env/);
  assert.deepEqual(scan("export const ok = `fetch( in text ${1 + 2}`; const re = /require\\(/;"), []);
});

test("CR-122: an import written inside a comment or a template is not an import", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "zdd-io-scan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "index.mjs"), '/*\nimport fs from "node:fs";\n*/\nexport const doc = `\nimport x from "node:fs";\n`;\n// import y from "node:fs";\n');
  assert.deepEqual(ioProblems(join(dir, "index.mjs"), dir), []);
});

test("CR-128 / CR-136: check 5 names every banned route — child_process, network, module, vm, os, a package, require, dynamic import, fetch, a helper that reads fs, a file outside the folder, a core module that reaches fs", (t) => {
  // Beside this file, not in the temp folder: on a CI runner the temp folder
  // can sit on another drive, where no relative path reaches the core.
  const dir = mkdtempSync(join(HERE, ".zdd-io-scan-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const scan = (text, extra = {}) => {
    for (const [rel, body] of Object.entries(extra)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    writeFileSync(join(dir, "index.mjs"), text);
    return ioProblems(join(dir, "index.mjs"), dir).join("\n");
  };
  assert.match(scan('import { execFileSync } from "node:child_process";'), /imports node:child_process/);
  assert.match(scan('import https from "https";'), /imports https/);
  assert.match(scan('import { createRequire } from "node:module";'), /imports node:module/);
  assert.match(scan('import vm from "node:vm";'), /imports node:vm/);
  assert.match(scan('import { homedir } from "node:os";'), /imports node:os/);
  assert.match(scan('import _ from "lodash";'), /imports the package lodash/);
  assert.match(scan("const x = require('fs');"), /calls require/);
  assert.match(scan("const m = await import('./x.mjs');"), /imports dynamically/);
  assert.match(scan("await fetch('https://x');"), /calls fetch/);
  assert.match(scan('import { h } from "./lib/h.mjs";', { "lib/h.mjs": 'import { readFileSync } from "node:fs";\nexport const h = 1;' }), /lib\/h\.mjs imports node:fs/);
  assert.match(scan('import { h } from "../elsewhere.mjs";'), /outside its own folder/);
  const walk = join(HERE, "..", "src", "core", "lib", "walk.mjs");
  assert.match(scan(`import { walkDir } from "${relative(dir, walk).split("\\").join("/")}";`), /reads the filesystem itself/);
  const io = join(HERE, "..", "src", "core", "lib", "extractor-io.mjs");
  assert.doesNotMatch(scan(`import { makeExtractorIo } from "${relative(dir, io).split("\\").join("/")}";`), /reads the filesystem/, "io's own module is the one allowed");
  assert.equal(scan('import { posix } from "node:path";\nimport { fileURLToPath } from "node:url";'), "");
});

test("CR-123: an unknown or retired adapter, named or configured, fails the suite; a catalogue name is skipped", (t) => {
  const repo = scratch(t);
  assert.equal(suite(repo, "--extractors=acme-typo").status, 1);
  assert.equal(suite(repo, "--extractors=jobs").status, 1);
  const skipped = suite(repo, "--extractors=supabase");
  assert.equal(skipped.status, 0);
  assert.deepEqual(skipped.json.skipped, ["supabase"]);
  const gone = suite(scratch(t, { extractors: ["acme-routes", "acme-gone"] }));
  assert.equal(gone.status, 1);
  assert.deepEqual(gone.json.unknown, ["acme-gone"]);
});

test("CR-124: commenting and blanking keep CRLF and CR line endings whole, and add nothing after a final newline", () => {
  assert.equal(commentOut("a\r\nb\r\n", "#"), "# a\r\n# b\r\n");
  assert.equal(commentOut("a\nb", "//"), "// a\n// b");
  assert.equal(commentOut("a\rb\r", "--"), "-- a\r-- b\r");
  assert.equal(blankOut("a\r\nb\r\n"), "\r\n\r\n");
  assert.equal(blankOut("a\nb"), "\n");
});

test("CR-125: a companion's records from config alone are not the adapter's in check 3", (t) => {
  const adapter = GOOD.replace('export const SUITE = { options: { roots: ["routes"] } };', 'export const SUITE = { options: { roots: ["routes"] }, companions: { supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }], externalBuckets: [{ name: "cdn", namespace: "db" }] } } };');
  const r = suite(scratch(t, { adapter }));
  assert.equal(r.status, 0, JSON.stringify(r.json?.adapters));
  assert.equal(check(r.json, 3).ok, true);
});

test("CR-127: check 1 runs the second copy under another HOME, temp folder, user and CI flag, so an environment value that slips past check 5 still fails", (t) => {
  // Reaches the environment in a way check 5's text scan does not see.
  const adapter = GOOD.replace('facts: {}', 'facts: { home: String(globalThis["pro" + "cess"]["e" + "nv"].HOME ?? globalThis["pro" + "cess"]["e" + "nv"].USERPROFILE) }');
  const r = suite(scratch(t, { adapter }));
  assert.equal(r.status, 1);
  assert.deepEqual(failing(r.json), [1]);
});

test("CR-137: check 1's second run is a check of its own — an adapter that reads what the first derive wrote fails it", (t) => {
  // Counts every .json file it can see: zdd/config.json at first, the metadata too on a second run.
  const adapter = GOOD.replace("  return { records, diagnostics };", "  let n = 0;\n  io.walk(\".\", (rel) => { if (rel.endsWith(\".json\")) n++; });\n  for (const r of records) r.facts = { seen: n };\n  return { records, diagnostics };");
  const r = suite(scratch(t, { adapter }));
  assert.equal(r.status, 1);
  assert.deepEqual(failing(r.json), [1]);
  assert.match(check(r.json, 1).detail, /a second run/);
});

test("CR-135: only fixture/, fixture-deep/ and fixture-trap/ are test data; any other folder of the adapter is copied", (t) => {
  const adapter = 'import { helper } from "./fixture-parser/helper.mjs";\n' + GOOD.replace("export const CONTRACT = 1;", "export const CONTRACT = helper();");
  const r = suite(scratch(t, { adapter, files: { "fixture-parser/helper.mjs": "export const helper = () => 1;\n" } }));
  assert.equal(r.status, 0, JSON.stringify(r.json?.adapters));
});

test("CR-148: check 2 also puts an ignored copy beside each fixture file, so an adapter that lists one folder past io fails it", (t) => {
  const adapter = 'import { readdirSync, readFileSync } from "node:fs";\nimport { join } from "node:path";\n' + GOOD.replace("export function derive({ options, io }) {", "export function derive({ repoRoot, options, io }) {").replace(
    "    const walked = io.walk(root, (rel) => {",
    "    const names = (() => { try { return readdirSync(join(repoRoot, root)).filter((n) => n.endsWith('.txt')).sort(); } catch { return []; } })();\n    io = { ...io, walk: (r, onFile) => { names.forEach((n) => onFile(r + '/' + n)); return { exists: names.length > 0, skipped: [] }; }, read: (r) => ({ ok: true, text: readFileSync(join(repoRoot, r), 'utf8') }) };\n    const walked = io.walk(root, (rel) => {",
  );
  const r = suite(scratch(t, { adapter }));
  assert.equal(r.status, 1);
  assert.ok(failing(r.json).includes(2), JSON.stringify(r.json.adapters[0].checks));
});

test("CR-143: SUITE options must be plain data", (t) => {
  const r = suite(scratch(t, { adapter: GOOD.replace('export const SUITE = { options: { roots: ["routes"] } };', 'export const SUITE = { options: { roots: ["routes"], get x() { return 1; }, f() {} } };') }));
  assert.equal(r.status, 1);
  assert.match(check(r.json, 1).detail, /SUITE\.options must be plain data/);
});

test("CR-142: suiteChecks set to 0 is said as 0, not as unset", () => {
  const base = { count: 5, checks: [], adapters: [], skipped: [], unknown: [], blocking: false };
  assert.match(narrateSuite({ ...base, suiteChecks: 0, suiteChecksSet: true }), /suiteChecks: 0/);
  const withOne = narrateSuite({ ...base, suiteChecks: 0, suiteChecksSet: true, adapters: [{ name: "x", declared: 1, records: 1, checks: [] }] });
  assert.match(withOne, /no check blocks \(suiteChecks: 0/);
  assert.doesNotMatch(withOne, /not set/);
  assert.match(narrateSuite({ ...base, suiteChecks: 0, suiteChecksSet: false, adapters: [{ name: "x", declared: 1, records: 1, checks: [] }] }), /suiteChecks is not set/);
});

test("CR-138: derive applies the contract table — behind on a required step stops it, behind on an optional one is said under --verbose only", (t) => {
  const repo = scratch(t);
  // derive in a child process (it exits on a failure), against a test table.
  const script = (table) => `
    import { deriveRecords } from ${JSON.stringify(new URL("../src/core/derive.mjs", import.meta.url).href)};
    import { CONTRACT_TABLE } from ${JSON.stringify(new URL("../src/core/lib/contract.mjs", import.meta.url).href)};
    import { readFileSync } from "node:fs";
    const config = JSON.parse(readFileSync(${JSON.stringify(join(repo, "zdd", "config.json"))}, "utf8"));
    const out = await deriveRecords({ repoRoot: ${JSON.stringify(repo)}, config, contract: { contract: 2, table: [...CONTRACT_TABLE, ${table}] } });
    console.log(JSON.stringify(out.diagnostics));
  `;
  const run = (table) => spawnSync(process.execPath, ["--input-type=module", "-e", script(table)], { encoding: "utf8" });
  const required = run('{ step: "ids", since: 2, required: true, what: "i", ask: null }');
  assert.equal(required.status, 1);
  assert.match(required.stderr, /adapter 'acme-routes' was written for adapter contract 1; contract 2 requires ids/);
  const optional = run('{ step: "queues", since: 2, required: false, what: "q", ask: "Queues?" }');
  assert.equal(optional.status, 0, optional.stderr);
  assert.match(JSON.parse(optional.stdout).join("\n"), /\[contract\] acme-routes was written for contract 1; it does not have "queues" \(contract 2, optional\)/);
  assert.doesNotMatch(optional.stderr, /queues/, "never a warning");
});

test("CR-147: zdd-engine contract prints the table, as words and as JSON", async () => {
  const { CONTRACT, CONTRACT_TABLE } = await import("../src/core/lib/contract.mjs");
  const json = JSON.parse(spawnSync(process.execPath, [BIN, "contract", "--json"], { encoding: "utf8" }).stdout);
  assert.deepEqual(json, { contract: CONTRACT, table: CONTRACT_TABLE });
  const text = spawnSync(process.execPath, [BIN, "contract"], { encoding: "utf8" }).stdout;
  assert.match(text, new RegExp(`speaks adapter contract ${CONTRACT}`));
  for (const r of CONTRACT_TABLE) assert.ok(text.includes(`${r.required ? "required" : "optional"}  ${r.step} (contract ${r.since})`), r.step);
});
