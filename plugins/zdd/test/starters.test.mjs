// The starter library from the plugin's side (decision 0048 points 3, 4, 7
// and 8): where a version is found, the copy bootstrap and the upgrade make,
// the record it keeps, and the upgrade's two proofs — the baseline copied in
// with the records unchanged, then, on a yes, the fixes, with every map link
// at a record id that moved repointed before lint.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STARTERS, RECORD, starterLibrary, fixesFor, movedIds, parseRecord, fileHash } from "../scripts/lib/starters.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = resolve(PLUGIN, "..", "..", "packages", "zdd-starter-adapters");
const STAGE = join(LIBRARY, "scripts", "stage.mjs");
const ENGINE_BIN = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");

const tmp = (t, prefix = "zdd-starters-") => {
  const d = mkdtempSync(join(tmpdir(), prefix));
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
const config = (repo) => JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
const record = (repo) => parseRecord(readFileSync(join(repo, "zdd", "extractors", RECORD), "utf8"), RECORD);
const git = (repo, ...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
const stageInto = (dir, version) => execFileSync(process.execPath, [STAGE, version, join(dir, version)], { stdio: "ignore" });

// An app on 0.13 that ran `supabase` from the engine: one table renamed
// with its schema, which 0.1.0 names without it and 0.2.0 keeps (the
// library's first 0.2.0 fix that moves an id), and a feature that claims it.
function oldApp(t) {
  const root = tmp(t);
  const repo = join(root, "app");
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  mkdirSync(join(repo, "home"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "0001_init.sql"), "create table public.job_templates (id uuid primary key, name text);\n");
  writeFileSync(join(repo, "supabase", "migrations", "0002_rename.sql"), "alter table public.job_templates rename to booking_processes;\n");
  mkdirSync(join(repo, "zdd", "map", "features"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ name: "app", release: "0.13.0", extractors: ["supabase"], extractorOptions: { supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } }, suiteChecks: 5 }, null, 2) + "\n");
  git(repo, "init", "-q");
  return repo;
}
const PAGE = "zdd/map/features/booking.md";
const pageText = (target) => `---\ntype: Feature\ntitle: Booking\ndescription: "Booking processes."\nresource: supabase\ntags: [booking]\n---\n\nThe table: [booking processes](../../metadata/table/${target}).\n`;

test("the pin: the version a new repo takes is the library's own, the baseline is its first and the stager's, and a ZDD release owns adapters from a version after every old one", () => {
  const pkg = JSON.parse(readFileSync(join(LIBRARY, "package.json"), "utf8"));
  const notes = JSON.parse(readFileSync(join(LIBRARY, "notes.json"), "utf8"));
  assert.equal(STARTERS.package, pkg.name);
  assert.equal(STARTERS.version, pkg.version);
  assert.equal(STARTERS.baseline, notes.versions[0].version);
  assert.match(readFileSync(STAGE, "utf8"), new RegExp(`export const BASELINE = "${STARTERS.baseline.replace(/\./g, "\\.")}"`));
  assert.ok(notes.versions.some((v) => v.version === STARTERS.version), "the pinned version has its note");
  assert.match(STARTERS.ownedSince, /^\d+\.\d+\.\d+$/);
});

