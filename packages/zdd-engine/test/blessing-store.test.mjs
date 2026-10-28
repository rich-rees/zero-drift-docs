// The blessing store at its edges (ZDD-1, decision 0031; slice 1's review
// campaign): a missing store is said, a store over the map is refused, a
// custom store path works end to end, an empty Blessings heading on a map
// page fails, a `where:` file name that ends in brackets stays a path, two
// files asking one question stay two in the tally, a blessing's metadata
// link is watched by freshness, and no question or file name breaks the
// index's Markdown.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, renameSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseWhere, readBlessing } from "../src/core/lib/blessings.mjs";
import { buildBlessingIndex } from "../src/core/lib/blessing-index.mjs";
import { readStores, tally } from "../src/core/tally.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");
const engine = (repo, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-bstore-"));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const withPaths = (repo, paths) => {
  const cfg = join(repo, "zdd", "config.json");
  const c = JSON.parse(readFileSync(cfg, "utf8"));
  writeFileSync(cfg, JSON.stringify({ ...c, paths: { ...(c.paths ?? {}), ...paths } }, null, 2) + "\n");
};

test("CR-005: a missing or mistyped blessing store in a populated bundle is said by lint and render, never read as an empty store silently", () => {
  const repo = mkRepo();
  withPaths(repo, { blessingsDir: "zdd/blesings" });
  for (const cmd of ["lint", "render"]) {
    const r = engine(repo, cmd);
    assert.match(r.stderr, /^WARNING: paths\.blessingsDir 'zdd\/blesings' does not exist.*not greenfield/m, `${cmd}: ${r.stderr}`);
  }
  rmSync(repo, { recursive: true, force: true });
});

test("CR-008: the blessing store may not overlap the map, the ADRs or the glossary", () => {
  const repo = mkRepo();
  for (const [value, key] of [["zdd/map", "mapDir"], ["zdd/map/blessings", "mapDir"], ["zdd/adr", "adrDir"], ["zdd/glossary.md", "glossary"]]) {
    withPaths(repo, { blessingsDir: value });
    const r = engine(repo, "lint");
    assert.equal(r.status, 1, value);
    assert.match(r.stderr, new RegExp(`paths\\.blessingsDir '${value.replace(/\./g, "\\.")}' overlaps paths\\.${key} .*the blessing store is a folder of its own`), r.stderr);
  }
  rmSync(repo, { recursive: true, force: true });
});

test("CR-022: a custom blessing store path is read by render, lint and the index's links", () => {
  const repo = mkRepo();
  mkdirSync(join(repo, "docs"), { recursive: true });
  renameSync(join(repo, "zdd", "blessings"), join(repo, "docs", "blessings"));
  withPaths(repo, { blessingsDir: "docs/blessings" });
  assert.equal(engine(repo, "derive").status, 0);
  assert.equal(engine(repo, "render").status, 0);
  const index = readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8");
  assert.match(index, /- \[Adding a page\?\]\(\.\.\/docs\/blessings\/adding-a-page\.md\) — copy:/, index);
  const r = engine(repo, "lint");
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(join(repo, "docs", "blessings", "bad.md"), "---\nkind: copy\n---\n\nAdding bad? Copy it because x.\n");
  assert.match(engine(repo, "lint").stderr, /docs\/blessings\/bad\.md .*has no 'where:'/);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-019: a Blessings heading left on a map page with no blessing under it fails too; one inside a fenced example does not", () => {
  const repo = mkRepo();
  const page = join(repo, "zdd", "map", "features", "things.md");
  writeFileSync(page, readFileSync(page, "utf8") + "\n# Blessings\n\nSee the store.\n");
  let r = engine(repo, "lint");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /things\.md: has a Blessings heading with no blessing under it — since 2\.5 blessings live in zdd\/blessings\//);
  writeFileSync(page, readFileSync(page, "utf8").replace("\n# Blessings\n\nSee the store.\n", "\n```md\n# Blessings\n```\n"));
  r = engine(repo, "lint");
  assert.equal(r.status, 0, r.stderr);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-010: a symbol is set apart by a space — a file name ending in brackets stays a path", () => {
  assert.deepEqual(parseWhere("src/cache(key)"), { path: "src/cache(key)", symbol: null });
  assert.deepEqual(parseWhere("src/cache(key) (getKey)"), { path: "src/cache(key)", symbol: "getKey" });
  assert.deepEqual(parseWhere("src/a.ts (f)"), { path: "src/a.ts", symbol: "f" });
});

