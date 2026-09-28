// Seam — the extractor skill's scaffold observed as files on disk (CAS-65,
// decision 0010). The skill is the conversation; scripts/scaffold-extractor.mjs
// writes the skeleton and the config wiring, so it is driven here with
// scripted answer sets against throwaway repos and the results asserted on
// disk. The scaffolded test file is then run for real against the local
// engine: red before the logic exists, green once a fixture and fromSource()
// are in — the loop the skill walks an adopter through.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILT_INS, IO_SINCE } from "../scripts/scaffold-extractor.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "scaffold-extractor.mjs");
const TEMPLATES = join(PLUGIN, "templates", "extractor");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const GREENFIELD = join(ENGINE, "test", "fixture-greenfield");
const POSIX = process.platform !== "win32";

const CSHARP = {
  name: "aspnet-routes",
  evidence: "[Route]/[HttpGet] attributes on controller classes",
  shapedLike: "fastapi",
  kinds: ["route"],
  idExample: "route:/api/orders/{id}",
  refs: ["?table:"],
  roots: ["src/Api"],
  extensions: [".cs"],
};

// A bootstrapped-looking repo: the engine's greenfield fixture plus a pin.
function adopted(t, pin = IO_SINCE) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-scaffold-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(GREENFIELD, repo, { recursive: true });
  const configPath = join(repo, "zdd", "config.json");
  writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(configPath, "utf8")), engine: pin }, null, 2) + "\n");
  return repo;
}
function scaffold(repo, answers, extra = []) {
  const file = join(repo, "..", `answers-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(answers));
  const r = spawnSync(process.execPath, [SCRIPT, "apply", `--answers=${file}`, `--root=${repo}`, ...extra], { encoding: "utf8" });
  rmSync(file, { force: true });
  return r;
}
const scaffoldJson = (repo, answers) => {
  const r = scaffold(repo, answers, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
function snapshot(root) {
  const out = new Map();
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else out.set(relative(root, p), readFileSync(p, "utf8"));
    }
  };
  visit(root);
  return out;
}
// NODE_TEST_CONTEXT is how the runner marks its own children; inherited, it
// would make the nested run report in the runner's private wire format.
const runTests = (repo, file) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], { cwd: repo, encoding: "utf8", env: { ...env, ZDD_ENGINE_BIN: ENGINE_BIN } });
};

test("scaffold writes the module, the test file and one fixture folder per root, and wires config", (t) => {
  const repo = adopted(t);
  const r = scaffoldJson(repo, CSHARP);
  const base = "zdd/extractors/aspnet-routes";
  assert.deepEqual(r.wrote, [`${base}/index.mjs`, `${base}/aspnet-routes.test.mjs`, `${base}/fixture/src/Api/.gitkeep`, "zdd/config.json"]);
  assert.equal(r.syntax, "c-like", "inferred from .cs");
  const c = config(repo);
  assert.equal(c.localExtractorDir, "zdd/extractors");
  assert.deepEqual(c.extractors, ["supabase", "fastapi", "aspnet-routes"], "appended, others kept in order");
  assert.deepEqual(c.extractorOptions["aspnet-routes"], { roots: ["src/Api"], extensions: [".cs"] });
  assert.deepEqual(c.extractorOptions.fastapi, { roots: ["api"] }, "other options untouched");
  const mod = readFileSync(join(repo, base, "index.mjs"), "utf8");
  assert.doesNotMatch(mod, /__[A-Z_]+__/, "every template token filled");
  assert.match(mod, /\[Route\]\/\[HttpGet\] attributes on controller classes/);
  assert.match(mod, /export const FACTS_KEY_ORDER = \{ "route": \[\] \};/);
  assert.match(mod, /function mask\(text\)/);
  assert.doesNotMatch(mod, /from "node:fs"/, "the module reads through io, never node:fs");
  assert.doesNotMatch(readFileSync(join(repo, base, "aspnet-routes.test.mjs"), "utf8"), /__[A-Z_]+__/);
});

test("a second run keeps every file and the config — nothing is overwritten", (t) => {
  const repo = adopted(t);
  scaffoldJson(repo, CSHARP);
  writeFileSync(join(repo, "zdd", "extractors", "aspnet-routes", "index.mjs"), "// the adopter's logic\n");
  const before = snapshot(repo);
  const r = scaffoldJson(repo, CSHARP);
  assert.deepEqual(r.wrote, []);
  assert.ok(r.kept.includes("zdd/config.json"));
  assert.deepEqual(snapshot(repo), before);
});

test("the untouched scaffold loads in the engine: derive runs, finds nothing, and says why", (t) => {
  const repo = adopted(t);
  scaffoldJson(repo, CSHARP);
  const r = spawnSync(process.execPath, [ENGINE_BIN, "derive", "--verbose", `--root=${repo}`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /\[aspnet-routes\] src\/Api is missing — nothing to inventory/);
});

test("fail loudly: without io the scaffolded module throws, naming the engine version and --upgrade", async (t) => {
  const repo = adopted(t);
  scaffoldJson(repo, CSHARP);
  const mod = await import(pathToFileURL(join(repo, "zdd", "extractors", "aspnet-routes", "index.mjs")).href);
  assert.throws(() => mod.derive({ repoRoot: repo, options: {} }), new RegExp(`aspnet-routes needs @rich-rees/zdd-engine ${IO_SINCE.replace(/\./g, "\\.")} or later \\(io was not passed\\) — run \`zdd:bootstrap --upgrade\``));
});

