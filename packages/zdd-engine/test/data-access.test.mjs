// Data access as its own adapter (decision 0037): the Python source helpers,
// the sqlalchemy and supabase-py adapters, FastAPI's handler and call refs,
// and the core's fold and absorb, end to end on test/fixture-sqlalchemy.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defs, imports, masked, moduleFiles, resolveModule, strings } from "../src/adapters/python/source.mjs";
import { sqlTables } from "../src/adapters/sqlalchemy/index.mjs";
import { derive as supabasePy, scanCalls } from "../src/adapters/supabase-py/index.mjs";
import { handlerRefs, parseFile } from "../src/adapters/fastapi/index.mjs";
import { resolveRefs } from "../src/core/lib/resolve-refs.mjs";
import { makeExtractorIo } from "../src/core/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-sqlalchemy");

function deriveFixture() {
  const repo = mkdtempSync(join(tmpdir(), "zdd-sqla-"));
  cpSync(FIXTURE, repo, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, "derive", `--root=${repo}`, "--verbose"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const read = (kind) => {
    const dir = join(repo, "zdd", "metadata", kind);
    return existsSync(dir) ? readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
  };
  const out = { routes: read("route"), access: read("data-access"), stderr: r.stderr };
  rmSync(repo, { recursive: true, force: true });
  return out;
}

// ---- the Python source helpers ----

test("defs: every def at any indent, its body by indentation, one entry per name", () => {
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

test("masked and strings: comments and string contents blanked, literals read with prefixes and triple quotes; a word before a quote is not a prefix", () => {
  const src = `x = f(rb'one', "two") # three\ny = """four\nfive"""\nverb'six'`;
  const m = masked(src);
  assert.equal(m.length, src.length);
  assert.ok(!m.includes("three") && !m.includes("two") && !m.includes("four"));
  assert.ok(m.includes("verb"), "the identifier stays code");
  assert.deepEqual(strings(src), ["one", "two", "four\nfive", "six"]);
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

// ---- sqlalchemy ----

test("sqlTables: reads after FROM/JOIN, writes after INTO/UPDATE/DELETE FROM, quoted and schema-qualified; non-table words are never tables", () => {
  assert.deepEqual(sqlTables(`SELECT a FROM jobs j JOIN "public"."offers" o ON o.job_id = j.id`), { reads: ["jobs", "public.offers"], writes: [] });
  assert.deepEqual(sqlTables(`INSERT INTO public.job_events (a) VALUES (1)`), { reads: [], writes: ["public.job_events"] });
  assert.deepEqual(sqlTables(`UPDATE jobs SET s = 1 WHERE id IN (SELECT job_id FROM offers)`), { reads: ["offers"], writes: ["jobs"] });
  assert.deepEqual(sqlTables(`DELETE FROM offers WHERE id = 1`), { reads: [], writes: ["offers"] });
  assert.deepEqual(sqlTables(`INSERT INTO jobs (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2`), { reads: [], writes: ["jobs"] });
  assert.deepEqual(sqlTables(`SELECT * FROM LATERAL unnest(x)`), { reads: [], writes: [] });
  // A non-table word after FROM is read here and dropped by the resolver:
  assert.deepEqual(sqlTables(`SELECT EXTRACT(EPOCH FROM created_at) FROM jobs`).reads, ["created_at", "jobs"]);
});

// ---- supabase-py ----

test("supabase-py: one record per function with client calls, the calls as unresolved refs, a docstring call read as written", () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-sbpy-"));
  mkdirSync(join(repo, "app"));
  writeFileSync(join(repo, "app", "data.py"), `def load(db):\n    """Load."""\n    return db.table("jobs").select().execute()\n\ndef save(db):\n    db.rpc("save_job", {})\n    db.from_("uploads").upload()\n\ndef plain():\n    return 1\n`);
  try {
    const { records } = supabasePy({ repoRoot: repo, options: { roots: ["app"] }, io: makeExtractorIo(repo) });
    assert.deepEqual(records.map((r) => [r.id, r.refs]), [
      ["data-access:supabase-py/app/data.py#load", ["?from:jobs"]],
      ["data-access:supabase-py/app/data.py#save", ["?from:uploads", "?function:save_job"]],
    ]);
    assert.equal(records[0].description, "Load.");
    assert.equal(records[0].filename, "supabase-py--app--data-py--load.json");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  assert.deepEqual([...scanCalls(`x.table('a')\nx.table(name)`)], ["?from:a"], "a variable table name is not seen");
});

// ---- FastAPI: the code a handler runs ----

test("FastAPI handlerRefs: the handler itself, module and member imports, same-file defs; ambiguous and unknown targets skipped", () => {
  const files = ["app/routes/jobs.py", "app/repositories/jobs.py", "app/repositories/events.py", "app/a/util.py", "app/b/util.py"];
  const by = moduleFiles(files);
  const text = `from app.repositories import jobs as repo\nfrom app.repositories.events import record_event\nfrom . import jobs as same\nimport util\n\ndef helper():\n    pass\n`;
  const file = { rel: "app/routes/jobs.py", imports: imports(text), defNames: new Set(defs(text).map((d) => d.name)) };
  const body = `    repo.list_jobs(conn)\n    record_event(conn)\n    helper()\n    util.summarise()\n    print("repo.fake(x)")  # repo.nope()\n    same.thing()\n`;
  assert.deepEqual([...handlerRefs({ name: "h", body }, file, by)].sort(), [
    "?code:app/repositories/events.py#record_event",
    "?code:app/repositories/jobs.py#list_jobs",
    "?code:app/routes/jobs.py#h",
    "?code:app/routes/jobs.py#helper",
    "?code:app/routes/jobs.py#thing",
  ]);
});

test("FastAPI: include_router follows the file's import when two modules share a basename", () => {
  const { includes } = parseFile(`from app.routes import jobs\napp.include_router(jobs.router, prefix="/jobs")\n`);
  assert.deepEqual(includes.map((i) => i.target), ["jobs.router"]);
  const { routes } = deriveFixture();
  assert.ok(routes.some((r) => r.id === "route:/jobs/"), "the router is mounted although app/repositories/jobs.py shares its basename");
});

// ---- the core: fold and absorb ----

const rec = (kind, id, refs = [], extra = {}) => ({ kind, id, title: id, description: "", resource: [`${kind}.x`], refs, facts: {}, filename: "x.json", ...extra });
const access = (adapter, file, fn, refs, edges) => rec("data-access", `data-access:${adapter}/${file}#${fn}`, refs, { resource: [file], facts: { function: fn, ...(edges ? { edges } : {}) }, requireRefs: true });

test("fold: a route takes the tables of the code it runs; inline data access is absorbed, a repository function stays as its own node", () => {
  const { records, diagnostics } = resolveRefs([
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

test("fold: a data-access record whose tables all miss is pruned, and the route keeps nothing of it", () => {
  const { records } = resolveRefs([access("sqlalchemy", "r.py", "f", ["?table:nope"]), rec("route", "route:/x", ["?code:r.py#f"], { resource: ["other.py"] })]);
  assert.deepEqual(records.map((r) => [r.id, r.refs]), [["route:/x", []]]);
});

// ---- end to end ----

test("fixture-sqlalchemy: every route reaches the tables its repository SQL names, through the code it runs", () => {
  const { routes, access: dataAccess, stderr } = deriveFixture();
  const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
  assert.deepEqual(byId["route:/jobs/"].refs, ["data-access:sqlalchemy/app/repositories/jobs.py#list_jobs", "table:db/jobs"]);
  assert.deepEqual(byId["route:/jobs/{id}/cancel"].facts.edges, { writes: ["table:db/jobs", "table:db/public.job_events"] });
  assert.deepEqual(byId["route:/jobs/count"].refs, ["table:db/offers"], "inline SQL, absorbed");
  assert.deepEqual(byId["route:/jobs/stats"].refs, [], "util.py is ambiguous: skipped, never guessed");
  assert.ok(!dataAccess.some((d) => d.id.includes("routes/jobs.py")), "no data-access node for a handler's own SQL");
  assert.ok(!dataAccess.some((d) => d.facts.function === "describe" || d.facts.function === "_ok"), "prose and comments are not SQL");
  assert.match(stderr, /table 'created_at' matches no known table — dropped/, "a column after FROM is dropped, never invented");
});
