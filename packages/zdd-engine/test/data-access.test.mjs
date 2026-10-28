// Data access as its own adapter (decision 0037): the Python source helpers,
// the sqlalchemy and supabase-py adapters, FastAPI's handler and call refs,
// and the core's fold and absorb, end to end on test/fixture-sqlalchemy.
// The slice 2a review (CR-013 to CR-044) is pinned here case by case.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeOver, dataAccessRecord, defs, imports, masked, moduleFiles, resolveModule, strings } from "../src/adapters/python/source.mjs";
import { sqlTables } from "../src/adapters/sqlalchemy/index.mjs";
import { derive as supabasePy, scanCalls } from "../src/adapters/supabase-py/index.mjs";
import { derive as fastapi, handlerRefs, parseFile, MAX_REACH } from "../src/adapters/fastapi/index.mjs";
import { resolveRefs } from "../src/core/lib/resolve-refs.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";
import { claimableRecords } from "../src/core/lib/claims.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-sqlalchemy");
const FILENAME_RE = /^[A-Za-z0-9._~()\[\]-]+\.json$/; // derive's

function fixtureRun({ render = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-sqla-"));
  cpSync(FIXTURE, repo, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, "derive", `--root=${repo}`, "--verbose"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const read = (kind) => {
    const dir = join(repo, "zdd", "metadata", kind);
    return existsSync(dir) ? readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
  };
  const out = { routes: read("route"), access: read("data-access"), stdout: r.stdout, stderr: r.stderr, repo };
  if (render) {
    const g = spawnSync(process.execPath, [BIN, "render", `--root=${repo}`], { encoding: "utf8" });
    assert.equal(g.status, 0, g.stderr);
    out.graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
    out.claimable = claimableRecords(join(repo, "zdd", "metadata"), join(repo, "zdd"), [], [], []);
  }
  return out;
}
const done = (run) => rmSync(run.repo, { recursive: true, force: true });

const entriesOf = (text) => new Map(defs(text).map((d) => [d.name, d]));
const fileOf = (rel, text) => ({ rel, imports: imports(text), entries: entriesOf(text) });
const timed = (fn) => {
  const t = Date.now();
  fn();
  return Date.now() - t;
};

// ---- the Python source helpers ----

test("defs: every def at any indent, its own body, one entry per name", () => {
  const found = defs(`
async def a(x):
    """Doc a."""
    return 1

class C:
    def get(self):
        return 2

class D:
    def get(self):
        return 3
`);
  assert.deepEqual(found.map((d) => d.name), ["a", "get"]);
  assert.equal(found[0].docstring, "Doc a.");
  assert.match(found[1].body, /return 2[\s\S]*return 3/, "two defs named get are one entry, bodies joined");
});

test("defs: a signature over several lines, closing at the def's indent, still has its body and docstring", () => {
  const [d] = defs(`async def _end(
    engine,
    job_id: str, *, status: str = "x(",
) -> dict[str, object]:
    """Ends a job."""
    await jobs.end_job(conn)

def after():
    pass
`);
  assert.equal(d.name, "_end");
  assert.equal(d.docstring, "Ends a job.");
  assert.match(d.body, /jobs\.end_job/);
  assert.ok(!d.body.includes("def after"));
  const { handlers } = parseFile(`@router.get("/x")\nasync def h(\n    a: int,\n) -> dict:\n    """Doc."""\n    return 1\n`);
  assert.equal(handlers[0].docstring, "Doc.", "FastAPI reads the same body: the description is found");
});

test("CR-024: a one-line function keeps its suite", () => {
  const [d] = defs(`def load(c): return c.execute("SELECT * FROM jobs")\n`);
  assert.match(d.body, /SELECT \* FROM jobs/);
});

test("CR-023: a def written inside a string is no function", () => {
  assert.deepEqual(defs(`"""\ndef phantom(db):\n    return db.table("jobs")\n"""\ns = 'def other(): pass'\n`).map((d) => d.name), []);
});

test("CR-025: a string default holding brackets, over several lines, does not end the signature early", () => {
  const [d] = defs(`def handler(\n    prompt="""text\n    )\n    more text""",\n):\n    return repo.load()\n`);
  assert.match(d.body, /repo\.load\(\)/);
});

test("CR-022: a nested function counts toward its outer one only when the outer refers to it (called, or passed as a callback)", () => {
  const found = new Map(defs(`async def _end(engine):
    async def work(conn):
        await jobs.end_job(conn)
    def unused():
        return conn.execute("SELECT * FROM secrets")
    return await _write(engine, work)
`).map((d) => [d.name, d]));
  assert.ok(!found.get("_end").body.includes("end_job"), "a nested def is its own entry, not the outer's body");
  assert.deepEqual([...found.get("_end").refers], ["_end.work"], "work is passed as a callback: referred to (by its full name); unused is not");
  assert.match(found.get("_end.work").body, /end_job/);
});

test("nested defs are named by their full path, so two helpers' nested `work` callbacks never pick up each other's calls", () => {
  const by = moduleFiles(["app/routes/x.py", "app/repositories/jobs.py"]);
  const text = `from app.repositories import jobs\n\ndef _add(c):\n    async def work(conn):\n        jobs.add(conn)\n    return _write(c, work)\n\ndef _edit(c):\n    async def work(conn):\n        jobs.edit(conn)\n    return _write(c, work)\n\ndef h(c):\n    return _add(c)\n`;
  const refs = [...handlerRefs({ name: "h" }, fileOf("app/routes/x.py", text), by)].sort();
  assert.ok(refs.includes("?code:app/repositories/jobs.py#add"));
  assert.ok(!refs.includes("?code:app/repositories/jobs.py#edit"), "the other helper's work is another function");
  assert.ok(refs.includes("?code:app/routes/x.py#_add.work"));
});

test("CR-040: a docstring with a u/R prefix, or its summary on the next line, is read; an apostrophe does not cut it", () => {
  assert.deepEqual(defs(`def a():\n    u"""Uni."""\ndef b():\n    R'''Raw.'''\ndef c():\n    """\n    Next line summary.\n    """\ndef d():\n    """It's here."""\ndef e():\n    x = 1\n    """Not a docstring."""\n`).map((x) => x.docstring), ["Uni.", "Raw.", "Next line summary.", "It's here.", ""]);
});

test("masked and strings: comments and string contents blanked, literals read with prefixes and triple quotes; a word before a quote is not a prefix", () => {
  const src = `x = f(rb'one', "two") # three\ny = """four\nfive"""\nverb'six'`;
  const m = masked(src);
  assert.equal(m.length, src.length);
  assert.ok(!m.includes("three") && !m.includes("two") && !m.includes("four"));
  assert.ok(m.includes("verb"), "the identifier stays code");
  assert.deepEqual(strings(src), ["one", "two", "four\nfive", "six"]);
});

test("CR-026: a backslash keeps a quote from ending a raw string too", () => {
  assert.deepEqual(strings(String.raw`x = r"SELECT \"x\" FROM jobs"; y = 'z'`), [String.raw`SELECT \"x\" FROM jobs`, "z"]);
});

test("CR-021: an f-string's {expression} stays code; its literal text and {{ }} are blanked; length kept", () => {
  const src = `f"count={jobs.count_open(conn)} {{not}} done"`;
  const m = masked(src);
  assert.equal(m.length, src.length);
  assert.ok(m.includes("jobs.count_open(conn)"));
  assert.ok(!m.includes("count=") && !m.includes("not") && !m.includes("done"));
});

test("imports: plain, aliased, from, relative, parenthesised, continued; a string or comment is no import", () => {
  const map = imports(`
import util
import app.db as db
from app.repositories import jobs as jobs_repo, offers
from .events import (
    record_event,
    other as renamed,
)
from . import sibling
from a.b import \\
    c
# from fake import nope
s = "import nothing"
`);
  assert.deepEqual(Object.fromEntries(map), {
    util: { module: "util" },
    db: { module: "app.db" },
    jobs_repo: { module: "app.repositories", member: "jobs" },
    offers: { module: "app.repositories", member: "offers" },
    record_event: { module: ".events", member: "record_event" },
    renamed: { module: ".events", member: "other" },
    sibling: { module: ".", member: "sibling" },
    c: { module: "a.b", member: "c" },
  });
});

test("CR-016, CR-017: malformed input stays linear — unclosed signatures and an unclosed import list", () => {
  assert.ok(timed(() => defs(Array.from({ length: 5000 }, (_, i) => `def f${i}(\n`).join(""))) < 2000);
  assert.ok(timed(() => imports(`from x import (\n${"a,\n".repeat(20000)}`)) < 2000);
});

test("closeOver: a long chain and a cycle close in linear time, each function once", () => {
  const chain = defs(Array.from({ length: 20000 }, (_, i) => `def f${i}():\n    f${i + 1}()\n`).join(""));
  let closed;
  assert.ok(timed(() => (closed = closeOver(chain, (d) => new Set(d.name === "f19999" ? ["jobs"] : [])))) < 3000);
  assert.ok(closed.get("f0").has("jobs"));
  const cyc = closeOver(defs(`def a():\n    b()\ndef b():\n    a()\n    t()\ndef t():\n    pass\n`), (d) => new Set(d.name === "t" ? ["x"] : []));
  assert.deepEqual([...cyc.get("a")], ["x"]);
});

test("resolveModule: dotted paths, relative imports, packages; ambiguous and unknown are null", () => {
  const files = ["app/repositories/jobs.py", "app/routes/jobs.py", "app/a/util.py", "app/b/util.py", "app/single.py", "app/pkg/__init__.py"];
  const by = moduleFiles(files);
  assert.equal(resolveModule("app/routes/x.py", "app.repositories.jobs", by), "app/repositories/jobs.py");
  assert.equal(resolveModule("app/routes/x.py", ".jobs", by), "app/routes/jobs.py");
  assert.equal(resolveModule("app/routes/x.py", "..repositories.jobs", by), "app/repositories/jobs.py");
  assert.equal(resolveModule("app/x.py", "single", by), "app/single.py");
  assert.equal(resolveModule("app/x.py", "app.pkg", by), "app/pkg/__init__.py");
  assert.equal(resolveModule("app/x.py", "jobs", by), null, "two jobs.py and no package to tell them apart");
  assert.equal(resolveModule("app/x.py", "util", by), null);
  assert.equal(resolveModule("app/x.py", "nowhere", by), null);
});

test("CR-031: a source path a metadata filename may not hold is encoded, never an abort", () => {
  const r = dataAccessRecord("sqlalchemy", "notes/my data#1.py", { name: "f", docstring: "" }, new Set(["?table:jobs"]));
  assert.match(r.filename, FILENAME_RE);
  assert.equal(r.filename, "sqlalchemy--notes--my~20~data~23~1-py--f.json");
});

// ---- sqlalchemy ----

test("sqlTables: reads and writes, quoting part by part, lists, ONLY, CTEs, comments and literals, FROM inside functions (CR-027 to CR-030)", () => {
  const cases = [
    [`SELECT a FROM jobs j JOIN "public"."offers" o ON o.job_id = j.id`, ["jobs", "public.offers"], []],
    [`INSERT INTO public.job_events (a) VALUES (1)`, [], ["public.job_events"]],
    [`INSERT INTO jobs (a, b) VALUES (1, 2)`, [], ["jobs"]],
    [`UPDATE jobs SET s = 1 WHERE id IN (SELECT job_id FROM offers)`, ["offers"], ["jobs"]],
    [`DELETE FROM offers WHERE id = 1`, [], ["offers"]],
    [`DELETE FROM ONLY jobs WHERE id = 1`, [], ["jobs"]],
    [`UPDATE ONLY jobs SET a = 1`, [], ["jobs"]],
    [`INSERT INTO jobs (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2`, [], ["jobs"]],
    [`SELECT * FROM public."jobs"`, ["public.jobs"], []],
    [`SELECT * FROM "archive".jobs`, ["archive.jobs"], []],
    [`SELECT * FROM jobs, offers o, "public".authors AS c WHERE 1=1`, ["jobs", "offers", "public.authors"], []],
    [`WITH jobs AS (SELECT * FROM offers) SELECT * FROM jobs`, ["offers"], []],
    [`WITH recent AS (SELECT 1 FROM jobs), other AS (SELECT 2 FROM offers) SELECT * FROM recent JOIN other ON true`, ["jobs", "offers"], []],
    [`SELECT 'FROM secret' AS example FROM jobs -- JOIN audit`, ["jobs"], []],
    [`SELECT /* FROM hidden */ 1 FROM jobs`, ["jobs"], []],
    [`SELECT 'it''s FROM nowhere' FROM jobs`, ["jobs"], []],
    [`SELECT EXTRACT(EPOCH FROM created_at), substring(x FROM 2) FROM jobs`, ["jobs"], []],
    [`SELECT * FROM LATERAL unnest(x)`, [], []],
  ];
  for (const [sql, reads, writes] of cases) assert.deepEqual(sqlTables(sql), { reads, writes }, sql);
});

// ---- supabase-py ----

function supabasePyOn(files, options) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-sbpy-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  }
  try {
    return supabasePy({ repoRoot: repo, options, io: makeExtractorIo(repo) });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("supabase-py: one record per function with client calls, the calls as unresolved refs; a call in a docstring is read as written (CR-039)", () => {
  const { records } = supabasePyOn({
    "app/data.py": `def load(db):\n    """Load. Example: db.rpc("documented_only")"""\n    return db.table("jobs").select().execute()\n\ndef save(db):\n    db.rpc("save_job", {})\n    db.from_("uploads").upload()\n\ndef plain():\n    return 1\n`,
  }, { roots: ["app"] });
  assert.deepEqual(records.map((r) => [r.id, r.refs]), [
    ["data-access:supabase-py/app/data.py#load", ["?from:jobs", "?function:documented_only"]],
    ["data-access:supabase-py/app/data.py#save", ["?from:uploads", "?function:save_job"]],
  ]);
  assert.equal(records[0].description, "Load. Example: db.rpc(\"documented_only\")");
  assert.equal(records[0].filename, "supabase-py--app--data-py--load.json");
  assert.deepEqual([...scanCalls(`x.table('a')\nx.table(name)`)], ["?from:a"], "a variable table name is not seen");
});

test("supabase-py: a function carries the calls of the same-file functions it uses", () => {
  const { records } = supabasePyOn({ "app/h.py": `def handler(db):\n    return _load(db)\n\ndef _load(db):\n    return db.table("jobs").select()\n` }, { roots: ["app"] });
  assert.deepEqual(records.map((r) => [r.facts.function, r.refs]), [["handler", ["?from:jobs"]], ["_load", ["?from:jobs"]]]);
});

test("CR-034: supabase-py through io — a missing root, an ignored root, a file root, a refused folder", () => {
  const missing = supabasePyOn({}, { roots: ["nowhere"] });
  assert.deepEqual(missing.records, []);
  assert.match(missing.diagnostics.join("\n"), /nowhere not found — nothing to inventory/);
  const ignored = supabasePyOn({ ".claude/worktrees/x/a.py": `def f(db):\n    db.table("jobs")\n` }, { roots: [".claude/worktrees/x"] });
  assert.deepEqual(ignored.records, [], "a second checkout is never source");
  assert.match(ignored.diagnostics.join("\n"), /gitignored — not source, not read/);
  const file = supabasePyOn({ "one.py": `def f(db):\n    db.table("jobs")\n` }, { roots: ["one.py"] });
  assert.deepEqual(file.records.map((r) => r.id), ["data-access:supabase-py/one.py#f"]);
  const repo = mkdtempSync(join(tmpdir(), "zdd-sbpy-link-"));
  const outside = mkdtempSync(join(tmpdir(), "zdd-sbpy-out-"));
  writeFileSync(join(outside, "x.py"), `def f(db):\n    db.table("jobs")\n`);
  try {
    symlinkSync(outside, join(repo, "linked"), "junction");
  } catch {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    return; // this machine cannot create links; the rest of the case stands
  }
  try {
    const linked = supabasePy({ repoRoot: repo, options: { roots: ["linked"] }, io: makeExtractorIo(repo) });
    assert.deepEqual(linked.records, [], "a linked folder is never walked");
    assert.match(linked.diagnostics.join("\n"), /linked/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---- FastAPI: the code a handler runs ----

test("FastAPI handlerRefs: the handler itself, module and member imports, same-file functions; ambiguous and unknown targets skipped", () => {
  const by = moduleFiles(["app/routes/jobs.py", "app/repositories/jobs.py", "app/repositories/events.py", "app/a/util.py", "app/b/util.py"]);
  const text = `from app.repositories import jobs as repo\nfrom app.repositories.events import record_event\nfrom . import jobs as same\nimport util\n\ndef helper():\n    pass\n\ndef h(conn):\n    repo.list_jobs(conn)\n    record_event(conn)\n    helper()\n    util.summarise()\n    print("repo.fake(x)")  # repo.nope()\n    same.thing()\n`;
  assert.deepEqual([...handlerRefs({ name: "h" }, fileOf("app/routes/jobs.py", text), by)].sort(), [
    "?code:app/repositories/events.py#record_event",
    "?code:app/repositories/jobs.py#list_jobs",
    "?code:app/routes/jobs.py#h",
    "?code:app/routes/jobs.py#helper",
    "?code:app/routes/jobs.py#thing",
  ]);
});

test("FastAPI handlerRefs: same-file helpers followed as far as they go, cycles once, nested callbacks too; out of the file one hop", () => {
  const by = moduleFiles(["app/routes/x.py", "app/repositories/jobs.py"]);
  const text = `from app.repositories import jobs\n\ndef _end(c):\n    async def work(conn):\n        await jobs.cancel(conn)\n    return _write(c, work)\n\ndef _write(c, fn):\n    return _end(c)\n\ndef unused():\n    jobs.other()\n\ndef h(c):\n    return _end(c)\n`;
  assert.deepEqual([...handlerRefs({ name: "h" }, fileOf("app/routes/x.py", text), by)].sort(), [
    "?code:app/repositories/jobs.py#cancel",
    "?code:app/routes/x.py#_end",
    "?code:app/routes/x.py#_end.work",
    "?code:app/routes/x.py#_write",
    "?code:app/routes/x.py#h",
  ]);
});

test("CR-020: a parameter or local that shadows an import is not the import", () => {
  const by = moduleFiles(["app/routes/x.py", "app/repository.py", "app/repositories/jobs.py"]);
  const text = `from app.repository import load\nfrom app.repositories import jobs\n\ndef h(load):\n    jobs = Fake()\n    jobs.list_jobs()\n    call(\n        other=1,\n    )\n    return load()\n`;
  assert.deepEqual([...handlerRefs({ name: "h" }, fileOf("app/routes/x.py", text), by)], ["?code:app/routes/x.py#h"]);
});

test("CR-018: one handler's walk is bounded, and each handler's refs are computed once", () => {
  const n = MAX_REACH + 500;
  const text = Array.from({ length: n }, (_, i) => `def f${i}():\n    f${i + 1}()\n`).join("") + `def h():\n    f0()\n`;
  let refs;
  assert.ok(timed(() => (refs = handlerRefs({ name: "h" }, fileOf("x.py", text), moduleFiles(["x.py"])))) < 3000);
  assert.ok(refs.size <= MAX_REACH + 1);
});

function fastapiOn(files, options = { roots: ["."] }) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-fa-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  }
  try {
    return fastapi({ repoRoot: repo, options, io: makeExtractorIo(repo) });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("FastAPI: include_router follows the file's import when two modules share a basename", () => {
  const { includes } = parseFile(`from app.routes import jobs\napp.include_router(jobs.router, prefix="/jobs")\n`);
  assert.deepEqual(includes.map((i) => i.target), ["jobs.router"]);
  const run = fixtureRun();
  assert.ok(run.routes.some((r) => r.id === "route:/jobs/"), "the router is mounted although app/repositories/jobs.py shares its basename");
  done(run);
});

test("CR-019: an import of the router's module that resolves to no scanned file mounts nothing, never another file of that name", () => {
  const { records, diagnostics } = fastapiOn({
    "main.py": `from fastapi import FastAPI\nfrom missing_package import jobs\napp = FastAPI()\napp.include_router(jobs.router, prefix="/jobs")\n`,
    "other/jobs.py": `from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/")\ndef list_them():\n    return []\n`,
  });
  assert.deepEqual(records.map((r) => r.id), []);
  assert.match(diagnostics.join("\n"), /imported from 'missing_package\.jobs', which is not one scanned file; mount ignored/);
});

test("CR-015: FastAPI reads through io — an over-size file is skipped with a diagnostic, not read", () => {
  const big = `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/big")\ndef big():\n    return 1\n# ${"x".repeat(1024 * 1024)}\n`;
  const { records, diagnostics } = fastapiOn({ "big.py": big, "ok.py": `from fastapi import FastAPI\napp = FastAPI()\n@app.get("/ok")\ndef ok():\n    return 1\n` });
  assert.deepEqual(records.map((r) => r.id), ["route:/ok"]);
  assert.match(diagnostics.join("\n"), /big\.py: .* — skipped/);
});

// ---- the core: fold and absorb ----

const rec = (kind, id, refs = [], extra = {}) => ({ kind, id, title: id, description: "", resource: [`${kind}.x`], refs, facts: {}, filename: "x.json", ...extra });
const access = (adapter, file, fn, refs, edges) => rec("data-access", `data-access:${adapter}/${file}#${fn}`, refs, { resource: [file], facts: { function: fn, ...(edges ? { edges } : {}) }, requireRefs: true });

test("fold: a route takes the tables of the code it runs; inline data access is absorbed, a repository function stays as its own node", () => {
  const { records, diagnostics, warnings } = resolveRefs([
    rec("table", "table:db/jobs"),
    rec("table", "table:db/offers"),
    access("sqlalchemy", "routes.py", "count", ["?table:offers"], { reads: ["?table:offers"] }),
    access("sqlalchemy", "repo.py", "list_jobs", ["?table:jobs"], { reads: ["?table:jobs"] }),
    rec("route", "route:/count", ["?code:routes.py#count", "?code:routes.py#nothing"], { resource: ["routes.py"] }),
    rec("route", "route:/jobs", ["?code:routes.py#list", "?code:repo.py#list_jobs"], { resource: ["routes.py"] }),
  ]);
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));
  assert.deepEqual(byId["route:/count"].refs, ["table:db/offers"]);
  assert.deepEqual(byId["route:/count"].facts.edges, { reads: ["table:db/offers"] });
  assert.ok(!byId["data-access:sqlalchemy/routes.py#count"], "inline: absorbed");
  assert.deepEqual(byId["route:/jobs"].refs, ["data-access:sqlalchemy/repo.py#list_jobs", "table:db/jobs"]);
  assert.ok(byId["data-access:sqlalchemy/repo.py#list_jobs"], "across files: kept");
  assert.deepEqual(diagnostics, [], "a ?code: miss is silent");
  assert.deepEqual(warnings, [], "data access is configured: no warning");
});

test("fold: two adapters reading one function are both reached; a record reached from its own file and from another stays", () => {
  const { records } = resolveRefs([
    rec("table", "table:db/jobs"),
    rec("function", "function:db/save"),
    access("sqlalchemy", "a.py", "f", ["?table:jobs"]),
    access("supabase-py", "a.py", "f", ["?function:save"]),
    rec("route", "route:/a", ["?code:a.py#f"], { resource: ["a.py"] }),
    rec("route", "route:/b", ["?code:a.py#f"], { resource: ["b.py"] }),
  ]);
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));
  assert.deepEqual(byId["route:/a"].refs, ["data-access:sqlalchemy/a.py#f", "data-access:supabase-py/a.py#f", "function:db/save", "table:db/jobs"]);
  assert.ok(byId["data-access:sqlalchemy/a.py#f"] && byId["data-access:supabase-py/a.py#f"], "route /b reaches them across files, so both stay");
});

test("CR-035: folding merges typed edges with the referrer's own and across several data-access records, sorted and de-duplicated", () => {
  const { records } = resolveRefs([
    rec("table", "table:db/jobs"),
    rec("table", "table:db/offers"),
    rec("table", "table:db/events"),
    access("sqlalchemy", "r.py", "a", ["?table:jobs", "?table:offers"], { reads: ["?table:jobs"], writes: ["?table:offers"] }),
    access("sqlalchemy", "s.py", "b", ["?table:jobs", "?table:events"], { reads: ["?table:jobs", "?table:events"] }),
    rec("route", "route:/x", ["?code:r.py#a", "?code:s.py#b", "?table:events"], { resource: ["x.py"], facts: { edges: { subscribes: ["?table:events"], reads: ["?table:offers"] } } }),
  ]);
  const route = records.find((r) => r.id === "route:/x");
  assert.deepEqual(route.facts.edges, {
    reads: ["table:db/events", "table:db/jobs", "table:db/offers"],
    subscribes: ["table:db/events"],
    writes: ["table:db/offers"],
  });
});

test("CR-036: a data-access record does not follow its own ?code: refs (one hop)", () => {
  const { records } = resolveRefs([
    rec("table", "table:db/jobs"),
    access("sqlalchemy", "a.py", "outer", ["?code:b.py#inner", "?table:nope"]),
    access("sqlalchemy", "b.py", "inner", ["?table:jobs"]),
    rec("route", "route:/x", ["?code:a.py#outer"], { resource: ["x.py"] }),
  ]);
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));
  assert.ok(!byId["route:/x"].refs.includes("table:db/jobs"), "the route does not reach inner's table through outer");
  const outer = byId["data-access:sqlalchemy/a.py#outer"];
  assert.ok(!outer || !outer.refs.includes("table:db/jobs"), "outer does not inherit inner's table");
});