test("the scaffolded test is red until EXPECTED_IDS and a fixture exist, and green once fromSource() is written", (t) => {
  const repo = adopted(t);
  scaffoldJson(repo, CSHARP);
  const dir = join(repo, "zdd", "extractors", "aspnet-routes");
  const testFile = "zdd/extractors/aspnet-routes/aspnet-routes.test.mjs";
  const red = runTests(repo, testFile);
  assert.notEqual(red.status, 0);
  assert.match(red.stdout, /fill in EXPECTED_IDS/);
  assert.match(red.stdout, /the fixture holds no \.cs file yet/);
  assert.match(red.stdout, /set CONVENTION_RECURSES to true or false/, "the recursion question is red until answered (CR-039)");

  // What the agent writes: a fixture, the expected ids, the logic.
  writeFileSync(
    join(dir, "fixture", "src", "Api", "OrdersController.cs"),
    [
      "[ApiController]",
      '[Route("api/orders")]',
      "public class OrdersController : ControllerBase",
      "{",
      '    // [HttpDelete("{id}")] is commented out — never a route',
      "    [HttpGet]",
      "    public IActionResult List() => Ok();",
      '    [HttpGet("{id}")]',
      '    public IActionResult Get(int id) => Ok("[HttpPost(\\"fake\\")]");',
      "}",
      "",
    ].join("\n"),
  );
  const testPath = join(dir, "aspnet-routes.test.mjs");
  writeFileSync(testPath, readFileSync(testPath, "utf8").replace("const EXPECTED_IDS = null;", 'const EXPECTED_IDS = ["route:/api/orders", "route:/api/orders/{id}"];').replace("const CONVENTION_RECURSES = null;", "const CONVENTION_RECURSES = false;"));
  const modPath = join(dir, "index.mjs");
  const logic = [
    "  const cls = /\\[Route\\(\"/.exec(masked);",
    "  if (!cls) return out;",
    "  const q = cls.index + cls[0].length;",
    "  const prefix = text.slice(q, masked.indexOf('\"', q));",
    "  for (const m of masked.matchAll(/\\[Http(Get|Post|Put|Delete)(?:\\(\"([^\"]*)\"\\))?\\]/g)) {",
    "    const at = m.index + m[0].indexOf('\"') + 1;",
    "    const tail = m[2] === undefined ? \"\" : text.slice(at, masked.indexOf('\"', at));",
    "    out.push(record(\"route\", \"/\" + [prefix, tail].filter(Boolean).join(\"/\"), rel, { methods: [m[1].toUpperCase()] }));",
    "  }",
  ].join("\n");
  writeFileSync(modPath, readFileSync(modPath, "utf8").replace("function fromSource(rel, masked, text, diagnostics) {\n  const out = [];", (head) => `${head}\n${logic}`));
  const green = runTests(repo, testFile);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  // Exact counts per platform (CAS-65 CR-012): a hardening test deleted or
  // newly skipped must turn this red. Nine tests — the POSIX file-symlink one
  // skips on Windows; the recursion one passes once CONVENTION_RECURSES is answered.
  const count = (what) => Number(new RegExp(`^# ${what} (\\d+)$`, "m").exec(green.stdout)?.[1]);
  assert.equal(count("tests"), 9, green.stdout);
  assert.equal(count("fail"), 0, green.stdout);
  assert.equal(count("todo"), 0, green.stdout);
  assert.equal(count("skipped"), POSIX ? 0 : 1, green.stdout);
  assert.equal(count("pass"), POSIX ? 9 : 8, green.stdout);
});

