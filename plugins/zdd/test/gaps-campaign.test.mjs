// Slice 6's campaign (CR-354 to CR-369), at the file seam: the session-start
// notice runs no engine and bounds every library route, and a failing check
// never costs the session its agent index; `library --decline` is validated
// whole against what is on offer now; the marks writer's transitions; the
// library's held offer and a detection that cannot run; the record's new keys
// refused when malformed.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STARTERS, RECORD, emptyRecord, parseRecord, npmFetch, starterLibrary } from "../scripts/lib/starters.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const CHECK = join(PLUGIN, "scripts", "check-starters.mjs");
const LIBRARY = resolve(PLUGIN, "..", "..", "packages", "zdd-starter-adapters");
const STAGE = join(LIBRARY, "scripts", "stage.mjs");
const ENGINE_BIN = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const SCENARIOS = join(PLUGIN, "test", "fixtures", "scenarios");
const base = { ...process.env, CLAUDE_PROJECT_DIR: "", CODEX_PROJECT_DIR: "" };

const tmp = (t, prefix = "zdd-gapsc-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (repo, args, env = base) => spawnSync(process.execPath, [SCRIPT, ...args, `--root=${repo}`, `--home=${join(repo, "..", "home")}`], { encoding: "utf8", env });
const json = (repo, args, env) => {
  const r = run(repo, [...args, "--json"], env);
  assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}${r.stdout}`);
  return JSON.parse(r.stdout);
};
const engine = (repo, ...args) => spawnSync(process.execPath, [ENGINE_BIN, ...args, `--root=${repo}`], { encoding: "utf8" });
const configText = (repo) => readFileSync(join(repo, "zdd", "config.json"), "utf8");
const config = (repo) => JSON.parse(configText(repo));
const recordText = (repo) => readFileSync(join(repo, "zdd", "extractors", RECORD), "utf8");
const git = (repo, ...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
const stageInto = (dir, version) => execFileSync(process.execPath, [STAGE, version, join(dir, version)], { stdio: "ignore" });
const answersFile = (t, a) => {
  const p = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(p, JSON.stringify(a));
  return p;
};
function installed(t, answers = {}) {
  const root = tmp(t);
  const repo = join(root, "app");
  cpSync(join(SCENARIOS, "young-app"), repo, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  const r = run(repo, ["apply", `--answers=${answersFile(t, { name: "Shop", ...answers })}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(engine(repo, "derive").status, 0);
  return repo;
}
// An app on 0.13 upgraded: the baseline copy, which the pinned library notes fixes for.
function upgraded(t) {
  const root = tmp(t);
  const repo = join(root, "app");
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "0001_init.sql"), "create table public.job_templates (id uuid primary key, name text);\n");
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ name: "app", release: "0.13.0", extractors: ["supabase"], extractorOptions: { supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } }, suiteChecks: 5 }, null, 2) + "\n");
  git(repo, "init", "-q");
  json(repo, ["upgrade"]);
  return repo;
}

