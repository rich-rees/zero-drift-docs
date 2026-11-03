// The map's gaps and the starter library at every update (decision 0049), at
// the file seam: whatever the engine reads, bootstrap writes. `gaps --fine`
// and `--known` write the answers lint accepts and render shows; `--raise`
// waits for every answer; `--check` is what "update ZDD" waits on. `library`
// asks the starter library what fits now, keeps a no, and says in one line
// when it was not asked. And the session-start notice of decision 0048 point
// 7 reads the copies' status, offline only.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STARTERS, RECORD, parseRecord } from "../scripts/lib/starters.mjs";
import { narrate as narrateStarters } from "../scripts/check-starters.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const HOOK = join(PLUGIN, "scripts", "inject-agent-index.mjs");
const CHECK = join(PLUGIN, "scripts", "check-starters.mjs");
const LIBRARY = resolve(PLUGIN, "..", "..", "packages", "zdd-starter-adapters");
const STAGE = join(LIBRARY, "scripts", "stage.mjs");
const ENGINE_BIN = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const SCENARIOS = join(PLUGIN, "test", "fixtures", "scenarios");
const base = { ...process.env, CLAUDE_PROJECT_DIR: "", CODEX_PROJECT_DIR: "" };

const tmp = (t, prefix = "zdd-gaps-") => {
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
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const record = (repo) => parseRecord(readFileSync(join(repo, "zdd", "extractors", RECORD), "utf8"), RECORD);
const git = (repo, ...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
const stageInto = (dir, version) => execFileSync(process.execPath, [STAGE, version, join(dir, version)], { stdio: "ignore" });
const answersFile = (t, a) => {
  const p = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(p, JSON.stringify(a));
  return p;
};

// The young app installed fresh, derived: two pages that reach nothing and
// a table nothing reaches (the scenario's own shape).
function installed(t, answers = {}) {
  const root = tmp(t);
  const repo = join(root, "app");
  cpSync(join(SCENARIOS, "young-app"), repo, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  const r = run(repo, ["apply", `--answers=${answersFile(t, { name: "Shop", ...answers })}`]);
  assert.equal(r.status, 0, r.stderr);
  const d = engine(repo, "derive");
  assert.equal(d.status, 0, d.stderr);
  return repo;
}
const open = (repo) => json(repo, ["gaps"]).open;

test("writer to reader: a fresh install writes gaps.strict, lint holds it, and --fine and --known write the answers lint accepts", (t) => {
  const repo = installed(t);
  assert.deepEqual(config(repo).gaps, { strict: true, fine: [], known: [] });
  const [a, b, c] = open(repo);
  assert.equal(engine(repo, "lint").status, 1);
  const fine = json(repo, ["gaps", `--fine=${a.id},${b.id}`, "--why=the pages read the menu through the API"]);
  assert.deepEqual(fine.fine.map((g) => g.id), [a.id, b.id]);
  assert.deepEqual(config(repo).gaps.fine, [a, b].map((g) => ({ id: g.id, what: g.what, why: "the pages read the menu through the API" })).sort((x, y) => (x.id < y.id ? -1 : 1)));
  assert.equal(engine(repo, "lint").status, 1, "one gap still open");
  json(repo, ["gaps", `--known=${c.id}`, "--why=read by a script no adapter sees"]);
  assert.deepEqual(config(repo).gaps.known, [{ id: c.id, what: c.what, why: "read by a script no adapter sees" }]);
  const l = engine(repo, "lint");
  assert.equal(l.status, 0, l.stderr);
  // Render shows the known gap in both indexes; `--check` holds them to the answer.
  assert.equal(engine(repo, "render").status, 0);
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), new RegExp(`^- table .*nothing reaches it — read by a script no adapter sees$`, "m"));
  assert.match(readFileSync(join(repo, "zdd", "human-index.html"), "utf8"), /id="btn-gaps"[^>]*>Known gaps: 1</);
  assert.equal(engine(repo, "render", "--check").status, 0);
  // Moving an answer: --fine on a known gap takes it out of known.
  json(repo, ["gaps", `--fine=${c.id}`, "--why=fine after all"]);
  assert.deepEqual(config(repo).gaps.known, []);
  assert.equal(engine(repo, "render", "--check").status, 1, "the index no longer matches: render again");
});

test("refusals write nothing: no reason, two answers at once, an id that is no gap's, a gap no record has now", (t) => {
  const repo = installed(t);
  const [a] = open(repo);
  const before = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  for (const [args, re] of [
    [[`--fine=${a.id}`], /--fine needs --why="<reason>": a fine mark says why there is nothing to map/],
    [[`--known=${a.id}`, "--why=  "], /--known needs --why="<reason>": a known gap says why it cannot be mapped/],
    [[`--fine=${a.id}`, `--known=${a.id}`, "--why=x"], /answer with one of --fine, --known at a time/],
    [["--fine=route:/health", "--why=x"], /is not a gap's id/],
    [[`--fine=gap:route/${"0".repeat(16)}`, "--why=x"], /no record has the gap gap:route\/0{16} now/],
    [["--known", "--why=x"], /--known needs at least one item id/],
    [["--forget=gap:route/0000000000000000"], /has no mark for/],
  ]) {
    const r = run(repo, ["gaps", ...args]);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, re, args.join(" "));
  }
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), before);
});

