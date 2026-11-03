// What the adapters could not read (decision 0048 point 5), at the file seam:
// whatever the engine reads, bootstrap writes. A fresh install writes
// `unread.strict` and lint enforces it; `unread --mark` writes the mark lint
// accepts and render shows; `--raise` waits for every answer; an upgrade never
// turns CI red by surprise.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { copyFixture, ensureStarters } from "../../../packages/zdd-starter-adapters/test/starters.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "scripts", "bootstrap.mjs");
const ENGINE = resolve(HERE, "..", "..", "..", "packages", "zdd-engine");
const STARTERS = resolve(HERE, "..", "..", "..", "packages", "zdd-starter-adapters");
const BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const env = { ...process.env, ZDD_ENGINE_BIN: BIN, CLAUDE_PROJECT_DIR: "", CODEX_PROJECT_DIR: "" };

const tmp = (t, prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const run = (repo, args) => spawnSync(process.execPath, [SCRIPT, ...args, `--root=${repo}`], { encoding: "utf8", env });
const engine = (repo, ...args) => (ensureStarters(repo), spawnSync)(process.execPath, [BIN, ...args, `--root=${repo}`], { encoding: "utf8" });
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const writeConfig = (repo, c) => writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2) + "\n");

// The fastapi fixture adopted by a real install, with one statement its
// schema adapter cannot read.
function adopted(t, { statement = "DROP SCHEMA mine ON things;" } = {}) {
  const repo = tmp(t, "zdd-unread-plugin-");
  copyFixture(join(STARTERS, "test", "fixture-fastapi"), repo);
  rmSync(join(repo, "zdd"), { recursive: true });
  const answers = join(tmp(t, "zdd-ans-"), "a.json");
  writeFileSync(answers, JSON.stringify({ name: "Unread" }));
  const r = run(repo, ["apply", `--answers=${answers}`]);
  assert.equal(r.status, 0, r.stderr);
  const dir = config(repo).extractorOptions.supabase.migrationNamespaces[0].dir;
  if (statement) writeFileSync(join(repo, dir, "20990101000000_unread.sql"), `${statement}\n`);
  assert.equal(engine(repo, "derive").status, 0);
  return repo;
}
const openIds = (repo) => JSON.parse(run(repo, ["unread", "--json"]).stdout).open.map((i) => i.id);

test("writer to reader: a fresh install writes unread.strict, and lint holds the repo to it", (t) => {
  const repo = adopted(t);
  assert.deepEqual(config(repo).unread, { strict: true, fine: [] });
  const r = engine(repo, "lint");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /supabase saw this and could not read it/);
});