test("CR-354: the notice runs no engine — with an engine that cannot run, it still says its one line, and the status's `changed` is empty", (t) => {
  const repo = upgraded(t);
  const dead = join(tmp(t, "zdd-dead-"), "engine.mjs");
  const marker = `${dead}.ran`;
  writeFileSync(dead, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nprocess.exit(1);\n`);
  const r = spawnSync(process.execPath, [CHECK, `--root=${repo}`], { encoding: "utf8", env: { ...base, ZDD_ENGINE_BIN: dead } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^ZDD: the starter library .* notes \d+ fix(es)? for this repo's copy of supabase/);
  assert.equal(existsSync(marker), false, "no engine ran at session start");
  const s = JSON.parse(spawnSync(process.execPath, [CHECK, `--root=${repo}`, "--json"], { encoding: "utf8", env: { ...base, ZDD_ENGINE_BIN: dead } }).stdout);
  assert.deepEqual(s.copies.map((c) => c.changed), [[]]);
});

test("CR-354, CR-366: the quick route asks npm for its cache only, with a 15 s bound; the ordinary fetch keeps the network and its own bound", (t) => {
  const calls = [];
  const exec = (cmd, args, opts) => calls.push({ args, timeout: opts.timeout });
  npmFetch(STARTERS.version, { exec, out: tmp(t), platform: "linux" });
  npmFetch(STARTERS.version, { exec, out: tmp(t), platform: "linux", offline: true });
  assert.equal(calls[0].args.includes("--offline"), false);
  assert.equal(calls[0].timeout, 300_000);
  assert.ok(calls[1].args.includes("--offline"));
  assert.equal(calls[1].timeout, 15_000);
  // starterLibrary's quick mode reaches the fetch with offline, past a missing sibling.
  const lib = tmp(t, "zdd-lib-");
  stageInto(lib, STARTERS.version);
  const seen = [];
  const got = starterLibrary(STARTERS.version, { env: {}, sibling: join(lib, "no-sibling"), quick: true, fetch: (v, o) => (seen.push(o), join(lib, v)) });
  assert.equal(got.version, STARTERS.version);
  assert.deepEqual(seen, [{ offline: true }]);
});

test("CR-367: a session-start check that throws on import never costs the session its agent index", (t) => {
  const repo = installed(t);
  assert.equal(engine(repo, "render").status, 0);
  const copy = join(tmp(t, "zdd-plugin-"), "zdd");
  cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !/[\\/]test([\\/]|$)/.test(src.slice(PLUGIN.length)) });
  writeFileSync(join(copy, "scripts", "check-starters.mjs"), 'throw new Error("planted at import");\n');
  const r = spawnSync(process.execPath, [join(copy, "scripts", "inject-agent-index.mjs")], { encoding: "utf8", input: "", env: { ...base, CLAUDE_PROJECT_DIR: repo, CLAUDECODE: "" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /<zdd-agent-index>\n[\s\S]*\n<\/zdd-agent-index>\n/);
  assert.doesNotMatch(r.stdout + r.stderr, /planted/);
});

test("CR-357: `library --decline=<names>` is validated whole against what is on offer now; a refusal writes nothing", (t) => {
  const repo = installed(t, { extractors: ["supabase"] });
  const before = recordText(repo);
  for (const [arg, re] of [
    ["--decline=nextjs,NextJS", /'NextJS' is not a starter's name — nothing was written/],
    [`--decline=${"a".repeat(65)}`, /is not a starter's name/],
    ["--decline=supabse-js", /supabse-js is not on offer now \(.*nextjs.*\) — nothing was written/],
    ["--decline=supabase", /supabase is not on offer now/],
  ]) {
    const r = run(repo, ["library", arg]);
    assert.equal(r.status, 1, arg);
    assert.match(r.stderr, re, arg);
  }
  assert.equal(recordText(repo), before);
  const off = run(repo, ["library", "--decline=nextjs"], { ...base, ZDD_STARTER_ADAPTERS_DIR: tmp(t, "zdd-nolib-") });
  assert.equal(off.status, 1);
  assert.match(off.stderr, /could not be reached.*declined by name only when it is on offer; `library --decline` alone declines the whole library/);
  assert.equal(recordText(repo), before);
  json(repo, ["library", "--decline=nextjs"]);
  assert.deepEqual(JSON.parse(recordText(repo)).declinedOffers, ["nextjs"]);
});

test("CR-363: the writer's transitions — known to fine moves the answer whole, --forget removes a live and a stale mark, --check writes nothing", (t) => {
  const repo = installed(t);
  const [a, b, c] = json(repo, ["gaps"]).open;
  json(repo, ["gaps", `--fine=${a.id},${b.id}`, "--why=nothing to map"]);
  json(repo, ["gaps", `--known=${c.id}`, "--why=cannot be mapped"]);
  json(repo, ["gaps", `--fine=${c.id}`, "--why=fine after all"]);
  const g = config(repo).gaps;
  assert.deepEqual(g.known, []);
  assert.deepEqual(g.fine.find((m) => m.id === c.id), { id: c.id, what: c.what, why: "fine after all" });
  assert.equal(engine(repo, "lint").status, 0, "strict, and every gap still answered");
  // --check, passing and failing, writes nothing.
  const pass = configText(repo);
  assert.equal(run(repo, ["gaps", "--check"]).status, 0);
  assert.equal(configText(repo), pass);
  json(repo, ["gaps", `--forget=${a.id}`]);
  assert.ok(!config(repo).gaps.fine.some((m) => m.id === a.id), "a live mark removed");
  const fail = configText(repo);
  assert.equal(run(repo, ["gaps", "--check"]).status, 1);
  assert.equal(configText(repo), fail);
  // A stale one: no gap answers it, and --forget takes it away.
  const stale = `gap:route/${"0".repeat(16)}`;
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ ...config(repo), gaps: { ...config(repo).gaps, known: [{ id: stale, why: "was" }] } }, null, 2) + "\n");
  assert.deepEqual(json(repo, ["gaps"]).stale, [stale]);
  json(repo, ["gaps", `--forget=${stale}`]);
  assert.deepEqual(config(repo).gaps.known, []);
});

test("CR-365: a fitting starter held in the folder but not listed is offered as held, and taking it keeps the repo's own files", (t) => {
  const repo = installed(t, { extractors: ["supabase"] });
  const lib = starterLibrary(STARTERS.version);
  cpSync(join(lib.adapters, "nextjs"), join(repo, "zdd", "extractors", "nextjs"), { recursive: true });
  const own = join(repo, "zdd", "extractors", "nextjs", "index.mjs");
  writeFileSync(own, `${readFileSync(own, "utf8")}\n// the repo's own line\n`);
  const offer = json(repo, ["library"]).offers.find((o) => o.name === "nextjs");
  assert.equal(offer.held, true);
  assert.match(run(repo, ["library"]).stdout, /nextjs .*already in zdd\/extractors\/, not listed in "extractors"/);
  const take = run(repo, ["apply", `--answers=${answersFile(t, { extractors: ["supabase", "nextjs"], extractorOptions: { supabase: config(repo).extractorOptions.supabase, nextjs: offer.options } })}`]);
  assert.equal(take.status, 0, take.stderr);
  assert.match(readFileSync(own, "utf8"), /the repo's own line/);
});

test("CR-365: a library whose detection cannot run is one skipped line, never a failure", (t) => {
  const repo = installed(t);
  const lib = tmp(t, "zdd-lib-");
  stageInto(lib, STARTERS.version);
  writeFileSync(join(lib, STARTERS.version, "adapters", "nextjs", "index.mjs"), 'throw new Error("a broken starter");\n');
  const r = run(repo, ["library"], { ...base, ZDD_STARTER_ADAPTERS_DIR: lib });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 1);
  assert.match(r.stdout, /The starter library was reached, but detection could not run, so it was not asked this time/);
  assert.equal(json(repo, ["library"], { ...base, ZDD_STARTER_ADAPTERS_DIR: lib }).skipped, "detection");
});

test("CR-369: the record's new keys are refused when malformed", () => {
  const rec = (extra) => JSON.stringify({ ...emptyRecord(), ...extra });
  assert.equal(parseRecord(rec({ library: "declined", declinedOffers: ["nextjs"] }), "r").library, "declined");
  for (const [extra, re] of [
    [{ library: "yes" }, /library must be "declined"/],
    [{ declinedOffers: "nextjs" }, /declinedOffers must list/],
    [{ declinedOffers: ["Next JS"] }, /declinedOffers must list/],
    [{ declinedOffers: ["a".repeat(65)] }, /declinedOffers must list/],
    [{ declinedOffers: Array.from({ length: 501 }, (_, i) => `a${i}`) }, /declinedOffers must list at most 500/],
  ]) assert.throws(() => parseRecord(rec(extra), "r"), re, JSON.stringify(extra).slice(0, 40));
});
