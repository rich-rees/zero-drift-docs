// The standard suite on an adopter's own adapter (decision 0040): a small
// local adapter that passes every check, and one broken copy per check that
// fails exactly that one — so each check is shown to catch what it names.
// Also: the contract judged at derive and in the report, suiteChecks
// deciding what blocks, and a single-module adapter with nowhere to keep a
// fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { judgeContract, stepsSince, CONTRACT, CONTRACT_TABLE } from "../src/core/lib/contract.mjs";
import { SUITE_CHECKS, commentMark, maskJs } from "../src/core/lib/suite.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "zdd-engine.mjs");

// Routes declared one per line in `routes/*.txt`: `GET /things`. `#` starts
// a comment. Reads only through io.
const GOOD = `export const CONTRACT = 1;
export const COMMENT = { ".txt": "#" };
export const SUITE = { options: { roots: ["routes"] } };
export const FACTS_KEY_ORDER = { route: ["method"] };
export function derive({ options, io }) {
  const records = [];
  const diagnostics = [];
  for (const root of options.roots ?? ["routes"]) {
    const walked = io.walk(root, (rel) => {
      if (!rel.endsWith(".txt")) return;
      const got = io.read(rel);
      if (!got.ok) return diagnostics.push(got.reason);
      for (const line of got.text.split("\\n")) {
        const code = line.replace(/#.*$/, "").trim();
        const m = /^(GET|POST) (\\/\\S*)$/.exec(code);
        if (m) records.push({ kind: "route", id: \`route:\${m[1]} \${m[2]}\`, title: \`\${m[1]} \${m[2]}\`, description: "", resource: [rel], refs: [], facts: { method: m[1] }, filename: \`\${m[1].toLowerCase()}\${m[2].replace(/\\//g, "-")}.json\` });
      }
    });
    if (!walked.exists) diagnostics.push(\`\${root} is missing — nothing to inventory\`);
  }
  return { records, diagnostics };
}
`;

const BROKEN = {
  // A date in the machine's own timezone: equal on one machine, not on another.
  1: GOOD.replace('facts: { method: m[1] }', "facts: { method: m[1], epoch: new Date(0).toString() }"),
  // Lists the folder itself, past io: the gitignored copies come back.
  2: `import { readdirSync, readFileSync } from "node:fs";\nimport { join } from "node:path";\n` +
    GOOD.replace("export function derive({ options, io }) {", "export function derive({ repoRoot, options, io }) {").replace(
      "    const walked = io.walk(root, (rel) => {",
      `    const all = [];
    const list = (rel) => { let names = []; try { names = readdirSync(join(repoRoot, rel), { withFileTypes: true }); } catch {} for (const d of names) { const r = rel + "/" + d.name; if (d.isDirectory()) list(r); else all.push(r); } };
    list(root);
    io = { ...io, walk: (r, onFile) => { all.sort().forEach((f) => onFile(f)); return { exists: all.length > 0, skipped: [] }; }, read: (r) => ({ ok: true, text: readFileSync(join(repoRoot, r), "utf8") }) };
    const walked = io.walk(root, (rel) => {`,
    ),
  3: GOOD.replace("if (!walked.exists) diagnostics.push(`${root} is missing — nothing to inventory`);", "if (!walked.exists) throw new Error(`${root} is missing`);"),
  4: GOOD.replace('const code = line.replace(/#.*$/, "").trim();', 'const code = line.replace(/^#\\s*/, "").trim();'),
  5: GOOD.replace("export function derive({ options, io }) {", "export function derive({ options, io }) {\n  if (process.env.ZDD_NEVER_SET) return { records: [], diagnostics: [] };"),
};

const FIXTURE = { "routes/things.txt": "# the things API\nGET /things\nPOST /things\n", "routes/health.txt": "GET /health\n" };

function scratch(t, { adapter = GOOD, name = "acme-routes", suiteChecks = SUITE_CHECKS.length, single = false, fixture = FIXTURE, extra = {} } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-suite-local-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const write = (rel, text) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  const config = { name: "acme", extractors: [name], extractorOptions: { [name]: { roots: ["routes"] } }, localExtractorDir: "zdd/extractors", render: { storeChanges: false } };
  if (suiteChecks !== null) config.suiteChecks = suiteChecks;
  write("zdd/config.json", JSON.stringify(config, null, 2));
  if (single) write(`zdd/extractors/${name}.mjs`, adapter);
  else {
    write(`zdd/extractors/${name}/index.mjs`, adapter);
    for (const [rel, text] of Object.entries(fixture)) write(`zdd/extractors/${name}/fixture/${rel}`, text);
  }
  for (const [rel, text] of Object.entries(extra)) write(rel, text);
  return repo;
}

