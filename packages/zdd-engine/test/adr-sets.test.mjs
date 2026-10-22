// Two ADR sets (ZDD-1, decision 0033): an application set and, when the
// config names both paths, a harness set beside it, on one number line. On
// a scratch copy of the Next.js fixture with ADR-0001 moved to the harness
// set (ADR-0002, an application decision, supersedes it): an index per set,
// the other set's ADR marked and linked, lint across both, the duplicate
// number across folders, the paths checked, the agent index and the tally.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readStores } from "../src/tally.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");
const engine = (repo, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });

const HARNESS = { harnessAdrDir: "zdd/adr-harness", harnessAdrIndex: "zdd/adr-harness-index.md" };
const withPaths = (repo, paths) => {
  const cfg = join(repo, "zdd", "config.json");
  const c = JSON.parse(readFileSync(cfg, "utf8"));
  writeFileSync(cfg, JSON.stringify({ ...c, paths: { ...(c.paths ?? {}), ...paths } }, null, 2) + "\n");
};
const twoSets = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-adrsets-"));
  cpSync(FIXTURE, repo, { recursive: true });
  mkdirSync(join(repo, "zdd", "adr-harness"));
  renameSync(join(repo, "zdd", "adr", "0001-widgets-are-the-core-entity.md"), join(repo, "zdd", "adr-harness", "0001-widgets-are-the-core-entity.md"));
  // Its stamp's link now crosses folders.
  const moved = join(repo, "zdd", "adr-harness", "0001-widgets-are-the-core-entity.md");
  writeFileSync(moved, readFileSync(moved, "utf8").replace("](0002-things-replace-widgets.md)", "](../adr/0002-things-replace-widgets.md)"));
  withPaths(repo, HARNESS);
  assert.equal(engine(repo, "derive").status, 0);
  return repo;
};

test("render: one index per set — each lists only its own ADRs and says the numbers are shared; the other set's ADR is marked and linked; the agent index names both folders", () => {
  const repo = twoSets();
  const r = engine(repo, "render");
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /harnessAdrDir .* does not exist/, "a present harness folder is a present store");
  const app = readFileSync(join(repo, "zdd", "adr-index.md"), "utf8");
  const harness = readFileSync(join(repo, "zdd", "adr-harness-index.md"), "utf8");
  assert.match(app, /^# ADR index\n/);
  assert.match(app, /Numbers are shared with the harness set \(`zdd\/adr-harness-index\.md`\): a gap here is a decision there\./);
  assert.match(app, /^- \[ADR-0002\]\(adr\/0002-things-replace-widgets\.md\) — Things replace widgets/m);
  assert.doesNotMatch(app, /ADR-0001\]\(/, "the harness ADR is not in the application index");
  assert.match(harness, /^# ADR index — harness\n/);
  assert.match(harness, /^- \[ADR-0001\]\(adr-harness\/0001-widgets-are-the-core-entity\.md\) — Widgets are the core entity .*_\(superseded by \[ADR-0002\]\(adr\/0002-things-replace-widgets\.md\), application\)_$/m, harness);
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /Decisions: `zdd\/adr\/` \(application\), `zdd\/adr-harness\/` \(harness\)\./);
  // A first sentence's links to ADR files are rebased from the harness folder to the index's.
  writeFileSync(join(repo, "zdd", "adr-harness", "0003-review-runs-as-a-campaign.md"), "# Review runs as a campaign\n\nFollows [ADR-0002](../adr/0002-things-replace-widgets.md) and [ADR-0001](0001-widgets-are-the-core-entity.md) in spirit.\n");
  assert.equal(engine(repo, "render").status, 0);
  assert.match(readFileSync(join(repo, "zdd", "adr-harness-index.md"), "utf8"), /— Follows \[ADR-0002\]\(adr\/0002-things-replace-widgets\.md\) and \[ADR-0001\]\(adr-harness\/0001-widgets-are-the-core-entity\.md\) in spirit\./);
  rmSync(join(repo, "zdd", "adr-harness", "0003-review-runs-as-a-campaign.md"));
  assert.equal(engine(repo, "render").status, 0);
  assert.equal(engine(repo, "render", "--check").status, 0);
  writeFileSync(join(repo, "zdd", "adr-harness-index.md"), "hand edit\n");
  const check = engine(repo, "render", "--check");
  assert.equal(check.status, 1);
  assert.match(check.stderr, /adr-harness-index\.md/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: supersession and citations resolve across sets; one number across two folders is a duplicate, naming both; a blessing citing the superseded harness ADR fails", () => {
  const repo = twoSets();
  let r = engine(repo, "lint");
  assert.equal(r.status, 0, r.stderr);
  writeFileSync(join(repo, "zdd", "adr-harness", "0002-review-campaign.md"), "# Review campaign\n\nEvery PR gets one.\n");
  r = engine(repo, "lint");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /duplicate ADR number 0002: zdd\/adr\/0002-things-replace-widgets\.md and zdd\/adr-harness\/0002-review-campaign\.md — the two ADR sets share one number line \(decision 0033\)/);
  rmSync(join(repo, "zdd", "adr-harness", "0002-review-campaign.md"));
  writeFileSync(join(repo, "zdd", "blessings", "widgets.md"), "---\nwhere: src/app/page.tsx\nkind: copy\nadr: ADR-0001\n---\n\nAdding a widget? Copy it.\n");
  r = engine(repo, "lint");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /widgets\.md .*cites ADR-0001, which is superseded by ADR-0002/);
  rmSync(repo, { recursive: true, force: true });
});