test("refusals: every bad answer or repo state stops before the first write", (t) => {
  const cases = [
    [{ ...CSHARP, name: "fastapi" }, /is a built-in extractor/],
    [{ ...CSHARP, name: "Aspnet" }, /name must match/],
    [{ ...CSHARP, name: "../evil" }, /name must match/],
    [{ ...CSHARP, evidence: " \n " }, /evidence must say/],
    [{ ...CSHARP, shapedLike: "rails" }, /shapedLike must be one of/],
    [{ ...CSHARP, kinds: [] }, /kinds must be a non-empty array/],
    [{ ...CSHARP, kinds: ["../x"] }, /kinds must be a non-empty array/],
    [{ ...CSHARP, refs: ["table:"] }, /refs must be an array of/],
    [{ ...CSHARP, roots: ["../outside"] }, /roots\[0\].*'\.\.'/],
    [{ ...CSHARP, roots: ["/etc"] }, /roots\[0\].*repo-relative/],
    [{ ...CSHARP, extensions: ["cs"] }, /extensions must be/],
    [{ ...CSHARP, extensions: [".cs", ".sql"] }, /syntax cannot be inferred/],
    [{ ...CSHARP, extensions: [".rb"] }, /syntax cannot be inferred/],
    [{ ...CSHARP, syntax: "lisp" }, /syntax must be one of/],
    [{ ...CSHARP, localExtractorDir: "zdd/metadata/x" }, /overlaps paths\.metadataDir/],
    [{ ...CSHARP, localExtractorDir: "zdd" }, /overlaps paths\./],
  ];
  for (const [answers, re] of cases) {
    const repo = adopted(t);
    const before = snapshot(repo);
    const r = scaffold(repo, answers);
    assert.equal(r.status, 1, `${JSON.stringify(answers)} should fail`);
    assert.match(r.stderr, re);
    assert.deepEqual(snapshot(repo), before, `nothing written for ${r.stderr}`);
  }
});