test("fold: a data-access record whose tables all miss is pruned, and the route keeps nothing of it", () => {
  const { records } = resolveRefs([access("sqlalchemy", "r.py", "f", ["?table:nope"]), rec("route", "route:/x", ["?code:r.py#f"], { resource: ["other.py"] })]);
  assert.deepEqual(records.map((r) => [r.id, r.refs]), [["route:/x", []]]);
});

test("CR-013: a schema, routes that name their code, and no data-access adapter warn on every derive; an app with no tables does not", () => {
  assert.deepEqual(resolveRefs([rec("route", "route:/x", ["?code:a.py#f"], { resource: ["a.py"] })]).warnings, [], "no tables: nothing was lost");
  const { warnings } = resolveRefs([rec("table", "table:db/jobs"), rec("route", "route:/x", ["?code:a.py#f", "?code:a.py#g"], { resource: ["a.py"] })]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2 refs name the code a route or screen runs.*no data-access adapter is configured/);
  const run = spawnSync(process.execPath, [BIN, "derive", `--root=${join(PKG, "test", "fixture-fastapi")}`, "--check"], { encoding: "utf8" });
  assert.ok(!/no data-access adapter/.test(run.stderr), "the FastAPI fixture lists supabase-py: no warning");
});

// ---- end to end ----