test("starterLibrary: a folder of staged versions first, refused when it lacks the one asked; else the library beside this plugin; else npm, held to the package and the version", (t) => {
  const dir = tmp(t);
  stageInto(dir, STARTERS.baseline);
  const env = { ZDD_STARTER_ADAPTERS_DIR: dir };
  const base = starterLibrary(STARTERS.baseline, { env });
  assert.equal(base.dir, join(dir, STARTERS.baseline));
  assert.equal(base.notes.versions.length, 1, "a staged version carries the notes up to it");
  assert.throws(() => starterLibrary(STARTERS.version, { env }), new RegExp(`holds no starter library ${STARTERS.version.replace(/\./g, "\\.")} .*stage one there`));
  // The sibling stages both versions it can, fresh.
  const sib = starterLibrary(STARTERS.version, { env: {} });
  assert.ok(existsSync(join(sib.adapters, "supabase", "index.mjs")));
  assert.equal(JSON.parse(readFileSync(join(sib.dir, "package.json"), "utf8")).version, STARTERS.version);
  // No sibling: npm, through the fetch given; what it gives is checked.
  const none = join(dir, "none");
  const fetched = join(dir, STARTERS.baseline);
  assert.equal(starterLibrary(STARTERS.baseline, { env: {}, sibling: none, fetch: () => fetched }).dir, fetched);
  assert.throws(() => starterLibrary(STARTERS.version, { env: {}, sibling: join(dir, "none2"), fetch: () => fetched }), /gave no starter library .*it is version "0\.1\.0"/);
  assert.throws(() => starterLibrary(STARTERS.version, { env: {}, sibling: join(dir, "none3"), fetch: () => { throw new Error("ENOTFOUND registry"); } }), /could not be fetched from npm: ENOTFOUND registry — check this machine reaches the npm registry/);
  assert.throws(() => starterLibrary("latest"), /not a starter library version/);
});

test("the fix notes and the id moves the upgrade reads: fixes after the copy's version and up to the pin, none at or before a declined one; an id gone and one of its kind and namespace with the same name past its schema", () => {
  const notes = JSON.parse(readFileSync(join(LIBRARY, "notes.json"), "utf8"));
  const offered = fixesFor(notes, "supabase", STARTERS.baseline, STARTERS.version);
  assert.deepEqual(offered.map((v) => v.version), [STARTERS.version]);
  assert.ok(offered[0].fixes.every((f) => f.what && f.who && f.moves));
  assert.deepEqual(fixesFor(notes, "supabase", STARTERS.baseline, STARTERS.version, STARTERS.version), []);
  assert.deepEqual(fixesFor(notes, "generic", STARTERS.baseline, STARTERS.version), []);
  const before = new Map([["table:db/booking", "a.json"], ["function:db/f", "f.json"], ["function:db/public.f", "pf.json"], ["table:db/gone", "g.json"], ["route:/x", "r.json"]]);
  const after = new Map([["table:db/public.booking", "pb.json"], ["function:db/f", "f.json"], ["route:/x", "r.json"]]);
  const { moves, unmatched } = movedIds(before, after);
  assert.deepEqual(moves.map((m) => [m.from, m.to, m.fromFile, m.toFile]), [["function:db/public.f", "function:db/f", "pf.json", "f.json"], ["table:db/booking", "table:db/public.booking", "a.json", "pb.json"]]);
  assert.deepEqual(unmatched, ["table:db/gone"]);
});

