// jobs extractor (CAS-97, decision 0020): workers and scheduled jobs from
// committed run manifests — package.json scripts, a Procfile, Railway files
// — with the mode never guessed, the module's docstring as the description,
// and reads/writes edges from the tables its text names.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseCommand, scanTables, describe, derive } from "../src/extractors/jobs/index.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-jobs");

test("parseCommand: python -m through uv/poetry/pipenv, node/tsx/ts-node files; not a dev server, a test runner, a bare python script or a path that escapes", () => {
  assert.deepEqual(parseCommand("uv run python -m app.housekeeping"), { kind: "python-module", target: "app.housekeeping" });
  assert.deepEqual(parseCommand("poetry run python3 -m worker --once"), { kind: "python-module", target: "worker" });
  assert.deepEqual(parseCommand("python -m app.outbound.worker"), { kind: "python-module", target: "app.outbound.worker" });
  assert.deepEqual(parseCommand("node scripts/nightly.mjs"), { kind: "file", target: "scripts/nightly.mjs" });
  assert.deepEqual(parseCommand("pnpm tsx --env-file=.env src/worker.ts"), { kind: "file", target: "src/worker.ts" });
  assert.equal(parseCommand("uv run fastapi dev app/main.py"), null);
  assert.equal(parseCommand("uv run pytest"), null);
  assert.equal(parseCommand("python app/script.py"), null, "a bare script is not a module run");
  assert.equal(parseCommand("node ../outside.mjs"), null);
  assert.equal(parseCommand(42), null);
});

test("scanTables: client calls read; SQL literals read or write, a table both read and written counts as written; a docstring's SQL counts too", () => {
  const text = `
    rows = await client.table("outbound_messages").select("*")
    await conn.execute(text("select id from jobs where status = 'x'"))
    await conn.execute(text("update jobs set status = 'done' where id = :id"))
    await conn.execute(text("insert into audit_events (job_id) values (:id)"))
    await conn.execute(text("delete from dead_letters where id = :id"))
    await conn.execute(text("select * from public.offers o join carriers c on c.id = o.carrier_id"))
    await conn.execute(text(f"update {self._table} set x = 1"))
  `;
  assert.deepEqual(scanTables(text), {
    reads: ["carriers", "offers", "outbound_messages"],
    writes: ["audit_events", "dead_letters", "jobs"],
  });
  assert.equal(describe('"""First paragraph\nstill first.\n\nSecond paragraph."""\nimport x\n', "a.py"), "First paragraph still first.");
  assert.equal(describe("// The nightly report.\n// Mails it.\nimport x;\n", "a.mjs"), "The nightly report.");
  assert.equal(describe("import x\n", "a.py"), "");
});

test("fixture: four jobs — a Railway file attaches its schedule to the package job it deploys; a config-declared worker; unknown modes elsewhere; a dev server, a test runner and a script that resolves to no file are not jobs; the web process is skipped", () => {
  const out = derive({ repoRoot: FIXTURE, options: { modes: { worker: "worker" } }, io: makeExtractorIo(FIXTURE, "jobs") });
  const by = (name) => out.records.find((r) => r.title === name);
  assert.deepEqual(out.records.map((r) => r.id), ["job:housekeeping", "job:nightly", "job:replay", "job:worker"]);
  const hk = by("housekeeping");
  assert.equal(hk.facts.mode, "scheduled");
  assert.equal(hk.facts.schedule, "0 * * * *");
  assert.equal(hk.facts.command, "uv run python -m app.housekeeping");
  assert.equal(hk.facts.manifest, "apps/api/package.json");
  assert.deepEqual(hk.resource, ["apps/api/app/housekeeping.py", "apps/api/package.json", "apps/api/services/housekeeping/railway.toml"]);
  assert.equal(hk.description, "Housekeeping: the sweep that completes a Scheduled job once its deliver-by date has passed, because no outside system reports a delivery.");
  assert.deepEqual(hk.facts.edges, { writes: ["?table:audit_events", "?table:jobs"] });
  assert.deepEqual(hk.refs, ["?table:audit_events", "?table:jobs"]);
  const worker = by("worker");
  assert.equal(worker.facts.mode, "worker");
  assert.deepEqual(worker.facts.edges, { writes: ["?table:outbound_messages"] });
  assert.equal(by("replay").facts.mode, "unknown");
  assert.deepEqual(by("replay").refs, []);
  const nightly = by("nightly");
  assert.equal(nightly.facts.manifest, "Procfile");
  assert.equal(nightly.facts.mode, "unknown");
  assert.deepEqual(nightly.facts.edges, { reads: ["?table:jobs"], writes: ["?table:reports"] });
  assert.ok(!out.records.some((r) => ["dev", "test", "test:mutation", "missing", "web"].includes(r.title)));
  assert.ok(out.diagnostics.some((d) => /'missing' runs module app\.nowhere, which resolves to no file/.test(d)), out.diagnostics.join("\n"));
  assert.ok(!out.diagnostics.some((d) => /declared in .* and again/.test(d)), "the Railway twin is not a duplicate");
});