function suite(repo, ...args) {
  const r = spawnSync(process.execPath, [BIN, "suite", "--json", `--root=${repo}`, ...args], { encoding: "utf8", timeout: 300_000 });
  return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}
const failing = (json) => json.adapters[0].checks.filter((c) => !c.ok).map((c) => c.n);

test("a local adapter that keeps every rule passes every check; the report carries the contract table", (t) => {
  const r = suite(scratch(t));
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(failing(r.json), []);
  assert.equal(r.json.adapters[0].declared, 1);
  assert.equal(r.json.adapters[0].records, 3);
  assert.deepEqual(r.json.table, CONTRACT_TABLE);
  assert.equal(r.json.suiteChecks, SUITE_CHECKS.length);
});

for (const n of [1, 2, 3, 4, 5]) {
  test(`check ${n} (${SUITE_CHECKS[n - 1].id}) catches an adapter that breaks it`, (t) => {
    const r = suite(scratch(t, { adapter: BROKEN[n] }));
    assert.equal(r.status, 1, r.err);
    // Bypassing io (2) is also an io failure (5).
    assert.deepEqual(failing(r.json), n === 2 ? [2, 5] : [n]);
    assert.ok(r.json.adapters[0].checks.find((c) => c.n === n).blocking);
  });
}

test("suiteChecks: a failing check above the number warns and the run passes; absent, nothing blocks", (t) => {
  const below = suite(scratch(t, { adapter: BROKEN[4], suiteChecks: 3 }));
  assert.equal(below.status, 0, below.err);
  const c4 = below.json.adapters[0].checks.find((c) => c.n === 4);
  assert.equal(c4.ok, false);
  assert.equal(c4.blocking, false);
  const absent = suite(scratch(t, { adapter: BROKEN[4], suiteChecks: null }));
  assert.equal(absent.status, 0);
  assert.equal(absent.json.suiteChecks, 0);
  const bad = suite(scratch(t, { suiteChecks: 99 }));
  assert.equal(bad.status, 1);
  assert.match(bad.err, /suiteChecks must be a whole number from 0 to 5/);
});

