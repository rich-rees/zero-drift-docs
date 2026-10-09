// The jobs extractor after the slice 4–7 review (CAS-103 campaign 3):
// comments are not declarations (CR-506), a workflow's cron lives under
// on.schedule only (CR-507), a target is a regular file (CR-508), a Railway
// file joins the job in its own folder only (CR-509), two Vercel crons that
// end alike keep both names (CR-510), a scheduled queue merged into its
// process keeps its schedule (CR-511). Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { derive, maskComments, scanPgCron, scanQueues, scanWorkflow } from "../src/extractors/jobs/index.mjs";
import { makeExtractorIo } from "../src/lib/extractor-io.mjs";

const scratch = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-jobs-rv-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const jobs = (root, options = {}) => derive({ repoRoot: root, options, io: makeExtractorIo(root, "jobs") });

test("CR-506: maskComments blanks line and block comments and keeps strings, length and line count; the scanners read through it", () => {
  const src = 'const a = "// not a comment"; // new Worker("gone")\n/* new Queue("gone2") */ new Queue("kept"); const s = `x // y`;\n';
  const masked = maskComments(src);
  assert.equal(masked.length, src.length);
  assert.equal(masked.split("\n").length, src.split("\n").length);
  assert.ok(masked.includes('"// not a comment"') && masked.includes("`x // y`"), masked);
  assert.ok(!masked.includes("gone"), masked);
  assert.deepEqual(scanQueues(src), [{ queue: "kept", role: "producer", lib: "bullmq" }]);
  assert.deepEqual(scanQueues("// new Worker('retired')\n/** example: new Queue('docs') */\n"), []);
  assert.deepEqual(scanPgCron("-- select cron.schedule('old', '* * * * *', 'select 1');\n/* cron.schedule('older', '* * * * *', 'select 2'); */\nselect cron.schedule('live', '0 1 * * *', 'select 3');\n"), [
    { name: "live", schedule: "0 1 * * *", body: "select 3", function: null },
  ]);
  assert.equal(maskComments("a = 'it''s' # tail\n", { line: ["#"], block: false }), "a = 'it''s'       \n");
});

test("CR-507: only a cron under the top-level on.schedule is a schedule; a `- cron:` in an input, a matrix or a comment is not", () => {
  const wf = [
    "name: Nightly",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      when:",
    "        default:",
    "          - cron: '1 1 * * *'",
    "  schedule:",
    "    - cron: '30 2 * * *'",
    "    # - cron: '0 0 * * *'",
    "    - cron: \"15 4 * * 1\"",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  x:",
    "    strategy:",
    "      matrix:",
    "        include:",
    "          - cron: '9 9 * * *'",
    "",
  ].join("\n");
  assert.deepEqual(scanWorkflow(wf), { crons: ["30 2 * * *", "15 4 * * 1"], name: "Nightly" });
  assert.deepEqual(scanWorkflow("name: Build\non:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - cron: 'x'\n"), { crons: [], name: "Build" });
  assert.deepEqual(scanWorkflow('name: Q\n"on":\n  schedule:\n    - cron: "5 5 * * *"\n'), { crons: ["5 5 * * *"], name: "Q" });
});

test("CR-508: a command whose target is a folder is not a job (skipped with the diagnostic); a file is", (t) => {
  const root = scratch(t, { Procfile: "worker: node worker.mjs\nreal: node real.mjs\n", "worker.mjs/index.mjs": "export {};\n", "real.mjs": "export {};\n" });
  const out = jobs(root);
  assert.deepEqual(out.records.map((r) => r.id), ["job:real"]);
  assert.ok(out.diagnostics.some((d) => /'worker' runs worker\.mjs, which resolves to no file/.test(d)), out.diagnostics.join("\n"));
});

test("CR-509: a Railway file merges into the job that runs its command from the same folder, never into another app's job with the same command", (t) => {
  const root = scratch(t, {
    "apps/a/Procfile": "a-worker: node worker.mjs\n",
    "apps/a/worker.mjs": "export {};\n",
    "apps/b/Procfile": "b-worker: node worker.mjs\n",
    "apps/b/worker.mjs": "export {};\n",
    "apps/b/railway.toml": '[deploy]\nstartCommand = "node worker.mjs"\ncronSchedule = "0 * * * *"\n',
  });
  const out = jobs(root);
  const a = out.records.find((r) => r.resource[0] === "apps/a/worker.mjs");
  const b = out.records.find((r) => r.resource[0] === "apps/b/worker.mjs");
  assert.ok(a && b, out.records.map((r) => r.id).join());
  assert.equal(a.facts.schedule, undefined, "app a has no Railway file");
  assert.equal(b.facts.schedule, "0 * * * *");
  assert.deepEqual(b.resource, ["apps/b/worker.mjs", "apps/b/Procfile", "apps/b/railway.toml"]);
});

test("CR-510: two Vercel crons whose routes end alike are named by their whole route; one alone keeps its last segment", (t) => {
  const root = scratch(t, {
    "vercel.json": JSON.stringify({ crons: [{ path: "/api/a/run", schedule: "1 * * * *" }, { path: "/api/b/run", schedule: "2 * * * *" }, { path: "/api/sweep", schedule: "3 * * * *" }] }),
  });
  const out = jobs(root);
  assert.deepEqual(out.records.map((r) => r.id).sort(), ["job:api-a-run", "job:api-b-run", "job:sweep"]);
  assert.ok(!out.diagnostics.some((d) => /declared in .* and again/.test(d)), out.diagnostics.join("\n"));
});

test("CR-511: a scheduled task named like the process that consumes it joins that record with its schedule, and the mode is scheduled", (t) => {
  const root = scratch(t, {
    Procfile: "daily: node daily.mjs\n",
    "daily.mjs": 'import { schedules } from "@trigger.dev/sdk"; export const d = schedules.task({ id: "daily", cron: "0 1 * * *", run: async () => {} });\n',
  });
  const out = jobs(root);
  assert.deepEqual(out.records.map((r) => r.id), ["job:daily"]);
  const d = out.records[0];
  assert.equal(d.facts.schedule, "0 1 * * *");
  assert.equal(d.facts.mode, "scheduled");
  assert.equal(d.facts.queue, "daily");
});