test("CR-007: two blessing files asking one question stay two — labelled and matched by file name; a unique question by itself", () => {
  const repo = mkRepo();
  writeFileSync(join(repo, "zdd", "blessings", "adding-a-page-mobile.md"), "---\nwhere: src/app/page.tsx\nkind: copy\n---\n\nAdding a page? On mobile, copy the screen because the tabs need it.\n");
  const stores = readStores(repo, { adrDir: "zdd/adr", glossary: "zdd/glossary.md", blessingsDir: "zdd/blessings" });
  assert.deepEqual(stores.blessings, ["Adding a page? (adding-a-page)", "Adding a page? (adding-a-page-mobile)", "Adding an endpoint for things?", "Saving a thing?"]);
  const record = (line) => ({ hash: "a".repeat(40), subject: "s", record: { problems: [], sections: { glossary: [], adrs: [], blessings: [{ verb: "followed", valid: true, text: line }], map: [], comments: [] } } });
  const out = tally([record('the ZDD blessing "Adding a page?" (adding-a-page-mobile) for the screen')], stores);
  assert.equal(out.totals.blessings, 4, "four files, four blessings");
  assert.deepEqual(out.neverNamed.blessings, ["Adding a page? (adding-a-page)", "Adding an endpoint for things?", "Saving a thing?"]);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-022: a blessing is watched through a metadata record its text links to, as well as its where: file", () => {
  const repo = mkRepo();
  const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  assert.equal(engine(repo, "derive").status, 0);
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "work");
  // adding-an-endpoint-for-things links the /api/things record; its where: is the same file, so
  // point where: elsewhere and change only the linked record's source.
  const b = join(repo, "zdd", "blessings", "adding-an-endpoint-for-things.md");
  writeFileSync(b, readFileSync(b, "utf8").replace("where: src/app/api/things/route.ts", "where: src/app/page.tsx"));
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "point elsewhere");
  git("checkout", "-q", "-b", "work2");
  appendFileSync(join(repo, "src", "app", "api", "things", "route.ts"), "\n// touched\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "touch the route");
  const out = engine(repo, "freshness", "--base", "work").stdout;
  assert.match(out, /\| `zdd\/blessings\/adding-an-endpoint-for-things\.md` \| src\/app\/api\/things\/route\.ts \| `metadata\/route\/things` \|/, out);
  rmSync(repo, { recursive: true, force: true });
});

test("CR-023: brackets in a question, spaces or brackets in a file name, and a backtick in a path never break the index's Markdown", () => {
  const b = readBlessing("---\nwhere: src/odd`name (app).ts\nkind: copy\n---\n\nUsing ](https://x.invalid) arrays? Copy it because x.\n", "odd (one)");
  const { text } = buildBlessingIndex([b], { adrHref: () => null, blessingHref: (id) => `blessings/${id}.md`, mapPage: () => null, usersOf: () => null });
  assert.match(text, /^- \[Using \\\]\(https:\/\/x\.invalid\) arrays\?\]\(<blessings\/odd \(one\)\.md>\) — copy: `` src\/odd`name \(app\)\.ts `` · why: because x$/m, text);
});

test("CR-022: a blessing file over the size cap is a note beside the tally's totals, never a silent gap", () => {
  const repo = mkRepo();
  writeFileSync(join(repo, "zdd", "blessings", "huge.md"), "---\nwhere: src/app/page.tsx\nkind: copy\n---\n\nHuge? " + "x".repeat(1024 * 1024 + 1));
  const s = readStores(repo, { adrDir: "zdd/adr", glossary: "zdd/glossary.md", blessingsDir: "zdd/blessings" });
  assert.deepEqual(s.notes, ["zdd/blessings/huge.md: over 1024 KiB or unreadable — not in the never-named list"]);
  assert.ok(!s.blessings.includes("Huge?"));
  rmSync(repo, { recursive: true, force: true });
});