test("the human report names each failing check, its fix and whether it blocks", (t) => {
  const repo = scratch(t, { adapter: BROKEN[3], suiteChecks: 5 });
  const r = spawnSync(process.execPath, [BIN, "suite", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /acme-routes \(contract 1; 3 record file\(s\) from its fixture\)/);
  assert.match(r.stdout, /FAIL 3 a missing root is nothing to inventory/);
  assert.match(r.stdout, /fix: when a configured folder or file is missing/);
  assert.match(r.stdout, /The suite FAILS/);
});

test("a single-module adapter has nowhere to keep a fixture: the fixture checks say so; no local adapter at all is nothing to check", (t) => {
  const r = suite(scratch(t, { single: true }));
  assert.equal(r.status, 1);
  assert.deepEqual(failing(r.json), [1, 2, 4]);
  assert.match(r.json.adapters[0].checks[0].detail, /add a fixture\/ folder beside the adapter/);
  const none = mkdtempSync(join(tmpdir(), "zdd-suite-none-"));
  t.after(() => rmSync(none, { recursive: true, force: true }));
  mkdirSync(join(none, "zdd"));
  writeFileSync(join(none, "zdd", "config.json"), JSON.stringify({ name: "x", extractors: ["generic"] }));
  const n = suite(none);
  assert.equal(n.status, 0);
  assert.deepEqual(n.json.adapters, []);
  assert.deepEqual(n.json.skipped, ["generic"]);
});

test("no SUITE export: the suite says to add one; a companion must be a catalogue adapter", (t) => {
  const r = suite(scratch(t, { adapter: GOOD.replace('export const SUITE = { options: { roots: ["routes"] } };\n', "") }));
  assert.equal(r.status, 1);
  assert.match(r.json.adapters[0].checks[0].detail, /no SUITE export/);
  const c = suite(scratch(t, { adapter: GOOD.replace('export const SUITE = { options: { roots: ["routes"] } };', 'export const SUITE = { options: { roots: ["routes"] }, companions: { "acme-db": {} } };') }));
  assert.equal(c.status, 1);
  assert.match(c.json.adapters[0].checks[0].detail, /'acme-db', which is not a catalogue adapter/);
});

test("the trap folder: quoted code it holds must give nothing the fixture does not", (t) => {
  // The trap folder holds what the author knows must never be a record (in
  // a language with strings, a declaration inside quotes). This convention
  // has none, so a plain declaration stands in: the check fails, as it would
  // on a quoted one the adapter read.
  const trapped = scratch(t);
  mkdirSync(join(trapped, "zdd/extractors/acme-routes/fixture-trap/routes"), { recursive: true });
  writeFileSync(join(trapped, "zdd/extractors/acme-routes/fixture-trap/routes/quoted.txt"), "GET /secret\n");
  const t2 = suite(trapped);
  assert.equal(t2.status, 1);
  assert.deepEqual(failing(t2.json), [4]);
  assert.match(t2.json.adapters[0].checks.find((c) => c.n === 4).detail, /the trap folder has a record the fixture does not/);
});

test("the contract: newer than the engine stops derive; none declared warns; a required step it is behind on stops; optional ones are only said under --verbose", (t) => {
  assert.match(judgeContract("x", { CONTRACT: CONTRACT + 1 }).fail, new RegExp(`written for adapter contract ${CONTRACT + 1}, and this engine speaks ${CONTRACT}`));
  assert.match(judgeContract("x", { CONTRACT: "1" }).fail, /must be a whole number/);
  assert.match(judgeContract("x", {}).warning, /declares no CONTRACT/);
  const table = [...CONTRACT_TABLE, { step: "queues", since: 2, required: false, what: "q", ask: "Does your stack have message queues?" }, { step: "ids", since: 3, required: true, what: "i", ask: null }];
  assert.deepEqual(stepsSince(1, { contract: 2, table }).map((r) => r.step), ["queues"]);
  const optional = judgeContract("x", { CONTRACT: 1 }, { contract: 2, table });
  assert.equal(optional.fail, null);
  assert.deepEqual(optional.behind.map((r) => r.step), ["queues"]);
  assert.match(judgeContract("x", { CONTRACT: 1 }, { contract: 3, table }).fail, /contract 3 requires ids/);

  const ahead = scratch(t, { adapter: GOOD.replace("export const CONTRACT = 1;", `export const CONTRACT = ${CONTRACT + 1};`) });
  const d = spawnSync(process.execPath, [BIN, "derive", `--root=${ahead}`], { encoding: "utf8" });
  assert.equal(d.status, 1);
  assert.match(d.stderr, /this engine speaks/);
  assert.equal(suite(ahead).status, 1);
  const none = scratch(t, { adapter: GOOD.replace("export const CONTRACT = 1;\n", "") });
  const w = spawnSync(process.execPath, [BIN, "derive", `--root=${none}`], { encoding: "utf8" });
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stderr, /WARNING \[contract\]: adapter 'acme-routes' declares no CONTRACT/);
});

test("the contract table: one row per step, CONTRACT is the newest `since`, and every interview question lives in the core", () => {
  assert.equal(new Set(CONTRACT_TABLE.map((r) => r.step)).size, CONTRACT_TABLE.length);
  assert.equal(Math.max(...CONTRACT_TABLE.map((r) => r.since)), CONTRACT);
  for (const r of CONTRACT_TABLE) {
    assert.ok(Number.isInteger(r.since) && r.since >= 1 && r.since <= CONTRACT, r.step);
    assert.equal(typeof r.required, "boolean", r.step);
    assert.ok(r.what && typeof r.what === "string", r.step);
    assert.ok(r.ask === null || typeof r.ask === "string", r.step);
  }
});

test("the suite's checks are numbered 1..n in order; commentMark matches a file name or the longest suffix; maskJs blanks comments and strings, never code", () => {
  assert.deepEqual(SUITE_CHECKS.map((c) => c.n), SUITE_CHECKS.map((_, i) => i + 1));
  assert.equal(commentMark({ Procfile: "#", ".ts": "//", ".d.ts": "///" }, "a/Procfile"), "#");
  assert.equal(commentMark({ ".ts": "//", ".d.ts": "///" }, "a/x.d.ts"), "///");
  assert.equal(commentMark({ ".ts": "//" }, "a/x.py"), undefined); // not classified (CR-118); null means "no line comment"
  assert.equal(commentMark({ ".json": null }, "a/x.json"), null);
  const m = maskJs('const a = "require(x)"; // import(y)\n/* process.env */ fetch(z);');
  assert.ok(!/require|import|process/.test(m));
  assert.match(m, /fetch\(z\)/);
});
