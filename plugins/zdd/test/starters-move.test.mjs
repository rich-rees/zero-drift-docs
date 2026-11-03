// The starter copy's edges (decision 0048, slice 5's campaign CR-315 to
// CR-342): what a copy owns and what stays the repo's, a record read as
// untrusted input, the move's checks before its first write, the shared code
// it keeps or removes, its rollback, and every place a moved id is
// repointed. Staged versions in ZDD_STARTER_ADAPTERS_DIR stand in for
// releases the library has not made, so each case is built on purpose.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { STARTERS, RECORD, parseRecord, movedIds, npmFetch, npmCommand, fileHash } from "../scripts/lib/starters.mjs";
import { starterVersionFor } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = resolve(PLUGIN, "..", "..", "packages", "zdd-starter-adapters");
const STAGE = join(LIBRARY, "scripts", "stage.mjs");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");

const tmp = (t) => {
  const d = mkdtempSync(join(tmpdir(), "zdd-move-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (repo, args, env = process.env) => spawnSync(process.execPath, [SCRIPT, ...args, `--root=${repo}`, `--home=${join(repo, "..", "home")}`], { encoding: "utf8", env });
const json = (repo, args, env) => {
  const r = run(repo, [...args, "--json"], env);
  assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}${r.stdout}`);
  return JSON.parse(r.stdout);
};
const engine = (repo, ...args) => spawnSync(process.execPath, [ENGINE_BIN, ...args, `--root=${repo}`], { encoding: "utf8" });
const git = (repo, ...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
const EXT = (repo, ...p) => join(repo, "zdd", "extractors", ...p);
const record = (repo) => parseRecord(readFileSync(EXT(repo, RECORD), "utf8"), RECORD);
const tree = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split(sep).join("/")] = fileHash(readFileSync(p));
    }
  };
  walk(dir);
  return out;
};

// A folder of staged versions; `shape` edits them before use.
function library(t, shape = () => {}) {
  const dir = tmp(t);
  for (const v of [STARTERS.baseline, STARTERS.version]) execFileSync(process.execPath, [STAGE, v, join(dir, v)], { stdio: "ignore" });
  shape({ base: join(dir, STARTERS.baseline, "adapters"), next: join(dir, STARTERS.version, "adapters") });
  return { ...process.env, ZDD_STARTER_ADAPTERS_DIR: dir };
}
// An app on 0.13 that ran one schema reader: a renamed table, and a feature
// page, a blessing and the allow-list that name it.
function oldApp(t, { extra = "" } = {}) {
  const repo = join(tmp(t), "app");
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  mkdirSync(join(repo, "..", "home"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "0001_init.sql"), `create table public.job_templates (id uuid primary key);\n${extra}`);
  writeFileSync(join(repo, "supabase", "migrations", "0002_rename.sql"), "alter table public.job_templates rename to booking_processes;\n");
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ name: "app", release: "0.13.0", extractors: ["supabase"], extractorOptions: { supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } }, suiteChecks: 5, claims: { allowUnclaimed: ["table:db/booking_processes"] } }, null, 2) + "\n");
  git(repo, "init", "-q");
  return repo;
}
const settle = (repo) => {
  assert.equal(engine(repo, "derive").status, 0);
  assert.equal(engine(repo, "render").status, 0);
};

test("CR-339: the baseline for a repo from before ownedSince (or with no pin), the pinned version from it on", () => {
  assert.equal(starterVersionFor(null), STARTERS.baseline);
  assert.equal(starterVersionFor("0.13.0"), STARTERS.baseline);
  assert.equal(starterVersionFor("zdd-engine@2.5.0"), STARTERS.baseline, "the old line is before every new-line release");
  assert.equal(starterVersionFor(STARTERS.ownedSince), STARTERS.version);
  assert.equal(starterVersionFor("9.0.0"), STARTERS.version);
});

test("CR-335: the npm route installs the pinned package with no scripts into a private folder, through npm-cli.js beside node on Windows, cmd.exe quoted only as a last resort", (t) => {
  const seen = [];
  const exec = (cmd, args, opts) => seen.push({ cmd, args, shell: opts.shell, cwd: opts.cwd });
  const out = tmp(t);
  const got = npmFetch(STARTERS.version, { exec, platform: "linux", out });
  assert.equal(got, join(out, "node_modules", "@rich-rees", "zdd-starter-adapters"));
  assert.deepEqual(seen[0], { cmd: "npm", args: ["install", "--prefix", out, "--no-save", "--no-package-lock", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", `${STARTERS.package}@${STARTERS.version}`], shell: false, cwd: out });
  const nodeDir = tmp(t);
  const node = join(nodeDir, "node.exe");
  assert.deepEqual(npmCommand(node, "win32"), { cmd: "npm.cmd", pre: [], shell: true });
  npmFetch(STARTERS.version, { exec, platform: "win32", execPath: node, out });
  assert.equal(seen[1].cmd, "npm.cmd");
  assert.ok(seen[1].args.every((a) => /^".*"$/.test(a)), "through cmd.exe every argument is quoted");
  mkdirSync(join(nodeDir, "node_modules", "npm", "bin"), { recursive: true });
  writeFileSync(join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), "");
  npmFetch(STARTERS.version, { exec, platform: "win32", execPath: node, out });
  assert.deepEqual([seen[2].cmd, seen[2].args[0], seen[2].shell], [node, join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), false]);
  assert.throws(() => npmFetch(STARTERS.version, { exec, platform: "win32", execPath: join(tmp(t), "node.exe"), out: join(out, "a%b") }), /cannot run npm through cmd\.exe/);
});

test("CR-336: detect and preview read the library ZDD_STARTER_ADAPTERS_DIR stages, through the CLI", (t) => {
  const dir = tmp(t);
  const v = join(dir, STARTERS.version);
  cpSync(join(ENGINE, "test", "adapters"), join(v, "adapters"), { recursive: true });
  writeFileSync(join(v, "package.json"), JSON.stringify({ name: STARTERS.package, version: STARTERS.version }));
  writeFileSync(join(v, "notes.json"), JSON.stringify({ notes: 1, versions: [{ version: STARTERS.version, summary: "test", starters: {} }] }));
  const repo = tmp(t);
  writeFileSync(join(repo, "x.note"), "GET /x\n");
  const env = { ...process.env, ZDD_STARTER_ADAPTERS_DIR: dir };
  const d = json(repo, ["detect"], env);
  assert.deepEqual(d.proposals.map((p) => p.name), ["notes"], "the staged test-only adapters, not the library's");
  assert.deepEqual(d.library.offer, ["notes"]);
  assert.match(run(repo, ["detect"], env).stdout, /Starter library \(@rich-rees\/zdd-starter-adapters [\d.]+\) has adapters for: notes — offer to bring them across/);
  const p = json(repo, ["preview", "--extractors=notes"], env);
  t.after(() => rmSync(p.out, { recursive: true, force: true }));
  assert.deepEqual(p.used, ["notes"]);
});

test("CR-315, CR-337, CR-338: a file the repo had stays the repo's even when identical; a companion's files come and the suite passes beside it; a repair apply that adds a starter copies it", (t) => {
  const repo = join(tmp(t), "app");
  mkdirSync(join(repo, "..", "home"), { recursive: true });
  mkdirSync(join(repo, "app"), { recursive: true });
  git(repo, "init", "-q");
  const answers = join(repo, "..", "a.json");
  writeFileSync(answers, JSON.stringify({ extractors: ["generic"] }));
  json(repo, ["apply", `--answers=${answers}`]);
  // The repo's own copy of a shared helper, byte for byte the library's.
  const slug = join(LIBRARY, "adapters", "_shared", "slug.mjs");
  mkdirSync(EXT(repo, "_shared"), { recursive: true });
  cpSync(slug, EXT(repo, "_shared", "slug.mjs"));
  writeFileSync(answers, JSON.stringify({ extractors: ["generic", "supabase", "sqlalchemy"], extractorOptions: { supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] }, sqlalchemy: {} } }));
  const r = json(repo, ["apply", `--answers=${answers}`]);
  assert.ok(existsSync(EXT(repo, "supabase", "index.mjs")) && existsSync(EXT(repo, "sqlalchemy", "index.mjs")), "repair apply copied what it added");
  const rec = record(repo);
  assert.deepEqual(rec.adapters.fastapi, { version: STARTERS.version, companionOf: ["sqlalchemy"] });
  assert.ok(existsSync(EXT(repo, "fastapi", "index.mjs")) && existsSync(EXT(repo, "fastapi", "fixture")), "the companion's code and fixture");
  assert.equal(rec.files["_shared/slug.mjs"], undefined, "an identical file the repo had is not recorded as ZDD's");
  assert.ok(!r.notes.some((n) => /_shared\/slug\.mjs: kept/.test(n)), "and is no conflict to name");
  const suite = engine(repo, "suite");
  assert.equal(suite.status, 0, suite.stdout + suite.stderr);
  // Not recorded, so the copies that reach it are not untouched.
  const s = json(repo, ["starters"]);
  assert.ok(s.copies.find((c) => c.name === "sqlalchemy").changed.includes("_shared/slug.mjs"), JSON.stringify(s.copies));
});

test("CR-316, CR-317: a record is untrusted input — a forged path, a foreign package, an oversized file are each refused before anything moves", (t) => {
  const ok = { starters: 1, adapters: { supabase: { version: "0.1.0" } }, files: {} };
  const h = "0".repeat(64);
  for (const bad of ["supabase/../../README.md", "supabase/./x", "other/x.mjs", "supabase", "supabase/a\\b", "_shared/c:d"]) {
    assert.throws(() => parseRecord(JSON.stringify({ ...ok, files: { [bad]: h } }), RECORD), /is not a file of a recorded adapter or of _shared\//, bad);
  }
  assert.throws(() => parseRecord(JSON.stringify({ ...ok, package: "evil" }), RECORD), /records copies from "evil"/);
  assert.throws(() => parseRecord(JSON.stringify({ ...ok, adapters: { "../x": { version: "0.1.0" } } }), RECORD), /is not an adapter name/);
  assert.doesNotThrow(() => parseRecord(JSON.stringify({ ...ok, files: { "supabase/index.mjs": h, "_shared/js/x.mjs": h } }), RECORD));
  const repo = oldApp(t);
  json(repo, ["upgrade"]);
  writeFileSync(EXT(repo, RECORD), " ".repeat(4 * 1024 * 1024 + 1));
  const big = run(repo, ["starters"]);
  assert.equal(big.status, 1);
  assert.match(big.stderr, /is over 4 MiB/);
});

test("CR-321: --move enforces the first proof before any write; CR-319: an edited shared file marks every copy that reaches it, and the upgrade then raises no gate", (t) => {
  const repo = oldApp(t);
  json(repo, ["upgrade"]);
  settle(repo);
  // Committed records that the copies do not reproduce: refused, nothing written.
  const t1 = join(repo, "zdd", "metadata", "table");
  const f = readdirSync(t1)[0];
  const was = readFileSync(join(t1, f));
  writeFileSync(join(t1, f), "{}\n");
  const before = tree(EXT(repo));
  const refused = run(repo, ["starters", "--move"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /do not reproduce the committed records .*nothing was written/s);
  assert.deepEqual(tree(EXT(repo)), before);
  assert.equal(readFileSync(join(t1, f), "utf8"), "{}\n", "derive never ran to cover the drift up");
  writeFileSync(join(t1, f), was);
  // An edit in shared code the copy reaches.
  const shared = Object.keys(record(repo).files).find((x) => x.startsWith("_shared/"));
  writeFileSync(EXT(repo, ...shared.split("/")), "// mine\n", { flag: "a" });
  assert.ok(json(repo, ["starters"]).copies.find((c) => c.name === "supabase").changed.includes(shared));
  const m = run(repo, ["starters", "--move"]);
  assert.equal(m.status, 1);
  assert.match(m.stderr, /changed since it was copied/);
  const c = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  delete c.suiteChecks;
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2) + "\n");
  const up = json(repo, ["upgrade"]);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).suiteChecks, undefined, "a copy whose shared code changed is the repo's work: no gate raised");
  assert.ok(up.notes.some((n) => /this repo's own adapters \(supabase\)/.test(n)), up.notes.join("\n"));
});

test("CR-340, CR-322: a shared file no copy reaches at the new version is removed, one an adapter of the repo's own reaches is kept; a failing test puts the whole folder back", (t) => {
  const shape = (failing) => ({ base, next }) => {
    for (const f of ["gone.mjs", "used.mjs"]) writeFileSync(join(base, "_shared", f), `export const x = "${f}";\n`);
    writeFileSync(join(base, "supabase", "test", "shared.test.mjs"), 'import { test } from "node:test";\nimport { x } from "../../_shared/gone.mjs";\nimport { x as y } from "../../_shared/used.mjs";\ntest("reaches", () => { if (!x || !y) throw new Error("no"); });\n');
    if (failing) writeFileSync(join(next, "supabase", "test", "zz-fails.test.mjs"), 'import { test } from "node:test";\ntest("fails", () => { throw new Error("planted"); });\n');
  };
  const repo = oldApp(t);
  const env = library(t, shape(false));
  json(repo, ["upgrade"], env);
  // An adapter of the repo's own that reaches one of them.
  mkdirSync(EXT(repo, "mine"), { recursive: true });
  writeFileSync(EXT(repo, "mine", "index.mjs"), 'import { x } from "../_shared/used.mjs";\nexport const CONTRACT = 1;\nexport function derive() { return { records: [], diagnostics: [x] }; }\n');
  settle(repo);
  const m = json(repo, ["starters", "--move"], env);
  assert.equal(m.lint.ok, true, m.lint.output.join("\n"));
  assert.ok(!existsSync(EXT(repo, "_shared", "gone.mjs")), "no copy reaches it now");
  assert.ok(!existsSync(EXT(repo, "supabase", "test", "shared.test.mjs")), "a file the new version dropped is gone");
  assert.ok(existsSync(EXT(repo, "_shared", "used.mjs")), "the repo's own adapter still reaches it");
  assert.equal(record(repo).files["_shared/gone.mjs"], undefined);

  const again = oldApp(t);
  const bad = library(t, shape(true));
  json(again, ["upgrade"], bad);
  settle(again);
  const before = tree(EXT(again));
  const rolled = run(again, ["starters", "--move"], bad);
  assert.equal(rolled.status, 1);
  assert.match(rolled.stderr, /tests fail .*every copy was put back as it was/s);
  assert.deepEqual(tree(EXT(again)), before, "every file of the folder as it was, the removed shared one too");
});

test("CR-341, CR-342, CR-328, CR-324: a moved id is repointed in the map, a blessing and allowUnclaimed (never inside an HTML comment); a record gone with no successor is named; case is never folded", (t) => {
  const repo = oldApp(t, { extra: "create table gone_table (id uuid primary key);\n" });
  const env = library(t, ({ next }) => {
    const p = join(next, "supabase", "index.mjs");
    const s = readFileSync(p, "utf8").replace("export function derive({ repoRoot, options, io }) {", "function deriveAll({ repoRoot, options, io }) {");
    writeFileSync(p, `${s}\nexport function derive(a) {\n  const r = deriveAll(a);\n  return { ...r, records: r.records.filter((x) => !String(x.id).endsWith("/gone_table")) };\n}\n`);
  });
  json(repo, ["upgrade"], env);
  settle(repo);
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  const link = "../../metadata/table/db--booking_processes.json";
  writeFileSync(join(repo, "zdd", "map", "features", "booking.md"), `---\ntype: Feature\ntitle: Booking\ndescription: "Booking."\nresource: supabase\ntags: [booking]\n---\n\n[booking](${link}) and [gone](../../metadata/table/db--gone_table.json)\n<!-- an old note: [booking](${link}) -->\n`);
  mkdirSync(join(repo, "zdd", "blessings"), { recursive: true });
  writeFileSync(join(repo, "zdd", "blessings", "adding-a-booking.md"), `---\nwhere: supabase/migrations/0001_init.sql\nkind: copy\n---\n\nAdding a booking? Start from [the table](../metadata/table/db--booking_processes.json).\n`);
  const m = json(repo, ["starters", "--move"], env);
  assert.deepEqual(m.moves.map((x) => [x.from, x.to]), [["table:db/booking_processes", "table:db/public.booking_processes"]]);
  assert.deepEqual(m.unmatched, ["table:db/gone_table"]);
  assert.deepEqual(m.repointed.sort(), ["zdd/blessings/adding-a-booking.md", "zdd/config.json (claims.allowUnclaimed)", "zdd/map/features/booking.md"].sort());
  const page = readFileSync(join(repo, "zdd", "map", "features", "booking.md"), "utf8");
  assert.match(page, /^\[booking\]\(\.\.\/\.\.\/metadata\/table\/db--public\.booking_processes\.json\)/m);
  assert.match(page, new RegExp(`<!-- an old note: \\[booking\\]\\(${link.replace(/[.]/g, "\\.")}\\) -->`), "a comment is left as written");
  assert.match(readFileSync(join(repo, "zdd", "blessings", "adding-a-booking.md"), "utf8"), /db--public\.booking_processes\.json/);
  assert.deepEqual(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).claims.allowUnclaimed, ["table:db/public.booking_processes"]);
  assert.notEqual(engine(repo, "render").status, 0, "the link to the gone record is broken until fixed by hand, and render says so");
  // Case: a quoted name and a lower-case one are two records, never one move.
  assert.deepEqual(movedIds(new Map([["table:db/Foo", "a"]]), new Map([["table:db/public.foo", "b"]])).unmatched, ["table:db/Foo"]);
});

test("CR-323: a declined fix stays listed apart, and the narration says a move would apply it", (t) => {
  const repo = oldApp(t);
  json(repo, ["upgrade"]);
  json(repo, ["starters", "--decline"]);
  const s = json(repo, ["starters"]);
  assert.deepEqual(s.offers, []);
  assert.deepEqual(s.declinedFixes.map((o) => [o.version, Object.keys(o.starters)]), [[STARTERS.version, ["supabase"]]]);
  const text = run(repo, ["starters"]).stdout;
  assert.match(text, /Fixes declined before .*`starters --move` would apply them/s);
  assert.doesNotMatch(text, /changes no record/);
});

test("CR-325, CR-327: a copy that fails part-way removes what it wrote; a localExtractorDir over an artifact is refused before anything", (t) => {
  const repo = oldApp(t);
  mkdirSync(EXT(repo, "supabase"), { recursive: true });
  writeFileSync(EXT(repo, "supabase", "test"), "a file where the copy needs a folder\n");
  const r = run(repo, ["upgrade"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /copying the starters into zdd\/extractors\/ failed .*every file this run had copied was removed/s);
  assert.ok(!existsSync(EXT(repo, "supabase", "index.mjs")) && !existsSync(EXT(repo, RECORD)));
  assert.deepEqual(Object.keys(tree(EXT(repo))), ["supabase/test"], "no file but the one the repo had (empty folders are harmless: a retry copies into them)");
  const over = oldApp(t);
  const c = JSON.parse(readFileSync(join(over, "zdd", "config.json"), "utf8"));
  writeFileSync(join(over, "zdd", "config.json"), JSON.stringify({ ...c, localExtractorDir: "zdd/map/x" }, null, 2) + "\n");
  const o = run(over, ["upgrade"]);
  assert.equal(o.status, 1);
  assert.match(o.stderr, /localExtractorDir 'zdd\/map\/x' overlaps paths\.mapDir/);
  assert.ok(!existsSync(join(over, "zdd", "map", "x")));
});

test("CR-353: a shared file the repo already had, byte for byte the library's, is reused and not recorded, so the upgrade raises no gate on the copy that reaches it", (t) => {
  const probe = oldApp(t);
  json(probe, ["upgrade"]);
  const shared = Object.keys(record(probe).files).find((f) => f.startsWith("_shared/"));
  const repo = oldApp(t);
  const c = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  delete c.suiteChecks;
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(c, null, 2) + "\n");
  mkdirSync(dirname(EXT(repo, ...shared.split("/"))), { recursive: true });
  cpSync(EXT(probe, ...shared.split("/")), EXT(repo, ...shared.split("/")));
  const up = json(repo, ["upgrade"]);
  assert.deepEqual(up.starters.reused, [shared]);
  assert.equal(record(repo).files[shared], undefined);
  assert.equal(JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8")).suiteChecks, undefined);
});
