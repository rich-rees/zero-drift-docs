// jobs extractor — background work (CAS-97, decision 0020; the "Background
// work" area of CAS-103 pick 6): scheduled jobs, workers and queues from
// committed run manifests, schedules and source — a Procfile, Railway and
// Compose files, Vercel crons, a Cloudflare worker's triggers, pg_cron in a
// migration, GitHub Actions schedules (opt-in, shown apart), BullMQ queues —
// with the mode never guessed, the module's docstring as the description,
// reads/writes edges from the tables its text names, and a `calls` edge to
// the route or function a schedule hits. A package.json script on its own is
// a hand-run tool, not a job. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseCommand, scanTables, describe, derive, parseCompose, scanPgCron, scanQueues, scanWorkflow } from "../src/extractors/jobs/index.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-jobs");

test("parseCommand: python -m through uv/poetry/pipenv, node/tsx/ts-node files, a package script run by a manager; not a dev server, a test runner, a bare python script or a path that escapes", () => {
  assert.deepEqual(parseCommand("uv run python -m app.housekeeping"), { kind: "python-module", target: "app.housekeeping" });
  assert.deepEqual(parseCommand("poetry run python3 -m worker --once"), { kind: "python-module", target: "worker" });
  assert.deepEqual(parseCommand("python -m app.outbound.worker"), { kind: "python-module", target: "app.outbound.worker" });
  assert.deepEqual(parseCommand("node scripts/nightly.mjs"), { kind: "file", target: "scripts/nightly.mjs" });
  assert.deepEqual(parseCommand("pnpm tsx --env-file=.env src/worker.ts"), { kind: "file", target: "src/worker.ts" });
  assert.deepEqual(parseCommand("pnpm run worker"), { kind: "script", target: "worker" });
  assert.deepEqual(parseCommand("npm run worker"), { kind: "script", target: "worker" });
  assert.deepEqual(parseCommand("yarn worker"), { kind: "script", target: "worker" });
  assert.deepEqual(parseCommand("pnpm worker:video"), { kind: "script", target: "worker:video" });
  assert.equal(parseCommand("npm install"), null);
  assert.equal(parseCommand("pnpm dev"), null, "a dev server by name is not a job");
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

test("the small readers: Compose services with their command and ports, pg_cron schedules with the function they call, queue declarations by library, a workflow's schedule", () => {
  assert.deepEqual(parseCompose('services:\n  web:\n    build: .\n    ports:\n      - "3000:3000"\n  worker:\n    command: ["node", "w.mjs"]\n  api:\n    command: uv run python -m app.api # comment\nvolumes:\n  data: {}\n'), [
    { name: "web", command: null, ports: true },
    { name: "worker", command: "node w.mjs", ports: false },
    { name: "api", command: "uv run python -m app.api", ports: false },
  ]);
  assert.deepEqual(scanPgCron("select cron.schedule('digest', '0 3 * * *', $$select public.send_digest()$$);\nselect cron.schedule('ping', '* * * * *', 'select 1');\n"), [
    { name: "digest", schedule: "0 3 * * *", body: "select public.send_digest()", function: "public.send_digest" },
    { name: "ping", schedule: "* * * * *", body: "select 1", function: null },
  ]);
  assert.deepEqual(scanQueues('new Queue("video"); new Worker("video", fn); inngest.createFunction({ id: "sync-user" }, { event: "user/created" }, h); const t = task({ id: "render-pdf", run }); schedules.task({ id: "daily", cron: "0 1 * * *", run });'), [
    { queue: "video", role: "producer", lib: "bullmq" },
    { queue: "video", role: "consumer", lib: "bullmq" },
    { queue: "sync-user", role: "consumer", lib: "inngest", trigger: "user/created" },
    { queue: "daily", role: "consumer", lib: "trigger.dev", schedule: "0 1 * * *" },
    { queue: "render-pdf", role: "consumer", lib: "trigger.dev" },
  ]);
  assert.deepEqual(scanQueues('const QueueUrl = "https://sqs.eu-west-1.amazonaws.com/123/emails"; await sqs.send(new SendMessageCommand({ QueueUrl }));'), [{ queue: "emails", role: "producer", lib: "sqs" }]);
  assert.deepEqual(scanWorkflow('name: Nightly mutation\non:\n  schedule:\n    - cron: "30 2 * * *"\n'), { crons: ["30 2 * * *"], name: "Nightly mutation" });
});

test("fixture: the background work of a small monorepo — a Railway-scheduled sweep, a Procfile worker run through a package script, a nightly with no stated mode, a Vercel cron calling its route, a Cloudflare worker's trigger, a pg_cron digest calling its function, a Compose worker, a BullMQ queue with its producer and consumer; a hand-run package script and a dev server are not jobs; GitHub Actions only when asked", () => {
  const out = derive({ repoRoot: FIXTURE, options: { modes: { worker: "worker" } }, io: makeExtractorIo(FIXTURE, "jobs") });
  const by = (name) => out.records.find((r) => r.title === name);
  assert.deepEqual(out.records.map((r) => r.id), ["job:edge", "job:housekeeping", "job:nightly", "job:nightly-digest", "job:sweep-stalled", "job:transcoder", "job:video-transcode", "job:worker"]);
  const hk = by("housekeeping");
  assert.equal(hk.facts.mode, "scheduled");
  assert.equal(hk.facts.schedule, "0 * * * *");
  assert.equal(hk.facts.source, "railway");
  assert.deepEqual(hk.resource, ["apps/api/app/housekeeping.py", "apps/api/services/housekeeping/railway.toml"], "the module is resolved from the service folder up to the app root");
  assert.equal(hk.description, "Housekeeping: the sweep that completes a Scheduled job once its deliver-by date has passed, because no outside system reports a delivery.");
  assert.deepEqual(hk.facts.edges, { writes: ["?table:audit_events", "?table:jobs"] });
  const worker = by("worker");
  assert.equal(worker.facts.mode, "worker");
  assert.equal(worker.facts.command, "pnpm run worker", "the Procfile runs the package script; the script's module is the resource");
  assert.deepEqual(worker.resource, ["apps/api/app/outbound/worker.py", "apps/api/Procfile"]);
  assert.deepEqual(worker.facts.edges, { writes: ["?table:outbound_messages"] });
  assert.ok(!by("replay"), "a package script nothing runs is a hand-run tool, not a job");
  const nightly = by("nightly");
  assert.equal(nightly.facts.manifest, "Procfile");
  assert.equal(nightly.facts.mode, "unknown");
  assert.deepEqual(nightly.facts.edges, { reads: ["?table:jobs"], writes: ["?table:reports"] });
  const sweep = by("sweep-stalled");
  assert.deepEqual(sweep.facts, { mode: "scheduled", command: "GET /api/cron/sweep-stalled", schedule: "*/5 * * * *", trigger: "cron", target: "/api/cron/sweep-stalled", source: "vercel", manifest: "apps/web/vercel.json", edges: { calls: ["?route:/api/cron/sweep-stalled"] } });
  assert.deepEqual(sweep.resource, ["apps/web/vercel.json"]);
  const edge = by("edge");
  assert.equal(edge.facts.schedule, "0 */6 * * *");
  assert.equal(edge.facts.source, "cloudflare");
  assert.deepEqual(edge.resource, ["workers/edge/src/index.ts", "workers/edge/wrangler.toml"]);
  assert.equal(edge.description, "The edge worker: refreshes the cached catalogue every six hours.");
  const digest = by("nightly-digest");
  assert.deepEqual(digest.facts.edges, { calls: ["?function:public.send_digest"] });
  assert.equal(digest.facts.trigger, "pg_cron");
  assert.equal(digest.facts.schedule, "0 3 * * *");
  const transcoder = by("transcoder");
  assert.equal(transcoder.facts.mode, "worker", "a Compose service is a long-running process");
  assert.equal(transcoder.facts.source, "compose");
  const queue = by("video-transcode");
  assert.equal(queue.facts.mode, "queue");
  assert.equal(queue.facts.queue, "video-transcode");
  assert.deepEqual(queue.facts.producers, ["apps/web/src/lib/queues.ts"]);
  assert.deepEqual(queue.facts.consumers, ["scripts/transcode.mjs"]);
  assert.deepEqual(queue.resource, ["scripts/transcode.mjs"], "the consumer is the resource");
  assert.deepEqual(queue.facts.edges, { usedBy: ["?at:apps/web/src/lib/queues.ts"] });
  assert.ok(!out.records.some((r) => ["dev", "test", "test:mutation", "missing", "web", "Nightly-mutation"].includes(r.title)));
  assert.ok(!out.diagnostics.some((d) => /declared in .* and again/.test(d)), "the Railway file is one job");
  const withActions = derive({ repoRoot: FIXTURE, options: { modes: { worker: "worker" }, includeGithubActions: true }, io: makeExtractorIo(FIXTURE, "jobs") });
  const nm = withActions.records.find((r) => r.title === "Nightly-mutation");
  assert.deepEqual(nm.facts, { mode: "scheduled", command: "GitHub Actions workflow .github/workflows/nightly.yml", schedule: "30 2 * * *", trigger: "cron", source: "github-actions", housekeeping: true, manifest: ".github/workflows/nightly.yml" });
});

test("config: entries declare a process no manifest names; exclude and modes are honoured; bad shapes are refused", () => {
  const io = () => makeExtractorIo(FIXTURE, "jobs");
  const out = derive({ repoRoot: FIXTURE, options: { exclude: ["nightly", "transcoder"], modes: {}, entries: [{ name: "sweeper", module: "app.housekeeping", cwd: "apps/api", mode: "scheduled", schedule: "0 2 * * *", description: "Declared by hand." }] }, io: io() });
  assert.deepEqual(out.records.map((r) => r.title), ["edge", "housekeeping", "nightly-digest", "sweep-stalled", "sweeper", "video-transcode", "worker"]);
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
  assert.throws(() => derive({ repoRoot: FIXTURE, options: { includeGithubActions: "yes" }, io: io() }), /jobs\.includeGithubActions must be true or false/);
});

test("CLI: derive and render are byte-stable; a cron's calls edge reaches its route and a pg_cron's its function; the agent index gets a Background work section, housekeeping apart; lint names the job with no stated mode", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-jobs-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /8 jobs/);
  const hk = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "job", "housekeeping.json"), "utf8"));
  assert.deepEqual(hk.facts.edges, { writes: ["table:db/audit_events", "table:db/jobs"] });
  const sweep = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "job", "sweep-stalled.json"), "utf8"));
  assert.deepEqual(sweep.facts.edges, { calls: ["route:/api/cron/sweep-stalled"] });
  const digest = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "job", "nightly-digest.json"), "utf8"));
  assert.deepEqual(digest.facts.edges, { calls: ["function:db/public.send_digest"] });
  assert.equal(run(["derive", "--check"]).status, 0);
  assert.equal(run(["render"]).status, 0, run(["render"]).stderr);
  assert.equal(run(["render", "--check"]).status, 0);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const node = graph.nodes.find((n) => n.title === "housekeeping");
  assert.equal(node.type, "Job");
  assert.ok(graph.edges.some((e) => e.source === "metadata/job/sweep-stalled" && e.target === "metadata/route/cron--sweep-stalled" && e.verb === "calls"), JSON.stringify(graph.edges.filter((e) => e.source.startsWith("metadata/job/"))));
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /^## Background work$/m);
  assert.match(index, /^- \[sweep-stalled\]\(metadata\/job\/sweep-stalled\.json\) — cron `\*\/5 \* \* \* \*` → \/api\/cron\/sweep-stalled$/m, index);
  assert.match(index, /^- \[video-transcode\]\(metadata\/job\/video-transcode\.json\) — queue `video-transcode` → scripts\/transcode\.mjs$/m, index);
  assert.match(index, /^- \[nightly-digest\]\(metadata\/job\/nightly-digest\.json\) — cron `0 3 \* \* \*` → public\.send_digest$/m, index);
  assert.doesNotMatch(index, /Repo housekeeping|Nightly-mutation/, "GitHub Actions schedules are off by default");
  const l = run(["lint"]);
  assert.equal(l.status, 0, l.stderr);
  assert.match(l.stderr, /WARNING: 1 jobs? with no stated mode/);
  assert.match(l.stderr, /job:nightly {2}\(from Procfile; zdd\/metadata\/job\/nightly\.json\)/);
  assert.doesNotMatch(l.stderr, /job:housekeeping|job:sweep-stalled|job:video-transcode/);
  // Opt in to the Actions schedules: listed apart as housekeeping.
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractorOptions.jobs.includeGithubActions = true;
  cfg.extractorOptions.jobs.modes.nightly = "scheduled";
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg));
  assert.equal(run(["derive"]).status, 0);
  assert.equal(run(["render"]).status, 0);
  const index2 = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index2, /^## Repo housekeeping$\n\n- \[Nightly-mutation\]\(metadata\/job\/Nightly-mutation\.json\) — cron `30 2 \* \* \*` → \.github\/workflows\/nightly\.yml$/m, index2);
  assert.doesNotMatch(run(["lint"]).stderr, /no stated mode/);
});