test("apply copies what the developer takes, with its companions and the record `starters` then reads; a file the repo has is never replaced; \"starters\": false copies only generic", (t) => {
  const repo = join(tmp(t), "app");
  mkdirSync(join(repo, "home"), { recursive: true });
  mkdirSync(join(repo, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(repo, "supabase", "migrations", "0001.sql"), "create table things (id uuid primary key);\n");
  git(repo, "init", "-q");
  const answers = join(repo, "..", "answers.json");
  writeFileSync(answers, JSON.stringify({ extractors: ["supabase", "supabase-js"], extractorOptions: { supabase: { migrationNamespaces: [{ name: "db", dir: "supabase/migrations" }] } } }));
  // One shared file of the repo's own, already there.
  mkdirSync(join(repo, "zdd", "extractors", "_shared"), { recursive: true });
  writeFileSync(join(repo, "zdd", "extractors", "_shared", "slug.mjs"), "// mine\n");
  const r = json(repo, ["apply", `--answers=${answers}`]);
  assert.equal(r.config.localExtractorDir, "zdd/extractors");
  const rec = record(repo);
  assert.deepEqual(Object.keys(rec.adapters), ["nextjs", "supabase", "supabase-js"]);
  assert.deepEqual(rec.adapters.nextjs, { version: STARTERS.version, companionOf: ["supabase-js"] });
  assert.equal(readFileSync(join(repo, "zdd", "extractors", "_shared", "slug.mjs"), "utf8"), "// mine\n");
  assert.equal(rec.files["_shared/slug.mjs"], undefined, "a file ZDD did not copy is not in the record");
  assert.ok(r.notes.some((n) => /_shared\/slug\.mjs: kept as it is — it is the repo's own and differs from the starter library's/.test(n)), r.notes.join("\n"));
  assert.ok(r.notes.some((n) => /nextjs copied too, only as the companion/.test(n)));
  assert.ok(!existsSync(join(repo, "zdd", "extractors", "supabase", "example")), "the preview's example stays in the library");
  for (const [f, h] of Object.entries(rec.files)) assert.equal(fileHash(readFileSync(join(repo, "zdd", "extractors", ...f.split("/")))), h, f);
  // The reader of that record.
  const s = json(repo, ["starters"]);
  assert.deepEqual(s.copies.map((c) => [c.name, c.version, c.listed]), [["nextjs", STARTERS.version, false], ["supabase", STARTERS.version, true], ["supabase-js", STARTERS.version, true]]);
  // The repo's own slug.mjs is not as ZDD would have copied it: every copy that reaches it is changed, the one that does not is untouched (CR-319).
  assert.deepEqual(Object.fromEntries(s.copies.map((c) => [c.name, c.changed])), { nextjs: ["_shared/slug.mjs"], supabase: [], "supabase-js": ["_shared/slug.mjs"] });
  assert.deepEqual(s.offers, []);
  writeFileSync(join(repo, "zdd", "extractors", "supabase", "index.mjs"), "// changed\n", { flag: "a" });
  assert.deepEqual(json(repo, ["starters"]).copies.find((c) => c.name === "supabase").changed, ["supabase/index.mjs"]);
  // The text narration collapses a copy to one line per adapter.
  const text = run(repo, ["apply", `--answers=${answers}`]).stdout;
  assert.doesNotMatch(text, /wrote +zdd\/extractors\/supabase\/index\.mjs/);

  const no = join(tmp(t), "app");
  mkdirSync(join(no, "home"), { recursive: true });
  git(no, "init", "-q");
  writeFileSync(answers, JSON.stringify({ extractors: ["supabase"], starters: false }));
  const n = json(no, ["apply", `--answers=${answers}`]);
  assert.deepEqual(n.config.extractors, ["generic"]);
  assert.deepEqual(readdirSync(join(no, "zdd", "extractors")).sort(), ["generic", RECORD]);
  assert.ok(n.notes.some((x) => /the starter library was declined: nothing was copied for supabase/.test(x)), n.notes.join("\n"));
  assert.equal(engine(no, "derive").status, 0);
});

test("upgrade from before the app owned its adapters: the baseline comes in, the records are proved unchanged, the fixes are offered; on a yes the copies move, the map link at the moved id is repointed, and lint passes", (t) => {
  const repo = oldApp(t);
  // What the old engine committed: the baseline's records, and a feature claiming the table by its old id.
  const plan = json(repo, ["upgrade", "--plan"]);
  assert.ok(plan.wrote.includes(`zdd/extractors/${RECORD}`));
  assert.ok(!existsSync(join(repo, "zdd", "extractors")), "the plan writes nothing");
  const up = json(repo, ["upgrade"]);
  assert.equal(up.starters.version, STARTERS.baseline);
  assert.deepEqual(up.starters.copied, ["supabase"]);
  assert.equal(config(repo).localExtractorDir, "zdd/extractors");
  assert.ok(up.notes.some((n) => /run `bootstrap\.mjs starters --prove`/.test(n)), up.notes.join("\n"));
  assert.ok(up.notes.some((n) => new RegExp(`the starter library's ${STARTERS.version.replace(/\./g, "\\.")} fixes known bugs in supabase`).test(n)), up.notes.join("\n"));
  assert.equal(record(repo).adapters.supabase.version, STARTERS.baseline);
  assert.equal(engine(repo, "derive").status, 0);
  assert.ok(existsSync(join(repo, "zdd", "metadata", "table", "db--booking_processes.json")), "the baseline's id, without the schema");
  writeFileSync(join(repo, PAGE), pageText("db--booking_processes.json"));
  assert.equal(engine(repo, "render").status, 0);
  assert.equal(engine(repo, "lint").status, 0, "the map as the old engine left it lints");

  // Proof 1.
  const proved = json(repo, ["starters", "--prove"]);
  assert.equal(proved.proved, true, proved.output.join("\n"));
  // The offer.
  const s = json(repo, ["starters"]);
  assert.deepEqual(s.behind, ["supabase"]);
  assert.deepEqual(s.offers.map((o) => [o.version, Object.keys(o.starters)]), [[STARTERS.version, ["supabase"]]]);
  assert.match(run(repo, ["starters"]).stdout, /Fixes on offer .*on a yes `starters --move`, on a no `starters --decline`/s);

  // Proof 2, on a yes.
  const m = json(repo, ["starters", "--move"]);
  assert.deepEqual(m.moved, ["supabase"]);
  assert.deepEqual(m.moves.map((x) => [x.from, x.to]), [["table:db/booking_processes", "table:db/public.booking_processes"]]);
  assert.deepEqual(m.repointed, [PAGE]);
  assert.equal(m.lint.ok, true, m.lint.output.join("\n"));
  assert.match(readFileSync(join(repo, PAGE), "utf8"), /\]\(\.\.\/\.\.\/metadata\/table\/db--public\.booking_processes\.json\)/);
  assert.equal(record(repo).adapters.supabase.version, STARTERS.version);
  assert.deepEqual(json(repo, ["starters"]).offers, []);
  const again = run(repo, ["starters", "--move"]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /every copy is already at/);
});

