// The blessing index (CAS-96): one line per blessing, by trigger question,
// app-level slices first. The builder on its own, then the fixture's index
// against its golden, render --check catching a stale or missing index, and
// the agent index's reading path naming it.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, appendFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildBlessingIndex } from "../src/lib/blessing-index.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");
const GOLDEN = join(PKG, "test", "golden");

const href = (num) => (num === "0042" ? null : `adr/${num}-x.md`);
const c = (id, type, title, body) => ({ id, type, title, body });

test("buildBlessingIndex: app-level slices first, each slice by title, blessings in document order, one line each", () => {
  const { text, count } = buildBlessingIndex(
    [
      c("map/features/zeta", "Feature", "Zeta", "# Blessings\n- Writing a zeta? Copy z, per ADR-0003.\n- Reading a zeta? Copy r because reads are cached.\n"),
      c("map/apps/web", "Application", "Web", "# Blessings\n- Styling anything? Use tokens, per ADR-0001 and ADR-0002.\n"),
      c("map/features/alpha", "Feature", "Alpha", "# Blessings\n- Adding an alpha? Copy a.\n- Copy b, per ADR-0042.\n"),
      c("map/features/none", "Feature", "None", "No blessings here.\n"),
      c("map/packages/ui", "Package", "UI", "## Blessings\n- Adding a component? Copy Button, per ADR-0004.\n"),
    ],
    href,
  );
  assert.equal(count, 6);
  assert.equal(
    text.slice(text.indexOf("## App-level")),
    [
      "## App-level",
      "",
      "### [UI](map/packages/ui.md)",
      "",
      "- Adding a component? — [ADR-0004](adr/0004-x.md)",
      "",
      "### [Web](map/apps/web.md)",
      "",
      "- Styling anything? — [ADR-0001](adr/0001-x.md), [ADR-0002](adr/0002-x.md)",
      "",
      "## Slices",
      "",
      "### [Alpha](map/features/alpha.md)",
      "",
      "- Adding an alpha? — _no reason given_",
      "- _(no trigger question)_ Copy b, per ADR-0042. — ADR-0042",
      "",
      "### [Zeta](map/features/zeta.md)",
      "",
      "- Writing a zeta? — [ADR-0003](adr/0003-x.md)",
      "- Reading a zeta? — because reads are cached",
      "",
    ].join("\n"),
  );
  assert.match(text, /^# Blessing index\n/);
  assert.match(text, /do not edit/);
});

test("buildBlessingIndex: an empty map says so, and control characters never reach the index", () => {
  const empty = buildBlessingIndex([c("map/features/a", "Feature", "A", "text")], href);
  assert.equal(empty.count, 0);
  assert.match(empty.text, /No blessings yet\./);
  const { text } = buildBlessingIndex([c("map/features/a", "Feature", "A\x1b", "# Blessings\n- Adding \x07x? Copy y because z.\n")], href);
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(text), JSON.stringify(text));
});

const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-blessidx-"));
  cpSync(FIXTURE, repo, { recursive: true });
  execFileSync(process.execPath, [BIN, "derive"], { cwd: repo, encoding: "utf8" });
  return repo;
};

test("render: the fixture's blessing index equals its golden; the agent index's reading path names it", () => {
  const repo = mkRepo();
  execFileSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.equal(readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8"), readFileSync(join(GOLDEN, "blessing-index-nextjs-supabase.md"), "utf8"));
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /choose patterns: `zdd\/blessing-index\.md` lists every blessing by its trigger question/);
  rmSync(repo, { recursive: true, force: true });
});

test("render --check: a stale, hand-edited or missing blessing index fails, naming it", () => {
  const repo = mkRepo();
  execFileSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  const check = () => spawnSync(process.execPath, [BIN, "render", "--check"], { cwd: repo, encoding: "utf8" });
  assert.equal(check().status, 0);
  appendFileSync(join(repo, "zdd", "map", "features", "things.md"), "- Deleting a thing? Soft-delete it, per ADR-0002.\n");
  let r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /blessing-index\.md/);
  execFileSync(process.execPath, [BIN, "render"], { cwd: repo, encoding: "utf8" });
  assert.match(readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8"), /- Deleting a thing\? — \[ADR-0002\]/);
  writeFileSync(join(repo, "zdd", "blessing-index.md"), "hand edit\n");
  assert.equal(check().status, 1);
  rmSync(join(repo, "zdd", "blessing-index.md"));
  r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /blessing-index\.md/);
  rmSync(repo, { recursive: true, force: true });
});