test("refusals from the repo: no config, an unreadable config, a disagreeing localExtractorDir, a same-named single-file module, a legacy adapter", (t) => {
  const bare = mkdtempSync(join(tmpdir(), "zdd-scaffold-bare-"));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  assert.match(scaffold(bare, CSHARP).stderr, /no zdd\/config\.json — adopt ZDD first/);

  const broken = adopted(t);
  writeFileSync(join(broken, "zdd", "config.json"), "{ not json");
  assert.match(scaffold(broken, CSHARP).stderr, /does not parse/);

  const other = adopted(t);
  writeFileSync(join(other, "zdd", "config.json"), JSON.stringify({ ...config(other), localExtractorDir: "tools/zdd" }));
  assert.match(scaffold(other, { ...CSHARP, localExtractorDir: "zdd/extractors" }).stderr, /already sets localExtractorDir to 'tools\/zdd'/);
  const r = scaffoldJson(other, CSHARP);
  assert.equal(r.base, "tools/zdd/aspnet-routes", "an unanswered dir follows the config");

  const single = adopted(t);
  mkdirSync(join(single, "zdd", "extractors"), { recursive: true });
  writeFileSync(join(single, "zdd", "extractors", "aspnet-routes.mjs"), "export function derive() {}\n");
  assert.match(scaffold(single, CSHARP).stderr, /aspnet-routes\.mjs already exists/);

  const legacy = adopted(t);
  const { extractors, extractorOptions, ...rest } = config(legacy);
  writeFileSync(join(legacy, "zdd", "config.json"), JSON.stringify({ ...rest, adapter: "nextjs-supabase", adapterOptions: {} }));
  assert.match(scaffold(legacy, CSHARP).stderr, /pre-1\.0 'adapter' — run zdd:bootstrap --upgrade first/);
});

test("notes: an old engine pin, a leftover generic, a root that does not exist yet", (t) => {
  const repo = adopted(t, "1.2.0");
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ ...config(repo), extractors: ["generic"], extractorOptions: {} }));
  const r = scaffoldJson(repo, CSHARP);
  const notes = r.notes.join("\n");
  assert.match(notes, new RegExp(`pins engine 1\\.2\\.0; this extractor needs ${IO_SINCE.replace(/\./g, "\\.")} or later .* run zdd:bootstrap --upgrade`));
  assert.match(notes, /'generic' is still listed/);
  assert.match(notes, /src\/Api does not exist in this repo yet/);
  assert.deepEqual(config(repo).extractors, ["generic", "aspnet-routes"]);
});

test("text bound for a generated comment is flattened to one line and every mask is chosen by syntax", async (t) => {
  const repo = adopted(t);
  scaffoldJson(repo, { ...CSHARP, name: "sqlish", evidence: "CREATE TABLE in\n*/ require('x') //\u0007 migrations", kinds: ["table"], roots: ["db"], extensions: [".sql"] });
  const mod = readFileSync(join(repo, "zdd", "extractors", "sqlish", "index.mjs"), "utf8");
  assert.match(mod, /^\/\/ Convention: CREATE TABLE in \*\/ require\('x'\) \/\/ migrations$/m);
  assert.match(mod, /SQL syntax: `--`/);
  const loaded = await import(pathToFileURL(join(repo, "zdd", "extractors", "sqlish", "index.mjs")).href);
  assert.equal(typeof loaded.derive, "function", "the flattened comment did not break the module");
});

test("the local-name guard mirrors the engine registry", () => {
  const src = readFileSync(join(ENGINE, "src", "derive.mjs"), "utf8");
  const block = /const EXTRACTORS = \{([\s\S]*?)\};/.exec(src)[1];
  const names = [...block.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?:/gm)].map((m) => m[1]);
  assert.deepEqual([...BUILT_INS].sort(), names.sort());
});

// The masks, lifted out of their templates and run on text that tries to
// look like structure from inside a comment or a string.
async function loadMask(syntax) {
  const src = readFileSync(join(TEMPLATES, `mask-${syntax}.tmpl`), "utf8") + "\nexport { mask };\n";
  return (await import(`data:text/javascript,${encodeURIComponent(src)}`)).mask;
}
const sameShape = (mask, text) => {
  const out = mask(text);
  assert.equal(out.length, text.length, "length kept");
  assert.deepEqual([...out.matchAll(/\n/g)].map((m) => m.index), [...text.matchAll(/\n/g)].map((m) => m.index), "newlines kept");
  return out;
};