test("the harness paths go together and stand apart: one without the other, or a harness folder inside the application folder, is refused by every command", () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-adrsets-cfg-"));
  cpSync(FIXTURE, repo, { recursive: true });
  withPaths(repo, { harnessAdrDir: "zdd/adr-harness" });
  for (const cmd of ["lint", "render", "derive"]) {
    const r = engine(repo, cmd);
    assert.equal(r.status, 1, cmd);
    assert.match(r.stderr, /paths\.harnessAdrDir is set but paths\.harnessAdrIndex is not/, cmd);
  }
  withPaths(repo, { harnessAdrDir: "zdd/adr/harness", harnessAdrIndex: "zdd/adr-harness-index.md" });
  const r = engine(repo, "lint");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /paths\.harnessAdrDir 'zdd\/adr\/harness' overlaps paths\.adrDir 'zdd\/adr' — the harness ADR set is a folder of its own/);
  withPaths(repo, { harnessAdrDir: "zdd/adr-harness", harnessAdrIndex: "zdd/adr-index.md" });
  assert.match(engine(repo, "lint").stderr, /overlaps/, "two indexes on one file");
  rmSync(repo, { recursive: true, force: true });
});

test("tally's stores and the one-set default: both folders' numbers are counted; without the harness keys nothing about the index changes", () => {
  const repo = twoSets();
  const s = readStores(repo, { adrDir: "zdd/adr", glossary: "zdd/glossary.md", blessingsDir: "zdd/blessings", ...HARNESS });
  assert.deepEqual(s.adrs, ["0001", "0002"]);
  rmSync(repo, { recursive: true, force: true });
  const one = mkdtempSync(join(tmpdir(), "zdd-adrsets-one-"));
  cpSync(FIXTURE, one, { recursive: true });
  engine(one, "derive");
  assert.equal(engine(one, "render").status, 0);
  assert.ok(!existsSync(join(one, "zdd", "adr-harness-index.md")), "no harness index without the keys");
  assert.doesNotMatch(readFileSync(join(one, "zdd", "adr-index.md"), "utf8"), /Numbers are shared/);
  assert.match(readFileSync(join(one, "zdd", "agent-index.md"), "utf8"), /Decisions: `zdd\/adr\/`\. Human index/);
  rmSync(one, { recursive: true, force: true });
});