test("an upgraded repo: lint warns, --raise refuses until every gap has an answer, then lint fails on the next one; --check is the update's gate", (t) => {
  const repo = installed(t);
  const c = config(repo);
  delete c.gaps;
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2) + "\n");
  const warn = engine(repo, "lint");
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(warn.stderr, /WARNING: 3 gaps in the map with no answer yet/);
  assert.equal(run(repo, ["gaps", "--check"]).status, 1, "update ZDD does not finish while a gap is open");
  const refused = run(repo, ["gaps", "--raise"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /gaps\.strict stays off: 3 gaps have no answer yet/);
  assert.equal(config(repo).gaps, undefined);
  const ids = open(repo).map((g) => g.id);
  json(repo, ["gaps", `--fine=${ids.join(",")}`, "--why=nothing to map yet"]);
  assert.equal(run(repo, ["gaps", "--check"]).status, 0);
  const raised = json(repo, ["gaps", "--raise"]);
  assert.equal(raised.raised, true);
  assert.equal(config(repo).gaps.strict, true);
  assert.match(run(repo, ["gaps"]).stdout, /gaps\.strict is on/);
  // The next gap: a new page that reaches nothing fails lint now.
  mkdirSync(join(repo, "app", "about"), { recursive: true });
  writeFileSync(join(repo, "app", "about", "page.tsx"), "export default function About() {\n  return null;\n}\n");
  assert.equal(engine(repo, "derive").status, 0);
  const red = engine(repo, "lint");
  assert.equal(red.status, 1);
  assert.match(red.stderr, /surface \/about: reaches nothing \(app\/about\/page\.tsx\) — gaps\.strict: no answer yet/);
});

test("the unread block keeps its own writer's words through the shared one", (t) => {
  const repo = installed(t);
  const r = run(repo, ["unread", `--mark=unread:x/${"0".repeat(16)}`, "--why=x"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no adapter reports unread:x\/0{16} now — run `bootstrap\.mjs unread` for the list/);
  assert.deepEqual(json(repo, ["unread"]).open, []);
});

test("library: what fits now and is not an adapter of the repo's is offered, with the options apply takes; a no is kept, by name or whole", (t) => {
  // The young app installed with only its schema reader.
  const repo = installed(t, { extractors: ["supabase"] });
  const r = json(repo, ["library"]);
  assert.equal(r.skipped, null);
  assert.equal(r.version, STARTERS.version);
  const names = r.offers.map((o) => o.name);
  assert.ok(names.includes("nextjs") && names.includes("supabase-js"), names.join(","));
  assert.ok(!names.includes("supabase"), "an adapter the repo runs is never offered");
  const nextjs = r.offers.find((o) => o.name === "nextjs");
  assert.ok(nextjs.parts.includes("routes") && nextjs.evidence.length);
  assert.match(run(repo, ["library"]).stdout, /a repair `apply` with the answer set's "extractors"/);
  // Taking one: a repair apply naming it copies it, and it is offered no more.
  const take = run(repo, ["apply", `--answers=${answersFile(t, { extractors: ["supabase", "nextjs"], extractorOptions: { supabase: config(repo).extractorOptions.supabase, nextjs: nextjs.options } })}`]);
  assert.equal(take.status, 0, take.stderr);
  assert.ok(record(repo).adapters.nextjs, "copied in");
  assert.ok(!json(repo, ["library"]).offers.some((o) => o.name === "nextjs"));
  // A no to one: kept in the record, not offered again.
  json(repo, ["library", "--decline=supabase-js"]);
  assert.deepEqual(record(repo).declinedOffers, ["supabase-js"]);
  const after = json(repo, ["library"]);
  assert.ok(!after.offers.some((o) => o.name === "supabase-js"));
  assert.deepEqual(after.declinedOffers, ["supabase-js"]);
  // A no to the whole library: one line, and nothing asked.
  json(repo, ["library", "--decline"]);
  assert.equal(record(repo).library, "declined");
  const skipped = run(repo, ["library"]);
  assert.equal(skipped.status, 0);
  assert.equal(skipped.stdout.trim().split("\n").length, 1);
  assert.match(skipped.stdout, /The starter library was declined for this repo \(zdd\/extractors\/starters\.json\), so it was not asked this time\./);
});

test("writer to reader: a no at bootstrap is the library declined, and every update says so in one line", (t) => {
  const repo = installed(t, { starters: false });
  assert.equal(record(repo).library, "declined");
  assert.equal(json(repo, ["library"]).skipped, "declined");
});

test("library unreachable: one line, never a failure", (t) => {
  const repo = installed(t);
  const empty = tmp(t, "zdd-nolib-");
  const r = run(repo, ["library"], { ...base, ZDD_STARTER_ADAPTERS_DIR: empty });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 1);
  assert.match(r.stdout, /could not be reached, so it was not asked this time/);
});

// An app on 0.13 that ran `supabase` from the engine, upgraded: the baseline
// copy, which the pinned library notes fixes for.
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
  assert.equal(record(repo).adapters.supabase.version, STARTERS.baseline);
  return repo;
}