test("starters: a no is kept and not offered again; a changed copy is never moved; a failing test puts every copy back", (t) => {
  const repo = oldApp(t);
  json(repo, ["upgrade"]);
  assert.equal(engine(repo, "derive").status, 0);
  // A changed copy: the move refuses, writing nothing.
  const idx = join(repo, "zdd", "extractors", "supabase", "index.mjs");
  const copied = readFileSync(idx);
  writeFileSync(idx, Buffer.concat([copied, Buffer.from("// mine\n")]));
  const refused = run(repo, ["starters", "--move"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /supabase \(supabase\/index\.mjs\) changed since it was copied — a move would overwrite your changes, so nothing was written/);
  assert.equal(record(repo).adapters.supabase.version, STARTERS.baseline);
  writeFileSync(idx, copied);
  // A no.
  const d = json(repo, ["starters", "--decline"]);
  assert.equal(d.declined, true);
  assert.equal(record(repo).adapters.supabase.declined, STARTERS.version);
  assert.deepEqual(json(repo, ["starters"]).offers, []);
  assert.equal(run(repo, ["starters", "--decline"]).status, 1, "nothing left to decline");
  // A failing test at the new version: the copies are put back byte for byte.
  const lib = tmp(t);
  stageInto(lib, STARTERS.baseline);
  stageInto(lib, STARTERS.version);
  const failing = join(lib, STARTERS.version, "adapters", "supabase", "test", "zz-fails.test.mjs");
  writeFileSync(failing, 'import { test } from "node:test";\ntest("fails", () => { throw new Error("planted"); });\n');
  const env = { ...process.env, ZDD_STARTER_ADAPTERS_DIR: lib };
  const before = readdirSync(join(repo, "zdd", "extractors", "supabase", "test")).sort();
  const recBefore = readFileSync(join(repo, "zdd", "extractors", RECORD), "utf8");
  const rolled = run(repo, ["starters", "--move"], env);
  assert.equal(rolled.status, 1);
  assert.match(rolled.stderr, /the adapters' own tests fail at .*every copy was put back as it was/);
  assert.deepEqual(readdirSync(join(repo, "zdd", "extractors", "supabase", "test")).sort(), before);
  assert.equal(readFileSync(join(repo, "zdd", "extractors", RECORD), "utf8"), recBefore);
  assert.equal(readFileSync(idx).equals(copied), true);
});
