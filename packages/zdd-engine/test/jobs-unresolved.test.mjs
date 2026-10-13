// 2.4.1 (from the first adopter): a Railway `startCommand` naming build output —
// `node apps/upload-worker/dist/server.js`, a Dockerfile build whose dist/ is
// never committed — resolves to no file, and the job was skipped silently
// (visible only under `derive --verbose`). A plain derive now says so, with
// the `jobs.entries` remedy, and never guesses the source file; once the
// remedy is in config the Railway file joins that job and the warning goes.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture-jobs");

const mkRepo = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-jobs-dist-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  mkdirSync(join(repo, "apps", "upload-worker", "src"), { recursive: true });
  writeFileSync(join(repo, "apps", "upload-worker", "railway.toml"), '[deploy]\nstartCommand = "node dist/server.js"\n');
  writeFileSync(join(repo, "apps", "upload-worker", "src", "server.ts"), "// The video worker: transcodes uploads.\nexport {};\n");
  return repo;
};
const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });

test("derive: the fixture's own manifests resolve — no unresolved-command warning", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-jobs-dist-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  const d = run(repo, ["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.doesNotMatch(d.stderr, /not a file in the repo/, d.stderr);
});

test("derive: a start command naming build output WARNS on a plain derive with the jobs.entries remedy, exit 0, and no job is guessed", (t) => {
  const repo = mkRepo(t);
  const d = run(repo, ["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stderr, /WARNING \[jobs\]: apps\/upload-worker\/railway\.toml: 'upload-worker' runs dist\/server\.js, which is not a file in the repo \(build output\?\) — the job is not on the map\./, d.stderr);
  assert.match(d.stderr, /extractorOptions\.jobs\.entries: \{"name": "upload-worker", "file": "<the source file>", "cwd": "apps\/upload-worker", "command": "node dist\/server\.js"\}/, d.stderr);
  assert.throws(() => readFileSync(join(repo, "zdd", "metadata", "job", "upload-worker.json")), "no record is guessed");
});

test("derive: with the entry in config, the Railway file joins that job and the warning goes", (t) => {
  const repo = mkRepo(t);
  const cfgPath = join(repo, "zdd", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.extractorOptions.jobs.entries = [{ name: "upload-worker", file: "src/server.ts", cwd: "apps/upload-worker", command: "node dist/server.js", mode: "worker" }];
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  const d = run(repo, ["derive"]);
  assert.equal(d.status, 0, d.stderr);
  assert.doesNotMatch(d.stderr, /not a file in the repo/, d.stderr);
  const job = JSON.parse(readFileSync(join(repo, "zdd", "metadata", "job", "upload-worker.json"), "utf8"));
  assert.deepEqual(job.resource, ["apps/upload-worker/src/server.ts", "zdd/config.json", "apps/upload-worker/railway.toml"]);
});