test("mask c-like: comments and string contents blank, quotes and code stay, offsets hold", async () => {
  const mask = await loadMask("c-like");
  const text = '[Route("api/orders")] // [HttpGet("x")]\n/* [HttpPost]\n */ var s = "a\\"[HttpPut]"; var t = `[HttpDelete]\n`; char c = \'"\';\n[HttpGet]';
  const out = sameShape(mask, text);
  assert.match(out, /^\[Route\(" {10}"\)\]/);
  assert.deepEqual([...out.matchAll(/\[Http\w+/g)].map((m) => m[0]), ["[HttpGet"]);
  assert.equal(out.indexOf('"', 7), text.indexOf('"', 7), "the closing quote sits where it did");
  assert.equal(sameShape(mask, '"unterminated\n[HttpGet]').split("\n")[1], "[HttpGet]", "an unterminated string ends at its line");
});

test("mask sql: -- and /* */ comments, '' escapes and dollar bodies blank; double-quoted identifiers stay", async () => {
  const mask = await loadMask("sql");
  const text = "-- CREATE TABLE ghost (id int);\nCREATE TABLE \"orders\" (note text DEFAULT 'it''s CREATE TABLE x');\n/* CREATE TABLE y */\nCREATE FUNCTION f() AS $body$ CREATE TABLE z $body$;\nCREATE TABLE b (id int);";
  const out = sameShape(mask, text);
  assert.deepEqual([...out.matchAll(/CREATE TABLE ("?\w+"?)/g)].map((m) => m[1]), ['"orders"', "b"]);
  assert.match(out, /\$body\$ +\$body\$/);
});

test("mask python: # comments, quoted strings and triple-quoted docstrings blank", async () => {
  const mask = await loadMask("python");
  const text = '# @router.get("/ghost")\n@router.get("/jobs/{id}")\ndef f():\n    """\n    @router.post("/doc")\n    """\n    s = \'@app.put("/x")\'\n@app.delete("/jobs")';
  const out = sameShape(mask, text);
  assert.deepEqual([...out.matchAll(/@(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`), ["router.get", "app.delete"]);
});

test("CAS-65 CR-001: the scaffold never switches on code it did not write — an existing folder module, a linked or non-folder base, a flat module of any kind", (t) => {
  const planted = adopted(t);
  mkdirSync(join(planted, "zdd", "extractors", "aspnet-routes"), { recursive: true });
  writeFileSync(join(planted, "zdd", "extractors", "aspnet-routes", "index.mjs"), "export function derive() { /* not the scaffold's */ }\n");
  const before = snapshot(planted);
  const r = scaffold(planted, CSHARP);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /aspnet-routes\/index\.mjs already exists but zdd\/config\.json does not select 'aspnet-routes' — the scaffold never switches on code it did not write/);
  assert.deepEqual(snapshot(planted), before);

  const fileBase = adopted(t);
  mkdirSync(join(fileBase, "zdd", "extractors"), { recursive: true });
  writeFileSync(join(fileBase, "zdd", "extractors", "aspnet-routes"), "not a folder");
  assert.match(scaffold(fileBase, CSHARP).stderr, /zdd\/extractors\/aspnet-routes exists and is not a real folder/);

  const flatDir = adopted(t);
  mkdirSync(join(flatDir, "zdd", "extractors", "aspnet-routes.mjs"), { recursive: true });
  assert.match(scaffold(flatDir, CSHARP).stderr, /aspnet-routes\.mjs already exists/, "a directory named <name>.mjs is still a collision");

  // A rerun — the config already selects the name — keeps the module.
  const rerun = adopted(t);
  scaffoldJson(rerun, CSHARP);
  writeFileSync(join(rerun, "zdd", "extractors", "aspnet-routes", "index.mjs"), "// the adopter's logic by now\n");
  assert.equal(scaffold(rerun, CSHARP).status, 0);
});

test("CAS-65 CR-001 (POSIX): a symlinked flat module or base folder is refused", { skip: !POSIX && "symlinks need privileges on Windows" }, (t) => {
  const repo = adopted(t);
  mkdirSync(join(repo, "zdd", "extractors"), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "zdd-scaffold-out-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "evil.mjs"), "export function derive() {}\n");
  symlinkSync(join(outside, "evil.mjs"), join(repo, "zdd", "extractors", "aspnet-routes.mjs"));
  assert.match(scaffold(repo, CSHARP).stderr, /aspnet-routes\.mjs already exists/);
  rmSync(join(repo, "zdd", "extractors", "aspnet-routes.mjs"));
  symlinkSync(outside, join(repo, "zdd", "extractors", "aspnet-routes"));
  assert.match(scaffold(repo, CSHARP).stderr, /exists and is not a real folder/);
  assert.deepEqual(readdirSync(outside), ["evil.mjs"], "nothing written through the link");
});

test("CAS-65 CR-002/005: a malformed or disagreeing config is refused, never normalised — and nothing is written", (t) => {
  const cases = [
    [{ extractors: "supabase" }, /'extractors' is not a list of names/],
    [{ extractors: ["supabase", 3] }, /'extractors' is not a list of names/],
    [{ extractorOptions: [] }, /'extractorOptions' is not an object/],
    [{ extractorOptions: { "aspnet-routes": { roots: ["src/Other"], extensions: [".cs"] } } }, /already has extractorOptions\.aspnet-routes = .*src\/Other.* — answer those roots and extensions, or remove it first/],
    [{ extractorOptions: { "aspnet-routes": "yes" } }, /already has extractorOptions\.aspnet-routes/],
  ];
  for (const [patch, re] of cases) {
    const repo = adopted(t);
    writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ ...config(repo), ...patch }, null, 2));
    const before = snapshot(repo);
    const r = scaffold(repo, CSHARP);
    assert.equal(r.status, 1, JSON.stringify(patch));
    assert.match(r.stderr, re);
    assert.deepEqual(snapshot(repo), before, `nothing written for ${JSON.stringify(patch)}`);
  }
  // Agreeing options are fine: the name is simply activated.
  const agree = adopted(t);
  writeFileSync(join(agree, "zdd", "config.json"), JSON.stringify({ ...config(agree), extractorOptions: { ...config(agree).extractorOptions, "aspnet-routes": { roots: ["src/Api"], extensions: [".cs"] } } }, null, 2));
  assert.equal(scaffold(agree, CSHARP).status, 0);
});

test("CAS-65 CR-003: a path that cannot be written anywhere in the plan stops the run before the first write", (t) => {
  const repo = adopted(t);
  // A fixture root whose parent is a FILE: the module and test would have
  // been written before this refusal under the old one-pass scaffold.
  mkdirSync(join(repo, "zdd", "extractors", "aspnet-routes", "fixture"), { recursive: true });
  writeFileSync(join(repo, "zdd", "extractors", "aspnet-routes", "fixture", "src"), "a file where a folder must go");
  const before = snapshot(repo);
  const r = scaffold(repo, CSHARP);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zdd\/extractors\/aspnet-routes\/fixture\/src is not a folder/);
  assert.deepEqual(snapshot(repo), before);
});

test("CAS-65 CR-004/007: overlap with any artifact (files too, case-folded where the filesystem folds) or with the extractor's own folder is refused", (t) => {
  const cases = [
    [{ ...CSHARP, localExtractorDir: "zdd/graph.json/x" }, /overlaps paths\.graph 'zdd\/graph\.json'/],
    [{ ...CSHARP, localExtractorDir: "zdd/glossary.md" }, /overlaps paths\.glossary/],
    [{ ...CSHARP, localExtractorDir: "zdd/config.json" }, /overlaps zdd\/config\.json/],
    [{ ...CSHARP, roots: ["zdd/extractors/aspnet-routes/fixture/src/Api"] }, /roots entry 'zdd\/extractors\/aspnet-routes\/fixture\/src\/Api' overlaps the extractor's own folder/],
  ];
  if (process.platform === "win32" || process.platform === "darwin") cases.push([{ ...CSHARP, localExtractorDir: "ZDD/Metadata/local" }, /overlaps paths\.metadataDir/]);
  for (const [answers, re] of cases) {
    const repo = adopted(t);
    const before = snapshot(repo);
    const r = scaffold(repo, answers);
    assert.equal(r.status, 1, JSON.stringify(answers.localExtractorDir ?? answers.roots));
    assert.match(r.stderr, re);
    assert.deepEqual(snapshot(repo), before);
  }
});

test("CAS-65 CR-042: a name, root or folder Windows cannot create is refused on every platform", (t) => {
  for (const [patch, re] of [
    [{ name: "con" }, /name 'con' is a device name/],
    [{ roots: ["src/aux"] }, /roots entry 'src\/aux' has a segment Windows cannot create \('aux'\)/],
    [{ roots: ["src/Api."] }, /has a segment Windows cannot create \('Api\.'\)/],
    [{ localExtractorDir: "tools/nul.d" }, /localExtractorDir has a segment Windows cannot create/],
  ]) {
    const repo = adopted(t);
    const r = scaffold(repo, { ...CSHARP, ...patch });
    assert.equal(r.status, 1, JSON.stringify(patch));
    assert.match(r.stderr, re);
  }
  // A localExtractorDir already in the config is checked too (CR-042).
  const configured = adopted(t);
  writeFileSync(join(configured, "zdd", "config.json"), JSON.stringify({ ...config(configured), localExtractorDir: "tools/com3" }));
  assert.match(scaffold(configured, CSHARP).stderr, /localExtractorDir 'tools\/com3' has a segment Windows cannot create/);
  // COM0 and LPT0 are ordinary names: Windows reserves 1–9 only (CR-046).
  assert.equal(scaffold(adopted(t), { ...CSHARP, roots: ["src/com0", "src/lpt0"] }).status, 0);
});

test("CAS-65 CR-003 (POSIX, not root): a write that fails after the preflight removes what this run wrote and leaves config untouched", { skip: (!POSIX || process.getuid?.() === 0) && "needs POSIX permissions and a non-root user" }, (t) => {
  const repo = adopted(t);
  const configBefore = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  // The fixture folder exists but is read-only: the preflight sees a real
  // folder; the .gitkeep write inside it fails.
  const fixture = join(repo, "zdd", "extractors", "aspnet-routes", "fixture", "src", "Api");
  mkdirSync(fixture, { recursive: true });
  chmodSync(fixture, 0o555);
  let r;
  try {
    r = scaffold(repo, CSHARP);
  } finally {
    chmodSync(fixture, 0o755); // before the repo's own cleanup
  }
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the scaffold removed the 2 file\(s\) it had created; zdd\/config\.json is unchanged/);
  assert.deepEqual(readdirSync(join(repo, "zdd")).filter((f) => f.includes(".tmp")), [], "no temporary config left behind");
  assert.ok(!existsSync(join(repo, "zdd", "extractors", "aspnet-routes", "index.mjs")));
  assert.ok(!existsSync(join(repo, "zdd", "extractors", "aspnet-routes", "aspnet-routes.test.mjs")));
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), configBefore);
});

test("CAS-65 CR-006: the answers file is a small regular file", (t) => {
  const repo = adopted(t);
  const big = join(repo, "..", `answers-big-${Date.now()}.json`);
  writeFileSync(big, JSON.stringify({ ...CSHARP, pad: "x".repeat(70 * 1024) }));
  t.after(() => rmSync(big, { force: true }));
  const r = spawnSync(process.execPath, [SCRIPT, "apply", `--answers=${big}`, `--root=${repo}`], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is \d+ bytes — an answer set is under 65536/);
  const dir = spawnSync(process.execPath, [SCRIPT, "apply", `--answers=${repo}`, `--root=${repo}`], { encoding: "utf8" });
  assert.match(dir.stderr, /is not a regular file/);
});

test("CAS-65 CR-010: engine pins compare as SemVer — a prerelease before 1.3.0 is older; an unreadable pin says so", async (t) => {
  const { olderThan } = await import("../scripts/scaffold-extractor.mjs");
  assert.equal(olderThan("1.2.0-beta.1", "1.3.0"), true);
  assert.equal(olderThan("1.3.0-rc.1", "1.3.0"), true);
  assert.equal(olderThan("1.3.0+build.7", "1.3.0"), false);
  assert.equal(olderThan("1.4.0-beta", "1.3.0"), false);
  assert.equal(olderThan("latest", "1.3.0"), null);
  const repo = adopted(t, "next");
  assert.ok(scaffoldJson(repo, CSHARP).notes.some((n) => /engine pin \(next\) is not a version this can compare/.test(n)));
});

test("CAS-65 CR-014: mask mysql — `#` and `-- ` comments, backslash and doubled-quote escapes, double-quoted strings blank; backtick identifiers stay", async () => {
  const mask = await loadMask("mysql");
  const text = "# CREATE TABLE ghost (id int);\nCREATE TABLE `orders` (note text DEFAULT 'it\\'s CREATE TABLE x', b text DEFAULT \"CREATE TABLE y\", c text DEFAULT 'a''b');\n-- CREATE TABLE z\nCREATE TABLE b (id int);";
  const out = sameShape(mask, text);
  assert.deepEqual([...out.matchAll(/CREATE TABLE (`?\w+`?)/g)].map((m) => m[1]), ["`orders`", "b"]);
  // CR-043: `--` without a following space is arithmetic, not a comment.
  const arith = sameShape(mask, "SELECT 1--2; CREATE TABLE kept (id int);\nCREATE TABLE also (id int); --\n");
  assert.deepEqual([...arith.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]), ["kept", "also"]);
});

test("CAS-65 CR-013: mask c-like — a `//` inside a JS regex literal is not a comment; division is still division; linear on a large file", async () => {
  const mask = await loadMask("c-like");
  const text = 'const slash = /[//]/; app.get("/real", h);\nx = a / b; y = (c) / d;\nreturn /re\\/x/.test(s);';
  const out = sameShape(mask, text);
  assert.match(out, /app\.get\(" {5}", h\)/, "code after the regex survives");
  assert.match(out, /x = a \/ b; y = \(c\) \/ d;/);
  assert.match(out, /return \/ {5}\/\.test/);
  const big = "x = a / b;\n".repeat(100_000);
  const started = Date.now();
  sameShape(mask, big);
  assert.ok(Date.now() - started < 5000, "the mask stays linear");
});

test("CAS-65 CR-014: `.sql` still infers the standard mask; `mysql` is chosen explicitly", (t) => {
  const repo = adopted(t);
  const sql = scaffoldJson(repo, { ...CSHARP, name: "pg-tables", kinds: ["table"], roots: ["db"], extensions: [".sql"] });
  assert.equal(sql.syntax, "sql");
  const my = scaffoldJson(repo, { ...CSHARP, name: "my-tables", kinds: ["table"], roots: ["db2"], extensions: [".sql"], syntax: "mysql" });
  assert.equal(my.syntax, "mysql");
  assert.match(readFileSync(join(repo, "zdd", "extractors", "my-tables", "index.mjs"), "utf8"), /MySQL \/ MariaDB syntax/);
});

test("POSIX: a symlinked localExtractorDir is refused — nothing written through it", { skip: !POSIX && "symlinks need privileges on Windows" }, (t) => {
  const repo = adopted(t);
  const outside = mkdtempSync(join(tmpdir(), "zdd-scaffold-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(repo, "zdd", "extractors"));
  const r = scaffold(repo, CSHARP);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symlink/);
  assert.deepEqual(readdirSync(outside), []);
  assert.ok(!existsSync(join(outside, "aspnet-routes")));
});