test("writer to reader: --mark writes the mark lint accepts and the human index shows, with its reason and the item's text", (t) => {
  const repo = adopted(t);
  const [id] = openIds(repo);
  const r = run(repo, ["unread", `--mark=${id}`, "--why=a schema  nothing uses", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(config(repo).unread.fine, [{ id, what: "DROP SCHEMA mine ON things", why: "a schema nothing uses" }]);
  assert.ok(JSON.parse(r.stdout).notes.some((n) => /run `derive`, then `render`/.test(n)), "render reads what derive last wrote (CR-234)");
  assert.equal(engine(repo, "lint").status, 0);
  assert.equal(engine(repo, "render").status, 0);
  const html = readFileSync(join(repo, "zdd", "human-index.html"), "utf8");
  assert.equal(JSON.parse(/window\.BUNDLE = (.*);\n/.exec(html)[1]).docs.unread[0].why, "a schema nothing uses");
  const again = run(repo, ["unread"]);
  assert.match(again.stdout, /1 marked fine:/);
  assert.match(again.stdout, /why: a schema nothing uses/);
  // The config it wrote is one the plugin's own reader still accepts.
  assert.equal(run(repo, ["adapters"]).status, 0);
});

test("--mark takes several ids, and keeps the list sorted, so two branches' marks merge", (t) => {
  const repo = adopted(t);
  const dir = config(repo).extractorOptions.supabase.migrationNamespaces[0].dir;
  writeFileSync(join(repo, dir, "20990102000000_more.sql"), "DROP SCHEMA some_schema;\n");
  assert.equal(engine(repo, "derive").status, 0);
  const ids = openIds(repo);
  assert.equal(ids.length, 2);
  assert.equal(run(repo, ["unread", `--mark=${[...ids].reverse().join(",")}`, "--why=neither is schema"]).status, 0);
  assert.deepEqual(config(repo).unread.fine.map((m) => m.id), [...ids].sort());
  assert.equal(engine(repo, "lint").status, 0);
});

test("--mark refuses a mark that would say nothing: no reason, a malformed id, an id no adapter reports", (t) => {
  const repo = adopted(t);
  const [id] = openIds(repo);
  const before = readFileSync(join(repo, "zdd", "config.json"), "utf8");
  for (const [args, re] of [
    [[`--mark=${id}`], /--mark needs --why/],
    [[`--mark=${id}`, "--why=   "], /--mark needs --why/],
    [[`--mark=${id}`, `--why=${"y".repeat(501)}`], /--why is over 500/],
    [["--mark=route:/health", "--why=x"], /is not an unread item's id/],
    [[`--mark=unread:supabase/${"0".repeat(16)}`, "--why=x"], /no adapter reports/],
    [["--mark=,", "--why=x"], /--mark needs at least one item id/],
    [["--mark", "--why=x"], /--mark needs at least one item id/],
  ]) {
    const r = run(repo, ["unread", ...args]);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, re);
  }
  assert.equal(readFileSync(join(repo, "zdd", "config.json"), "utf8"), before, "nothing is half-written");
});

test("--forget takes a mark away, a stale one included, and refuses one that is not there", (t) => {
  const repo = adopted(t);
  const [id] = openIds(repo);
  assert.equal(run(repo, ["unread", `--mark=${id}`, "--why=x"]).status, 0);
  assert.equal(run(repo, ["unread", `--forget=${id}`]).status, 0);
  assert.deepEqual(config(repo).unread.fine, []);
  assert.equal(engine(repo, "lint").status, 1, "the item is open again");
  const none = run(repo, ["unread", `--forget=${id}`]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /has no mark for/);

  const stale = `unread:supabase/${"0".repeat(16)}`;
  writeConfig(repo, { ...config(repo), unread: { strict: true, fine: [{ id: stale, why: "was fine" }] } });
  assert.match(run(repo, ["unread"]).stdout, /1 mark no item answers any more/);
  assert.equal(run(repo, ["unread", `--forget=${stale}`]).status, 0);
  assert.deepEqual(config(repo).unread.fine, []);
});

test("--raise waits for every answer, then writes what lint reads", (t) => {
  const repo = adopted(t);
  const c = config(repo);
  delete c.unread;
  writeConfig(repo, c);
  assert.equal(engine(repo, "lint").status, 0, "absent: a warning");
  const [id] = openIds(repo);
  const refused = run(repo, ["unread", "--raise"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /unread\.strict stays off: 1 item has no answer yet/);
  assert.equal(config(repo).unread, undefined);

  const both = run(repo, ["unread", `--mark=${id}`, "--why=x", "--raise", "--json"]);
  assert.equal(both.status, 0, both.stderr);
  assert.equal(JSON.parse(both.stdout).raised, true);
  assert.equal(config(repo).unread.strict, true);
  assert.equal(engine(repo, "lint").status, 0);
  // Held from now on: the next item fails.
  const dir = config(repo).extractorOptions.supabase.migrationNamespaces[0].dir;
  writeFileSync(join(repo, dir, "20990102000000_more.sql"), "DROP SCHEMA some_schema;\n");
  assert.equal(engine(repo, "derive").status, 0);
  assert.equal(engine(repo, "lint").status, 1);
});

test("--raise on a repo with nothing unread turns it on, and again changes nothing", (t) => {
  const repo = adopted(t, { statement: null });
  const c = config(repo);
  delete c.unread;
  writeConfig(repo, c);
  assert.match(run(repo, ["unread"]).stdout, /No adapter reported anything/);
  assert.equal(run(repo, ["unread", "--raise"]).status, 0);
  assert.deepEqual(config(repo).unread, { strict: true, fine: [] });
  const again = JSON.parse(run(repo, ["unread", "--raise", "--json"]).stdout);
  assert.equal(again.raised, false);
});

test("an upgrade never writes unread.strict: lint stays a warning, and the plan names the step", (t) => {
  const repo = adopted(t);
  const c = config(repo);
  delete c.unread;
  writeConfig(repo, c);
  const up = run(repo, ["upgrade", "--json"]);
  assert.equal(up.status, 0, up.stderr);
  assert.ok(JSON.parse(up.stdout).notes.some((n) => /bootstrap\.mjs unread --raise/.test(n)));
  assert.equal(config(repo).unread, undefined);
  assert.equal(engine(repo, "lint").status, 0, "no upgrade turns CI red by surprise (0035, 0040 point 7)");
});

test("a repo already strict hears nothing about it at upgrade", (t) => {
  const repo = adopted(t, { statement: null });
  const up = run(repo, ["upgrade", "--json"]);
  assert.equal(up.status, 0, up.stderr);
  assert.ok(!JSON.parse(up.stdout).notes.some((n) => /bootstrap\.mjs unread/.test(n)));
});

test("a mark on an item derive has not written yet: the note's derive, then render, leaves --check green (CR-234)", (t) => {
  const repo = adopted(t);
  const dir = config(repo).extractorOptions.supabase.migrationNamespaces[0].dir;
  writeFileSync(join(repo, dir, "20990102000000_more.sql"), "DROP SCHEMA some_schema;\n");
  const ids = openIds(repo);
  assert.equal(ids.length, 2, "the list is the source as it is now");
  assert.equal(run(repo, ["unread", `--mark=${ids.join(",")}`, "--why=x"]).status, 0);
  for (const cmd of ["derive", "render"]) assert.equal(engine(repo, cmd).status, 0, cmd);
  for (const args of [["derive", "--check"], ["render", "--check"], ["lint"]]) assert.equal(engine(repo, ...args).status, 0, args.join(" "));
});

test("the skills that answer an item name the command, and the schema names the block", () => {
  const skill = (name) => readFileSync(resolve(HERE, "..", "skills", name, "SKILL.md"), "utf8");
  for (const name of ["bootstrap", "upgrade", "update"]) assert.match(skill(name), /unread --mark=<id>/, name);
  assert.match(skill("upgrade"), /unread --raise/);
  assert.match(skill("extractor"), /`unread` list/);
  const schema = JSON.parse(readFileSync(resolve(HERE, "..", "templates", "config.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(schema.properties.unread.properties).sort(), ["fine", "strict"]);
});