test("config: entries declare a process no manifest names; exclude and modes are honoured; bad shapes are refused", () => {
  const io = () => makeExtractorIo(FIXTURE, "jobs");
  const out = derive({ repoRoot: FIXTURE, options: { exclude: ["replay", "nightly"], modes: {}, entries: [{ name: "sweeper", module: "app.housekeeping", cwd: "apps/api", mode: "scheduled", schedule: "0 2 * * *", description: "Declared by hand." }] }, io: io() });
  assert.deepEqual(out.records.map((r) => r.title), ["housekeeping", "sweeper", "worker"]);
  const sweeper = out.records.find((r) => r.title === "sweeper");
  assert.equal(sweeper.description, "Declared by hand.");
  assert.equal(sweeper.facts.mode, "scheduled");
  assert.equal(sweeper.facts.manifest, "zdd/config.json");
  assert.equal(sweeper.facts.command, "python -m app.housekeeping");
  assert.deepEqual(sweeper.resource, ["apps/api/app/housekeeping.py", "zdd/config.json"], "resolved under the entry's cwd");
  assert.equal(out.records.find((r) => r.title === "worker").facts.mode, "unknown");
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { modes: { worker: "cron" } }, io: io() }), /jobs\.modes\.worker must be "worker" or "scheduled"/);
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { entries: [{ name: "x" }] }, io: io() }), /jobs\.entries\[0\] must be/);
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { exclude: "dev" }, io: io() }), /jobs\.exclude must be an array/);
});

test("CLI: derive and render are byte-stable; jobs resolve to tables with reads/writes verbs; lint names the jobs with no stated mode and the worker claimed by its slice counts as claimed once job is claimable", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-jobs-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /Wrote 8 records \(4 jobs, 4 tables\)/);
  const hk = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "job", "housekeeping.json"), "utf8"));
  assert.deepEqual(hk.facts.edges, { writes: ["table:db/audit_events", "table:db/jobs"] });
  assert.equal(run(["derive", "--check"]).status, 0);
  assert.equal(run(["render"]).status, 0);
  assert.equal(run(["render", "--check"]).status, 0);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const node = graph.nodes.find((n) => n.title === "housekeeping");
  assert.equal(node.type, "Job");
  assert.match(node.body, /- writes \[table:db\/jobs\]/);
  assert.ok(graph.edges.some((e) => e.source === node.id && e.target === "metadata/table/db--jobs" && e.verb === "writes"));
  const l = run(["lint"]);
  assert.equal(l.status, 0, l.stderr);
  assert.match(l.stderr, /WARNING: 2 jobs with no stated mode/);
  assert.match(l.stderr, /job:nightly {2}\(from Procfile; zdd\/metadata\/job\/nightly\.json\)/);
  assert.match(l.stderr, /job:replay/);
  assert.doesNotMatch(l.stderr, /job:housekeeping/);
  // A declared mode silences the warning for that job.
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions.jobs.modes.replay = "worker";
  cfg.extractorOptions.jobs.exclude = ["dev", "nightly"];
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg));
  assert.equal(run(["derive"]).status, 0);
  assert.doesNotMatch(run(["lint"]).stderr, /no stated mode/);
});
