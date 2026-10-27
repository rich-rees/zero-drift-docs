// The core's background-task merge (decision 0038, ZDD-3 slice 3): one task
// seen by two readers is one record — the same code file, or the same
// command from the same folder — named by a process before a queue or a
// schedule in its code, and either before a deployment record; an
// unresolved task alone is a warning, joined it is a diagnostic; two tasks
// left with one name keep the first. Also the queue readers no fixture
// covers, and the retired `jobs` name. Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mergeBackgroundTasks } from "../src/core/lib/background-tasks.mjs";
import { runReaders } from "./background-run.mjs";

const BIN = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "bin", "zdd-engine.mjs");
const task = (name, extra = {}) => ({
  kind: "background-task",
  id: `background-task:${name}`,
  title: name,
  description: extra.description ?? "",
  resource: extra.resource ?? [],
  refs: extra.refs ?? [],
  facts: { mode: "unknown", command: "x", source: "s", reader: extra.reader ?? "background-x", manifest: extra.manifest ?? "m", ...(extra.facts ?? {}) },
  filename: `${name}.json`,
  ...(extra.runs ? { runs: extra.runs } : {}),
  ...(extra.processKeys ? { processKeys: extra.processKeys } : {}),
  ...(extra.deploys ? { deploys: true } : {}),
  ...(extra.unresolved ? { unresolved: extra.unresolved } : {}),
});
const scratch = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-bgm-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

test("the same code file: one record, named by the process, the deployment record joining with its schedule and file; the transient keys are never written", () => {
  const deploy = task("svc", { runs: "app/w.py", deploys: true, resource: ["app/w.py", "railway.toml"], manifest: "railway.toml", facts: { mode: "scheduled", schedule: "0 * * * *" } });
  const proc = task("worker", { runs: "app/w.py", processKeys: ["app\u0000python -m w"], resource: ["app/w.py", "Procfile"], manifest: "Procfile", refs: ["?code:app/w.py#*"], facts: { edges: { reads: ["?code:app/w.py#*"] } } });
  const { records, diagnostics } = mergeBackgroundTasks([deploy, proc]);
  assert.deepEqual(diagnostics, []);
  assert.equal(records.length, 1);
  const [r] = records;
  assert.equal(r.id, "background-task:worker", "the process names the task, whatever order the readers ran in");
  assert.deepEqual(r.resource, ["app/w.py", "Procfile", "railway.toml"]);
  assert.equal(r.facts.schedule, "0 * * * *");
  assert.equal(r.facts.mode, "scheduled", "a schedule from any member settles the mode");
  for (const k of ["runs", "processKeys", "deploys", "unresolved"]) assert.ok(!(k in r), k);
});

test("the same command from the same folder joins a task whose code is build output; alone, an unresolved task is its reader's warning; joined, a diagnostic", () => {
  const unresolved = task("video", { processKeys: ["apps/v\u0000node dist/server.js"], deploys: true, resource: ["apps/v/railway.toml"], manifest: "apps/v/railway.toml", reader: "background-railway", unresolved: "'video' runs dist/server.js, which is not a file in the repo" });
  const declared = task("video", { runs: "apps/v/src/server.ts", processKeys: ["apps/v\u0000node dist/server.js"], resource: ["apps/v/src/server.ts", "zdd/config.json"], manifest: "zdd/config.json", facts: { mode: "worker" } });
  const joined = mergeBackgroundTasks([unresolved, declared]);
  assert.equal(joined.records.length, 1);
  assert.deepEqual(joined.records[0].resource, ["apps/v/src/server.ts", "zdd/config.json", "apps/v/railway.toml"]);
  assert.deepEqual(joined.warnings, []);
  assert.match(joined.diagnostics.join("\n"), /'video' runs no file in the repo — joined to background-task:video/);
  const alone = mergeBackgroundTasks([task("video", { ...unresolved, processKeys: unresolved.processKeys, deploys: true, unresolved: unresolved.unresolved, reader: "background-railway" })]);
  assert.deepEqual(alone.records, []);
  assert.deepEqual(alone.warnings, ["WARNING [background-railway]: 'video' runs dist/server.js, which is not a file in the repo"]);
});

test("a queue in a process's code joins it with the queue's facts; two different tasks with one name keep the first and say so; a task with no shared key stays alone", () => {
  const proc = task("transcoder", { runs: "t.mjs", processKeys: [".\u0000node t.mjs"], resource: ["t.mjs", "compose.yml"], facts: { mode: "worker" } });
  const queue = task("video", { runs: "t.mjs", resource: ["t.mjs"], refs: ["?at:p.ts"], facts: { mode: "queue", queue: "video", trigger: "queue", producers: ["p.ts"], consumers: ["t.mjs"], edges: { usedBy: ["?at:p.ts"] } } });
  const a = task("sweep", { runs: "a.py", manifest: "a/Procfile" });
  const b = task("sweep", { runs: "b.py", manifest: "b/Procfile" });
  const cron = task("cron", { resource: ["vercel.json"] });
  const { records, diagnostics } = mergeBackgroundTasks([queue, proc, a, b, cron]);
  assert.deepEqual(records.map((r) => r.id), ["background-task:transcoder", "background-task:sweep", "background-task:cron"]);
  const t = records[0];
  assert.equal(t.facts.mode, "worker", "the process's own stated mode");
  assert.equal(t.facts.queue, "video");
  assert.deepEqual(t.facts.producers, ["p.ts"]);
  assert.deepEqual(t.facts.edges, { usedBy: ["?at:p.ts"] });
  assert.equal(records[1].facts.manifest, "a/Procfile");
  assert.match(diagnostics.join("\n"), /background task 'sweep' is declared in a\/Procfile and again in b\/Procfile — the second is skipped/);
});

test("the queue readers: Inngest, Trigger.dev and SQS each read only their own library; a scheduled Trigger.dev task is scheduled", (t) => {
  const root = scratch(t, {
    "src/inngest.ts": 'export const f = inngest.createFunction({ id: "sync-user" }, { event: "user/created" }, h);\n',
    "src/trigger.ts": 'export const d = schedules.task({ id: "daily", cron: "0 1 * * *", run });\nexport const r = task({ id: "render-pdf", run });\n',
    "src/sqs.ts": 'const QueueUrl = "https://sqs.eu-west-1.amazonaws.com/1/emails"; await sqs.send(new ReceiveMessageCommand({ QueueUrl }));\n',
  });
  const only = (reader) => runReaders(root, {}, [reader]).records.map((r) => [r.title, r.facts.mode, r.facts.source]);
  assert.deepEqual(only("background-inngest"), [["sync-user", "queue", "inngest"]]);
  assert.deepEqual(only("background-trigger-dev"), [["daily", "scheduled", "trigger.dev"], ["render-pdf", "queue", "trigger.dev"]]);
  assert.deepEqual(only("background-sqs"), [["emails", "queue", "sqs"]]);
  assert.deepEqual(only("background-bullmq"), []);
});

test("`jobs` is a retired name: a config that still lists it stops derive and names the readers to list instead", (t) => {
  const root = scratch(t, { "zdd/config.json": JSON.stringify({ extractors: ["jobs"], render: { storeChanges: false } }) });
  const r = spawnSync(process.execPath, [BIN, "derive"], { cwd: root, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Extractor 'jobs' was retired: background work is read by one adapter per platform file since 0\.9 \(decision 0038\).*background-procfile.*background-declared/);
});
