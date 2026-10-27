// The background-* readers — background work (2.1.0, decisions 0020 and
// 0038; the "Background work" area of 2.3.0, pick 6): scheduled tasks,
// workers and queues from committed run manifests, schedules and source, one
// reader per convention — a Procfile, Railway and Compose files, Vercel
// crons, a Cloudflare worker's triggers, pg_cron in a migration, GitHub
// Actions schedules (opt-in by listing the reader, shown apart), BullMQ
// queues — merged by the core when two readers see one task (the same code,
// or the same command from the same folder), with the mode never guessed, the module's docstring as the description,
// the module's code named for the data-access adapters (`?code:<file>#*`,
// decision 0037; they give the reads/writes edges), and a `calls` edge to
// the route or function a schedule hits. A package.json script on its own is
// a hand-run tool, not background work. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseCommand, describe, parseCompose, scanPgCron, scanQueues, scanWorkflow } from "../src/adapters/background/shared.mjs";
import { runReaders } from "./background-run.mjs";

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
  assert.deepEqual(parseCommand("pnpm --filter api run worker:emails"), { kind: "script", target: "worker:emails", package: "api" });
  assert.deepEqual(parseCommand("yarn workspace api run worker"), { kind: "script", target: "worker", package: "api" });
  assert.equal(parseCommand("npm install"), null);
  assert.equal(parseCommand("pnpm dev"), null, "a dev server by name is not background work");
  assert.equal(parseCommand("uv run fastapi dev app/main.py"), null);
  assert.equal(parseCommand("uv run pytest"), null);
  assert.equal(parseCommand("python app/script.py"), null, "a bare script is not a module run");
  assert.equal(parseCommand("node ../outside.mjs"), null);
  assert.equal(parseCommand(42), null);
});

