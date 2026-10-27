// Detection (decision 0039): each adapter carries its own — the evidence that
// it fits a repo, the options it would use and the parts of the app it
// covers — and the core asks every catalogue adapter over ONE scan of the
// repo, then reads coverage part by part. Also the coverage report after
// derive (the automated half of "check it together") and the greenfield
// preview built from the adapters' own examples, outside the repo.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRepo, makeScan } from "../src/core/lib/detect-repo.mjs";
import { catalogueModules } from "../src/core/derive.mjs";
import { coverageOf, narrateCoverage } from "../src/core/coverage.mjs";
import { buildPreview, previewTarget } from "../src/core/preview.mjs";
import { detect as componentsDetect } from "../src/adapters/components/detect.mjs";
import { CALL_NAME } from "../src/adapters/supabase-js/index.mjs";
import { derive as supabaseJsDerive } from "../src/adapters/supabase-js/index.mjs";
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

test("through detectRepo: every adapter's never-source folders are skipped, a gitignored file is never evidence, past six folders the walk says it stopped (CR-107)", (t) => {
  const root = repo(t, {
    "node_modules/x/src/app/page.tsx": "export default 1;\n",
    "venv/lib/main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    "gen/api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    ".gitignore": "gen/\n",
    "a/b/c/d/e/f/g/Procfile": "worker: node w.js\n",
    "a/b/c/d/e/f/g/w.js": "",
    "src/x.ts": "",
  });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const d = detectRepo(root, modules);
  assert.deepEqual(d.proposals.map((p) => p.name), ["generic"], JSON.stringify(d.proposals.map((p) => [p.name, p.evidence])));
  assert.equal(d.limits.walkTruncated, true);
  assert.equal(d.limits.readBudgetSpent, false);
});

test("the read budget, and files the io refuses, are said, never silent (CR-107, CR-103)", (t) => {
  const root = repo(t, { "requirements.txt": "supabase\n" + "#".repeat(1024 * 1024) + "\n", "app/main.py": "x = 1\n" });
  const d = detectRepo(root, modules);
  assert.equal(d.limits.refused, 1);
  assert.deepEqual(d.limits.refusedFirst, ["requirements.txt"]);
  assert.ok(!named(d, "supabase-py"), "evidence in a refused file is unseen, and the count says so");
  // A link the walk will not follow is counted too (verify CR-103).
  const linked = repo(t, { "app/main.py": "x = 1\n" });
  const elsewhere = repo(t, { "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n" });
  try {
    symlinkSync(join(elsewhere, "api"), join(linked, "api"), "junction");
    const dl = detectRepo(linked, modules);
    assert.equal(dl.limits.refused, 1);
    assert.deepEqual(dl.limits.refusedFirst, ["api"]);
  } catch (e) {
    if (e.code !== "EPERM") throw e;
  }
  const tight = detectRepo(repo(t, { "api/main.py": "from fastapi import FastAPI\napp = FastAPI()\n" }), modules, { maxTotalBytes: 8 });
  assert.equal(tight.limits.readBudgetSpent, true);
  assert.ok(!named(tight, "fastapi"));
});

