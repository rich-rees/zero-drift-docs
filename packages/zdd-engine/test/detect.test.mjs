// Detection (decision 0039): each adapter carries its own — the evidence that
// it fits a repo, the options it would use and the parts of the app it
// covers — and the core asks every catalogue adapter over ONE scan of the
// repo, then reads coverage part by part. Also the coverage report after
// derive (the automated half of "check it together") and the greenfield
// preview built from the adapters' own examples, outside the repo.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRepo, makeScan } from "../src/core/lib/detect-repo.mjs";
import { catalogueModules } from "../src/core/derive.mjs";
import { coverageOf, narrateCoverage } from "../src/core/coverage.mjs";
import { buildPreview } from "../src/core/preview.mjs";
import { PARTS } from "../src/core/lib/parts.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const modules = await catalogueModules();

const repo = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-detect-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const named = (d, name) => d.proposals.find((p) => p.name === name);

test("every catalogue adapter that detects declares parts from the core's list, an order, and an option shape", () => {
  const detecting = modules.filter(({ mod }) => typeof mod.detect === "function");
  assert.ok(detecting.length >= 20, `${detecting.length} adapters detect`);
  for (const { name, mod } of detecting) {
    assert.ok(mod.DETECTION, `${name} exports DETECTION`);
    assert.ok(mod.DETECTION.parts.every((p) => PARTS.includes(p)), `${name}: ${mod.DETECTION.parts}`);
    assert.ok(Number.isFinite(mod.DETECTION.order), name);
    if (!mod.DETECTION.fallback) assert.ok(mod.DETECTION.optionShape, `${name} declares its option shape for bootstrap's checks`);
  }
});

test("a part outside the core's list is a packaging defect, never a silent proposal", (t) => {
  const root = repo(t, { "a.txt": "x" });
  const bad = [{ name: "odd", mod: { DETECTION: { parts: ["dashboards"], order: 1 }, detect: () => null } }];
  assert.throws(() => detectRepo(root, bad), /adapter 'odd' names a part outside/);
});

test("the core hands every adapter the same scan, walked once", (t) => {
  const root = repo(t, { "src/a.ts": "", "src/b.py": "" });
  const seen = [];
  const spy = (name) => ({ name, mod: { DETECTION: { parts: ["routes"], order: 1 }, detect: ({ scan }) => (seen.push(scan), null) } });
  detectRepo(root, [spy("a"), spy("b"), spy("c")]);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => s === seen[0]), "one scan object");
  assert.deepEqual(seen[0].files.map((f) => f.rel), ["src/a.ts", "src/b.py"]);
});

test("the scan skips dot folders, ZDD's own folder and every adapter's never-source folders, and caches reads", (t) => {
  const root = repo(t, { "a.py": "x", ".hidden/b.py": "", "zdd/c.py": "", "node_modules/d.js": "", "venv/e.py": "" });
  const io = makeExtractorIo(root, "t");
  const scan = makeScan(io, new Set(["node_modules", "venv"]));
  assert.deepEqual(scan.files.map((f) => f.rel), ["a.py"]);
  assert.equal(scan.read("a.py"), "x");
  writeFileSync(join(root, "a.py"), "changed");
  assert.equal(scan.read("a.py"), "x", "read once per scan");
});

test("the engine fixtures propose what bootstrap proposed before the move, plus each data-access adapter that now detects itself", () => {
  const names = (fixture) => detectRepo(join(PKG, "test", fixture), modules).proposals.map((p) => p.name);
  assert.deepEqual(names("fixture"), ["supabase", "supabase-js", "nextjs", "components"]);
  assert.deepEqual(names("fixture-components"), ["fastapi", "react-router", "components", "expo-router"]);
  assert.deepEqual(names("fixture-services"), ["fastapi", "external-services"]);
  assert.deepEqual(names("fixture-fastapi"), ["supabase", "supabase-py", "fastapi"]);
  assert.deepEqual(names("fixture-sqlalchemy"), ["supabase", "sqlalchemy", "fastapi"]);
  assert.equal(detectRepo(join(PKG, "test", "fixture-greenfield"), modules).mode, "greenfield");
});

test("supabase-py: proposed from a dependency, an import, or its call shape; sqlalchemy from pyproject or an import; neither from a test file", (t) => {
  const dep = repo(t, { "requirements.txt": "fastapi==0.110\nsupabase>=2\n", "app/x.py": "" });
  assert.match(named(detectRepo(dep, modules), "supabase-py").evidence[0], /`supabase` in `requirements\.txt`/);
  const imp = repo(t, { "app/db.py": "from supabase import create_client\n" });
  assert.ok(named(detectRepo(imp, modules), "supabase-py").evidence.some((e) => /imported in `app\/db\.py`/.test(e)));
  const call = repo(t, { "app/routes.py": 'def get():\n    return db.table("jobs").select("*").execute()\n' });
  assert.ok(named(detectRepo(call, modules), "supabase-py").evidence.some((e) => /calls in `app\/routes\.py`/.test(e)));
  const pyproject = repo(t, { "pyproject.toml": '[project]\nname = "x"\ndependencies = [\n  "SQLAlchemy>=2.0",\n]\n', "x.py": "" });
  assert.match(named(detectRepo(pyproject, modules), "sqlalchemy").evidence[0], /`sqlalchemy` in `pyproject\.toml`/);
  const poetry = repo(t, { "pyproject.toml": "[tool.poetry.dependencies]\npython = \"^3.12\"\nsqlalchemy = \"^2\"\n", "x.py": "" });
  assert.ok(named(detectRepo(poetry, modules), "sqlalchemy"));
  const tests = repo(t, { "tests/test_db.py": "import sqlalchemy\nfrom supabase import x\nx.table(\"a\")\n", "conftest.py": "import sqlalchemy\n" });
  const d = detectRepo(tests, modules);
  assert.ok(!named(d, "sqlalchemy") && !named(d, "supabase-py"), d.proposals.map((p) => p.name).join(","));
});