test("writer to reader: the session-start notice reads `starters --json` — the fixes on offer, once; silent after a no, and silent offline", (t) => {
  const repo = upgraded(t);
  const status = json(repo, ["starters"]);
  const lines = narrateStarters(status);
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^ZDD: the starter library ${STARTERS.version.replace(/\./g, "\\.")} notes \\d+ fix(es)? for this repo's copy of supabase \\(decision 0048 point 7\\)\\.`));
  assert.match(lines[0], /`starters --move`.*`starters --decline`/);
  // The hook prints it where the session starts.
  const hook = spawnSync(process.execPath, [HOOK], { encoding: "utf8", input: "", env: { ...base, CLAUDE_PROJECT_DIR: repo, CLAUDECODE: "" } });
  assert.equal(hook.status, 0);
  assert.ok(hook.stdout.includes(lines[0]), hook.stdout);
  // Offline: the library is read from no route but a local one or npm's cache.
  const empty = tmp(t, "zdd-nolib-");
  const quiet = spawnSync(process.execPath, [CHECK, `--root=${repo}`], { encoding: "utf8", env: { ...base, ZDD_STARTER_ADAPTERS_DIR: empty } });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, "");
  // A no: kept, and the notice says nothing more.
  json(repo, ["starters", "--decline"]);
  assert.deepEqual(narrateStarters(json(repo, ["starters"])), []);
  const after = spawnSync(process.execPath, [CHECK, `--root=${repo}`], { encoding: "utf8", env: base });
  assert.equal(after.stdout, "");
});

test("the notice is silent where there is nothing to judge: no config, no copies, every copy at the pin", (t) => {
  assert.deepEqual(narrateStarters(null), []);
  assert.deepEqual(narrateStarters({ version: STARTERS.version, behind: [], offers: [] }), []);
  const lib = tmp(t, "zdd-lib-");
  stageInto(lib, STARTERS.version);
  const repo = installed(t);
  const r = spawnSync(process.execPath, [CHECK, `--root=${repo}`], { encoding: "utf8", env: { ...base, ZDD_STARTER_ADAPTERS_DIR: lib } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "a fresh install takes the pinned version: nothing behind");
});

test("the skills say it: update waits on the gaps and asks the library; bootstrap and upgrade answer them; load relays the notice; the extractor names GAPS", () => {
  const skill = (name) => readFileSync(join(PLUGIN, "skills", name, "SKILL.md"), "utf8");
  const update = skill("update");
  assert.match(update, /this update does not finish while one is open/);
  assert.match(update, /bootstrap\.mjs" gaps --check/);
  assert.match(update, /gaps --fine=<id> --why="…"/);
  assert.match(update, /gaps --known=<id> --why="…"/);
  assert.match(update, /bootstrap\.mjs" library/);
  assert.match(update, /libraries this unit of work added/);
  assert.match(skill("bootstrap"), /gaps --known=<id>/);
  assert.match(skill("upgrade"), /bootstrap\.mjs" gaps --raise/);
  assert.match(skill("load"), /check-starters\.mjs/);
  assert.match(skill("extractor"), /export\s+const GAPS = \{ reachNothing/);
});