test("components: past its file cap the evidence says it stopped, and a root after it is not proposed (CR-108)", () => {
  const files = [];
  for (let i = 0; i < 20_000; i++) files.push({ rel: `apps/a/src/C${String(i).padStart(5, "0")}.tsx`, name: `C${i}.tsx`, dir: "apps/a/src" });
  files.push({ rel: "apps/z/src/Late.tsx", name: "Late.tsx", dir: "apps/z/src" });
  const scan = { files, memo: (k, fn) => fn(), json: () => null, read: () => null };
  const out = componentsDetect({ scan });
  assert.deepEqual(out.proposal.options.roots, ["apps/a/src"]);
  assert.match(out.proposal.evidence.at(-1), /counted the first 20000 \.tsx\/\.jsx files and stopped/);
  const under = componentsDetect({ scan: { ...scan, files: files.slice(0, 10) } });
  assert.ok(!under.proposal.evidence.some((e) => /stopped/.test(e)));
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
  // CR-105: a quoted string outside a dependency array is never a dependency; an extra's ] does not end the array.
  const described = repo(t, { "pyproject.toml": '[project]\nname = "demo"\ndescription = "sqlalchemy"\ndependencies = []\n', "x.py": "" });
  assert.ok(!named(detectRepo(described, modules), "sqlalchemy"));
  const extras = repo(t, { "pyproject.toml": '[project]\nname = "x"\n\n[project.optional-dependencies]\ndb = [\n  "supabase[async]>=2",\n  "sqlalchemy",\n]\n', "x.py": "" });
  const de = detectRepo(extras, modules);
  assert.ok(named(de, "supabase-py") && named(de, "sqlalchemy"), de.proposals.map((p) => p.name).join(","));
  // A `#` inside a quoted requirement (a URL fragment) is not a comment (verify regression); one after the strings is.
  const fragment = repo(t, { "pyproject.toml": '[project]\nname = "x"\ndependencies = ["pkg @ https://example.com/p.zip#sha256=abc", "sqlalchemy"]  # "supabase"\n', "x.py": "" });
  const df = detectRepo(fragment, modules);
  assert.ok(named(df, "sqlalchemy"), df.proposals.map((p) => p.name).join(","));
  assert.ok(!named(df, "supabase-py"), "a name in a trailing comment is not a dependency");
  const groups = repo(t, { "pyproject.toml": '[dependency-groups]\ndev = ["SQLAlchemy"]\n', "x.py": "" });
  assert.ok(named(detectRepo(groups, modules), "sqlalchemy"));
  // CR-111: a Pipfile's [packages] and [dev-packages] tables.
  for (const table of ["packages", "dev-packages"]) {
    const pip = repo(t, { Pipfile: `[[source]]\nurl = "https://pypi.org/simple"\n\n[${table}]\nsqlalchemy = "*"\n\n[requires]\npython_version = "3.12"\n`, "x.py": "" });
    assert.match(named(detectRepo(pip, modules), "sqlalchemy").evidence[0], /`sqlalchemy` in `Pipfile`/, table);
  }
  const notPip = repo(t, { Pipfile: '[requires]\npython_version = "3.12"\nsqlalchemy = "x"\n', "x.py": "" });
  assert.ok(!named(detectRepo(notPip, modules), "sqlalchemy"), "a key outside the packages tables is not a dependency");
  const fromCall = repo(t, { "app/q.py": 'def q():\n    return db.from_("jobs").select("*")\n' });
  assert.ok(named(detectRepo(fromCall, modules), "supabase-py").evidence.some((e) => /calls in `app\/q\.py`/.test(e)), "the .from_() spelling");
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
  assert.equal(narrateCoverage([]), "No records yet — derive found nothing to check. The check runs once code appears.");
  const many = Array.from({ length: 23 }, (_, i) => ({ kind: "route", id: `route:/r${String(i).padStart(2, "0")}`, title: `/r${String(i).padStart(2, "0")}`, refs: [], facts: {} }));
  const text = narrateCoverage(coverageOf(many));
  assert.match(text, /^23 routes; 23 link to nothing: `\/r00`, .*`\/r19`, and 3 more; 23 nothing links to: /);
  assert.match(narrateCoverage(coverageOf([{ kind: "data-access", id: "data-access:a", title: "a", refs: [], facts: {} }, { kind: "data-access", id: "data-access:b", title: "b", refs: [], facts: {} }])), /^2 data-accesses;/, "a kind ending in s");
});

test("preview writes only into a real, empty folder outside the repo (CR-098); an unknown name is refused (CR-115)", (t) => {
  const root = repo(t, { "a.txt": "x" });
  assert.throws(() => previewTarget(root, join(root, "preview")), /is inside the repo/);
  assert.throws(() => previewTarget(root, root), /is not empty|is inside the repo/);
  assert.ok(!existsSync(join(root, "preview")), "refused before it is made");
  const busy = repo(t, { "x.txt": "" });
  assert.throws(() => previewTarget(root, busy), /is not empty/);
  const fresh = join(mkdtempSync(join(tmpdir(), "zdd-prevout-")), "new");
  t.after(() => rmSync(dirname(fresh), { recursive: true, force: true }));
  assert.equal(previewTarget(root, fresh), fresh);
  const linkTo = mkdtempSync(join(tmpdir(), "zdd-prevlink-"));
  t.after(() => rmSync(linkTo, { recursive: true, force: true }));
  const link = join(dirname(fresh), "link");
  try {
    symlinkSync(linkTo, link, "junction"); // empty and outside the repo: only the link itself is wrong
    assert.throws(() => previewTarget(root, link), /is a link or not a folder/);
  } catch (e) {
    if (e.code !== "EPERM") throw e;
  }
  // Through the CLI: --out inside the repo exits 2 and writes nothing; a typo is refused.
  const cli = spawnSync(process.execPath, [BIN, "preview", "--extractors=fastapi", `--root=${root}`, `--out=${join(root, "p")}`], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /inside the repo/);
  assert.deepEqual(readdirSync(root), ["a.txt"]);
  const typo = spawnSync(process.execPath, [BIN, "preview", "--extractors=fastapy", `--root=${root}`], { encoding: "utf8" });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /fastapy is not an adapter in the catalogue/);
  const out = join(dirname(fresh), "cli");
  const ok = spawnSync(process.execPath, [BIN, "preview", "--extractors=fastapi", `--root=${root}`, `--out=${out}`, "--json"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).humanIndex, join(out, "zdd", "human-index.html"));
});

test("the call-name grammar bootstrap checks is the one supabase-js reads, and a name outside it is a diagnostic (CR-102)", (t) => {
  for (const name of ["supabase-js", "nextjs", "react-router"]) assert.equal(modules.find((m) => m.name === name).mod.DETECTION.optionShape.callName, CALL_NAME.source, name);
  const root = repo(t, { "src/a.ts": "" });
  const out = supabaseJsDerive({ options: { subscribeCalls: ["live.onInsert", 'live["x"]'] }, io: makeExtractorIo(root, "supabase-js") });
  assert.ok(out.diagnostics.some((d) => d.includes(`subscribeCalls: 'live["x"]' is not a call name`)), out.diagnostics.join("|"));
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