test("the queue readers: Inngest, Trigger.dev and SQS are each proposed from their own declarations, with the mode caveat", (t) => {
  const root = repo(t, {
    "src/inngest.ts": 'export const f = inngest.createFunction({ id: "send-digest" }, { event: "user/signed-up" }, async () => {});\n',
    "src/trigger/sync.ts": 'export const sync = task({ id: "sync-catalogue", run: async () => {} });\n',
    "worker/poll.py": 'import boto3\nsqs.receive_message(QueueUrl="https://sqs.eu-west-2.amazonaws.com/1/emails")\nsqs.ReceiveMessage\n',
    "worker/poll.test.ts": 'new Worker("ignored", () => {});\n',
  });
  const d = detectRepo(root, modules);
  assert.deepEqual(d.proposals.map((p) => p.name).filter((n) => n.startsWith("background-")), ["background-inngest", "background-sqs", "background-trigger-dev"]);
  assert.ok(named(d, "background-inngest").evidence.includes("`src/inngest.ts` declares an Inngest function: `send-digest`"));
  assert.ok(named(d, "background-trigger-dev").evidence.includes("`src/trigger/sync.ts` declares a Trigger.dev task: `sync-catalogue`"));
  assert.ok(named(d, "background-sqs").evidence.includes("`worker/poll.py` uses an SQS queue: `emails`"));
  for (const n of ["background-inngest", "background-sqs", "background-trigger-dev"]) assert.ok(named(d, n).evidence.at(-1).includes(`extractorOptions["${n}"].modes`));
  assert.ok(!named(d, "background-bullmq"), "a test file is never evidence");
});

test("coverage part by part: what is covered and by which adapter, and the parts nothing covers", () => {
  const d = detectRepo(join(PKG, "test", "fixture-fastapi"), modules);
  assert.deepEqual(d.coverage.find((c) => c.part === "routes").adapters, ["fastapi"]);
  assert.deepEqual(d.coverage.find((c) => c.part === "database access").adapters, ["supabase", "supabase-py"]);
  assert.deepEqual(d.uncovered, ["screens", "components", "background tasks", "external services"]);
  // The neutral greenfield list: adapters a stated stack can select, by part — catalogue data, no recommendation.
  assert.deepEqual(d.catalogue.find((c) => c.part === "routes").adapters, ["fastapi", "nextjs"]);
  assert.ok(d.stacks.every((r, i, a) => i === 0 || a[i - 1].rank <= r.rank), "stack rules in rank order");
  assert.deepEqual(d.companions, [{ adapter: "supabase-js", all: ["supabase"], any: ["nextjs", "react-router", "components", "expo-router"] }]);
});

test("the CLI prints the same answer as JSON, and reads no config", (t) => {
  const root = repo(t, { "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n" });
  const out = JSON.parse(execFileSync(process.execPath, [BIN, "detect", `--root=${root}`], { encoding: "utf8" }));
  assert.deepEqual(out.proposals.map((p) => [p.name, p.options]), [["fastapi", { roots: ["api"] }]]);
  assert.ok(!existsSync(join(root, "zdd")), "detect writes nothing");
});

test("coverageOf: per kind, what records link to, and by name the ones linking to nothing and the ones nothing links to", () => {
  const rows = coverageOf([
    { kind: "route", id: "route:/a", title: "/a", refs: ["table:t"], facts: {} },
    { kind: "route", id: "route:/health", title: "/health", refs: [], facts: {} },
    { kind: "screen", id: "screen:/", title: "/", refs: [], facts: { edges: { calls: ["route:/a"] } } },
    { kind: "table", id: "table:t", title: "t", refs: [], facts: {} },
    { kind: "table", id: "table:u", title: "u", refs: ["table:missing"], facts: {} },
  ]);
  assert.deepEqual(rows.map((r) => [r.kind, r.count]), [["route", 2], ["screen", 1], ["table", 2]]);
  const route = rows[0];
  assert.deepEqual(route.linksTo, { table: 1 });
  assert.deepEqual(route.linkNothing, { count: 1, named: ["/health"] });
  assert.deepEqual(route.reachedByNothing, { count: 1, named: ["/health"] });
  assert.deepEqual(rows[1].linksTo, { route: 1 }, "a typed edge is a link");
  assert.deepEqual(rows[2].linkNothing.named, ["t", "u"], "a ref to no record is no link");
  assert.match(narrateCoverage(coverageOf([{ kind: "data-access", id: "data-access:a", title: "a", refs: [], facts: {} }, { kind: "data-access", id: "data-access:b", title: "b", refs: [], facts: {} }])), /^2 data-accesses;/, "a kind ending in s");
});

test("preview: the chosen adapters' examples derive and render in a folder outside the repo; one without an example is named", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "zdd-preview-test-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const r = await buildPreview(["supabase", "fastapi", "nextjs", "react-router", "expo-router", "components"], out);
  assert.deepEqual(r.used, ["supabase", "fastapi", "nextjs", "react-router", "expo-router"]);
  assert.deepEqual(r.skipped, ["components"]);
  const html = readFileSync(r.humanIndex, "utf8");
  for (const label of ["/orders/{id}", "/things/[id]", "/dashboard", "things (db)"]) assert.ok(html.includes(label), label);
});