test("fixture-sqlalchemy: every route reaches the tables its repository SQL names, through the code it runs", () => {
  const run = fixtureRun({ render: true });
  const byId = Object.fromEntries(run.routes.map((r) => [r.id, r]));
  assert.deepEqual(byId["route:/jobs/"].refs, ["data-access:sqlalchemy/app/repositories/jobs.py#list_jobs", "table:db/jobs"]);
  assert.deepEqual(byId["route:/jobs/{id}/cancel"].facts.edges, { writes: ["table:db/jobs", "table:db/public.job_events"] });
  assert.deepEqual(byId["route:/jobs/count"].refs, ["table:db/offers"], "inline SQL, absorbed");
  assert.deepEqual(byId["route:/jobs/stats"].refs, [], "util.py is ambiguous: skipped, never guessed");
  assert.ok(!run.access.some((d) => d.id.includes("routes/jobs.py")), "no data-access node for a handler's own SQL");
  assert.ok(!run.access.some((d) => d.facts.function === "describe" || d.facts.function === "_ok"), "prose and comments are not SQL");
  assert.ok(!/created_at/.test(run.stderr), "a column inside EXTRACT(… FROM …) is never read as a table");
  // CR-042: the summary says data-accesses.
  assert.match(run.stdout, /\d+ data-accesses/);
  // CR-037: a kept repository record is a "Data Access" node with its edges.
  const node = run.graph.nodes.find((n) => n.recordId === "data-access:sqlalchemy/app/repositories/jobs.py#list_jobs");
  assert.equal(node?.type, "Data Access");
  assert.ok(run.graph.edges.some((e) => e.target === node.id), "a route links to it");
  // CR-038: data access is never a claimable record.
  assert.ok(!run.claimable.some((c) => c.kind === "data-access"));
  done(run);
});