test("describe: a Python module's docstring paragraph, a JS module's leading comment", () => {
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

test("fixture: the background work of a small monorepo — a Railway-scheduled sweep, a Procfile worker run through a package script, a nightly with no stated mode, a Vercel cron calling its route, a Cloudflare worker's trigger, a pg_cron digest calling its function, a Compose worker that consumes a BullMQ queue (one task: the same code); a hand-run package script and a dev server are not background work; GitHub Actions only when its reader is listed", () => {
  const out = runReaders(FIXTURE, { "background-procfile": { modes: { worker: "worker" } } });
  const by = (name) => out.records.find((r) => r.title === name);
  assert.deepEqual(out.records.map((r) => r.id), ["background-task:edge", "background-task:housekeeping", "background-task:nightly", "background-task:nightly-digest", "background-task:sweep-stalled", "background-task:transcoder", "background-task:worker"]);
  const hk = by("housekeeping");
  assert.equal(hk.facts.mode, "scheduled");
  assert.equal(hk.facts.schedule, "0 * * * *");
  assert.equal(hk.facts.source, "railway");
  assert.deepEqual(hk.resource, ["apps/api/app/housekeeping.py", "apps/api/services/housekeeping/railway.toml"], "the module is resolved from the service folder up to the app root");
  assert.equal(hk.description, "Housekeeping: the sweep that completes a Scheduled job once its deliver-by date has passed, because no outside system reports a delivery.");
  assert.deepEqual(hk.facts.edges, { reads: ["?code:apps/api/app/housekeeping.py#*"] }, "its module's code, for the data-access adapters");
  const worker = by("worker");
  assert.equal(worker.facts.mode, "worker");
  assert.equal(worker.facts.command, "pnpm run worker", "the Procfile runs the package script; the script's module is the resource");
  assert.deepEqual(worker.resource, ["apps/api/app/outbound/worker.py", "apps/api/Procfile"]);
  assert.deepEqual(worker.facts.edges, { reads: ["?code:apps/api/app/outbound/worker.py#*"] });
  assert.ok(!by("replay"), "a package script nothing runs is a hand-run tool, not background work");
  const nightly = by("nightly");
  assert.equal(nightly.facts.manifest, "Procfile");
  assert.equal(nightly.facts.mode, "unknown");
  assert.deepEqual(nightly.facts.edges, { reads: ["?code:scripts/nightly.mjs#*"] });
  const sweep = by("sweep-stalled");
  assert.deepEqual(sweep.facts, { mode: "scheduled", command: "GET /api/cron/sweep-stalled", schedule: "*/5 * * * *", trigger: "cron", target: "/api/cron/sweep-stalled", source: "vercel", reader: "background-vercel", manifest: "apps/web/vercel.json", edges: { calls: ["?route:/api/cron/sweep-stalled"] } });
  assert.deepEqual(sweep.resource, ["apps/web/vercel.json"]);
  const edge = by("edge");
  assert.equal(edge.facts.schedule, "0 */6 * * *");
  assert.equal(edge.facts.source, "cloudflare");
  assert.deepEqual(edge.resource, ["workers/edge/src/index.ts", "workers/edge/wrangler.toml"]);
  assert.equal(edge.description, "The edge worker: refreshes the cached catalogue every six hours.");
  const digest = by("nightly-digest");
  assert.deepEqual(digest.facts.edges, { calls: ["?function:public.send_digest"] });
  assert.equal(digest.facts.trigger, "pg_cron");
  assert.equal(digest.facts.source, "pg_cron", "the mechanism, not the host (decision 0038)");
  assert.equal(digest.facts.schedule, "0 3 * * *");
  // The Compose service runs scripts/transcode.mjs, which consumes the BullMQ
  // queue: one task, named by the process, with the queue's facts (decision 0038).
  const transcoder = by("transcoder");
  assert.equal(transcoder.facts.mode, "worker", "a Compose service is a long-running process");
  assert.equal(transcoder.facts.source, "compose");
  assert.equal(transcoder.facts.queue, "video-transcode");
  assert.equal(transcoder.facts.trigger, "queue");
  assert.deepEqual(transcoder.facts.producers, ["apps/web/src/lib/queues.ts"]);
  assert.deepEqual(transcoder.facts.consumers, ["scripts/transcode.mjs"]);
  assert.deepEqual(transcoder.resource, ["scripts/transcode.mjs", "docker-compose.yml"]);
  assert.deepEqual(transcoder.facts.edges, { reads: ["?code:scripts/transcode.mjs#*"], usedBy: ["?at:apps/web/src/lib/queues.ts"] });
  assert.ok(!by("video-transcode"), "the queue is the Compose worker's, not a second task");
  assert.ok(!out.records.some((r) => ["dev", "test", "test:mutation", "missing", "web", "Nightly-mutation"].includes(r.title)));
  assert.ok(!out.diagnostics.some((d) => /declared in .* and again/.test(d)), "the Railway file is one task");
  const withActions = runReaders(FIXTURE, {}, ["background-github-actions"]);
  const nm = withActions.records.find((r) => r.title === "Nightly-mutation");
  assert.deepEqual(nm.facts, { mode: "scheduled", command: "GitHub Actions workflow .github/workflows/nightly.yml", schedule: "30 2 * * *", trigger: "cron", source: "github-actions", reader: "background-github-actions", housekeeping: true, manifest: ".github/workflows/nightly.yml" });
});

test("background-declared: an entry declares a task by hand; one that runs a reader's code is that task; each reader's exclude and modes are its own; bad shapes are refused by the reader that owns them", () => {
  const opts = {
    "background-procfile": { exclude: ["nightly"], modes: {} },
    "background-compose": { exclude: ["transcoder"] },
    "background-declared": { entries: [{ name: "sweeper", module: "app.housekeeping", cwd: "apps/api", mode: "scheduled", schedule: "0 2 * * *", description: "Declared by hand." }, { name: "replayer", module: "app.outbound.replay", cwd: "apps/api", mode: "worker" }] },
  };
  const out = runReaders(FIXTURE, opts);
  // sweeper runs housekeeping.py, the code the Railway service runs: one task,
  // named by the declaration; the Railway file adds itself to its resources.
  assert.deepEqual(out.records.map((r) => r.title), ["edge", "nightly-digest", "replayer", "sweep-stalled", "sweeper", "video-transcode", "worker"]);
  const sweeper = out.records.find((r) => r.title === "sweeper");
  assert.equal(sweeper.description, "Declared by hand.");
  assert.equal(sweeper.facts.mode, "scheduled");
  assert.equal(sweeper.facts.schedule, "0 2 * * *", "the declaration's own schedule wins");
  assert.equal(sweeper.facts.manifest, "zdd/config.json");
  assert.equal(sweeper.facts.command, "python -m app.housekeeping");
  assert.deepEqual(sweeper.resource, ["apps/api/app/housekeeping.py", "zdd/config.json", "apps/api/services/housekeeping/railway.toml"], "resolved under the entry's cwd; the Railway file joins");
  assert.equal(out.records.find((r) => r.title === "worker").facts.mode, "unknown", "modes is the reader's own: emptied here");
  assert.equal(out.records.find((r) => r.title === "video-transcode").facts.mode, "queue", "with the Compose worker excluded, the queue stands alone");
  assert.throws(() => runReaders(FIXTURE, { "background-procfile": { modes: { worker: "cron" } } }), /background-procfile\.modes\.worker must be "worker" or "scheduled"/);
  assert.throws(() => runReaders(FIXTURE, { "background-declared": { entries: [{ name: "x" }] } }), /background-declared\.entries\[0\] must be/);
  assert.throws(() => runReaders(FIXTURE, { "background-compose": { exclude: "dev" } }), /background-compose\.exclude must be an array/);
});

test("CLI: derive and render are byte-stable; a cron's calls edge reaches its route and a pg_cron's its function; the agent index gets a Background work section, housekeeping apart; lint names the task with no stated mode and the reader's option to set (CR-010)", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-jobs-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
  const d = run(["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /7 background-tasks/);
  const hk = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "background-task", "housekeeping.json"), "utf8"));
  // sqlalchemy reads the sweep's SQL: it reads jobs, and writes jobs and audit_events.
  assert.deepEqual(hk.facts.edges, { reads: ["table:db/jobs"], writes: ["table:db/audit_events", "table:db/jobs"] });
  // The Python worker: supabase-py's `.table()` read, sqlalchemy's `delete from` write (CR-067).
  const worker = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "background-task", "worker.json"), "utf8"));
  assert.deepEqual(worker.facts.edges, { reads: ["table:db/outbound_messages"], writes: ["table:db/outbound_messages"] });
  // The JS nightly: supabase-js's `.from("jobs")` read. Its raw `insert into reports`
  // in a `db.query()` string is no longer read (decision 0037, slice 2b: no JS raw-SQL adapter yet).
  const nightly = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "background-task", "nightly.json"), "utf8"));
  assert.deepEqual(nightly.facts.edges, { reads: ["table:db/jobs"] });
  const sweep = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "background-task", "sweep-stalled.json"), "utf8"));
  assert.deepEqual(sweep.facts.edges, { calls: ["route:/api/cron/sweep-stalled"] });
  const digest = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "background-task", "nightly-digest.json"), "utf8"));
  assert.deepEqual(digest.facts.edges, { calls: ["function:db/public.send_digest"] });
  assert.equal(run(["derive", "--check"]).status, 0);
  assert.equal(run(["render"]).status, 0, run(["render"]).stderr);
  assert.equal(run(["render", "--check"]).status, 0);
  const graph = JSON.parse(readFileSync(join(repo, "zdd", "graph.json"), "utf8"));
  const node = graph.nodes.find((n) => n.title === "housekeeping");
  assert.equal(node.type, "Background Task");
  assert.ok(readFileSync(join(repo, "zdd", "human-index.html"), "utf8").includes('"API & Background Tasks"'), "the viewer's lane heading names the kind (CR-090)");
  assert.ok(graph.edges.some((e) => e.source === "metadata/background-task/sweep-stalled" && e.target === "metadata/route/cron--sweep-stalled" && e.verb === "calls"), JSON.stringify(graph.edges.filter((e) => e.source.startsWith("metadata/background-task/"))));
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /^## Background work$/m);
  assert.match(index, /^- \[sweep-stalled\]\(metadata\/background-task\/sweep-stalled\.json\) — cron `\*\/5 \* \* \* \*` → \/api\/cron\/sweep-stalled$/m, index);
  assert.match(index, /^- \[transcoder\]\(metadata\/background-task\/transcoder\.json\) — queue `video-transcode` → scripts\/transcode\.mjs$/m, index);
  assert.match(index, /^- \[nightly-digest\]\(metadata\/background-task\/nightly-digest\.json\) — cron `0 3 \* \* \*` → public\.send_digest$/m, index);
  assert.doesNotMatch(index, /Repo housekeeping|Nightly-mutation/, "GitHub Actions schedules are off by default");
  const l = run(["lint"]);
  assert.equal(l.status, 0, l.stderr);
  assert.match(l.stderr, /WARNING: 1 background task with no stated mode/);
  // CR-010: the line names the option on the reader that read the task.
  assert.match(l.stderr, /background-task:nightly {2}\(from Procfile; zdd\/metadata\/background-task\/nightly\.json\) — set extractorOptions\["background-procfile"\]\.modes\["nightly"\]/);
  assert.doesNotMatch(l.stderr, /background-task:housekeeping|background-task:sweep-stalled|background-task:transcoder/);
  // Opt in to the Actions schedules by listing the reader: listed apart as housekeeping.
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  cfg.extractors.push("background-github-actions");
  cfg.extractorOptions["background-procfile"].modes.nightly = "scheduled";
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(cfg));
  assert.equal(run(["derive"]).status, 0);
  assert.equal(run(["render"]).status, 0);
  const index2 = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index2, /^## Repo housekeeping$\n\n- \[Nightly-mutation\]\(metadata\/background-task\/Nightly-mutation\.json\) — cron `30 2 \* \* \*` → \.github\/workflows\/nightly\.yml$/m, index2);
  assert.doesNotMatch(run(["lint"]).stderr, /no stated mode/);
});
