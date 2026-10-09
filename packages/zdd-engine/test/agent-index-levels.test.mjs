// CAS-103 pick 5: the agent index's budget is configurable and a large repo
// can ask for two levels — areas first, one file per area under
// `zdd/agent-index/`, each feature one hop away. Both are explicit settings
// (decision: never automatic), so the index's shape moves only when the
// config does. At one level the bytes are exactly the pre-2.3 bytes (the
// golden tests hold). Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveAgentIndexOptions, agentIndexAreaDir } from "../src/render.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-levels-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const run = (repo, args) => spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
// Merges into the fixture's own agentIndex block (it carries a summary line).
const config = (repo, patch) => {
  const p = join(repo, "zdd", "config.json");
  const cur = JSON.parse(readFileSync(p, "utf8"));
  writeFileSync(p, JSON.stringify({ ...cur, ...patch, agentIndex: { ...(cur.agentIndex ?? {}), ...(patch.agentIndex ?? {}) } }, null, 2));
};
const feature = (repo, name, tags, body = "") =>
  writeFileSync(join(repo, "zdd", "map", "features", `${name}.md`), `---\ntype: Feature\ntitle: ${name}\ndescription: ${name} feature\ntags: [${tags}]\n---\n\n${body}`);

test("options: the defaults, the two valid levels, a budget of at least 200; anything else is refused by name", () => {
  assert.deepEqual(resolveAgentIndexOptions({}), { levels: 1, budget: 2000 });
  assert.deepEqual(resolveAgentIndexOptions({ agentIndex: { summary: "x" } }), { levels: 1, budget: 2000 });
  assert.deepEqual(resolveAgentIndexOptions({ agentIndex: { levels: 2, budgetTokens: 4000 } }), { levels: 2, budget: 4000 });
  assert.match(resolveAgentIndexOptions({ agentIndex: { levels: 3 } }).error, /agentIndex\.levels' must be 1 .* or 2/);
  assert.match(resolveAgentIndexOptions({ agentIndex: { budgetTokens: 10 } }).error, /at least 200/);
  assert.match(resolveAgentIndexOptions({ agentIndex: [] }).error, /must be an object/);
  assert.equal(agentIndexAreaDir("zdd/agent-index.md"), "zdd/agent-index");
  assert.equal(agentIndexAreaDir("docs/AGENT.md"), "docs/AGENT");
});

test("one level: bytes unchanged; the budget warning names the fix (raise the budget, two levels, or entry points only) and never fails", (t) => {
  const repo = mkRepo(t);
  assert.equal(run(repo, ["derive"]).status, 0);
  const before = run(repo, ["render"]);
  assert.equal(before.status, 0, before.stderr);
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  config(repo, { agentIndex: { budgetTokens: 200 } });
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: agent index ≈\d+ tokens \(budget 200\) — raise agentIndex\.budgetTokens in zdd\/config\.json, set agentIndex\.levels to 2 \(areas first, then one file per area, each feature one hop away\), or link each feature's entry points only/, r.stderr);
  assert.equal(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), index, "the budget changes no bytes");
  config(repo, { agentIndex: { levels: 3 } });
  const bad = run(repo, ["render"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /agentIndex\.levels' must be 1/);
});

test("two levels: the index lists the areas with their features and a link each; one file per area under zdd/agent-index/ holds the sections with hrefs that climb out; render --check covers the area files and flags a stale one; back to one level removes the folder", (t) => {
  const repo = mkRepo(t);
  feature(repo, "billing", "billing", "- [Things](../../metadata/route/things.json)\n");
  feature(repo, "invoices", "billing");
  feature(repo, "untagged", "");
  config(repo, { agentIndex: { levels: 2 } });
  assert.equal(run(repo, ["derive"]).status, 0);
  const r = run(repo, ["render"]);
  assert.equal(r.status, 0, r.stderr);
  const index = readFileSync(join(repo, "zdd", "agent-index.md"), "utf8");
  assert.match(index, /^## Areas$/m);
  assert.match(index, /^- \[billing\]\(agent-index\/billing\.md\) — 2 features: billing, invoices$/m, index);
  assert.match(index, /^- \[things\]\(agent-index\/things\.md\) — 1 feature: Things$/m, index);
  assert.match(index, /^- \[Other\]\(agent-index\/other\.md\) — 1 feature: untagged$/m, "an untagged feature is Other, listed last");
  assert.ok(index.indexOf("[things]") < index.indexOf("[Other]"));
  assert.doesNotMatch(index, /^## Things$/m, "no feature section in the top index");
  const dir = join(repo, "zdd", "agent-index");
  assert.deepEqual(readdirSync(dir).sort(), ["billing.md", "other.md", "things.md"]);
  const billing = readFileSync(join(dir, "billing.md"), "utf8");
  assert.match(billing, /^# Fixture App — billing$/m, billing);
  assert.match(billing, /^## billing$/m);
  assert.match(billing, /^## invoices$/m);
  assert.match(billing, /\]\(\.\.\/metadata\/route\/things\.json\)/, "pointers climb out of the area folder");
  assert.match(billing, /\[the agent index\]\(\.\.\/agent-index\.md\)/);
  assert.equal(run(repo, ["render", "--check"]).status, 0);
  // A stale area file (an area that no longer exists) fails the check and is pruned by a render.
  writeFileSync(join(dir, "gone.md"), "# stale\n");
  const stale = run(repo, ["render", "--check"]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /agent-index\/gone\.md \(stale: no such area\)/);
  assert.equal(run(repo, ["render"]).status, 0);
  assert.ok(!existsSync(join(dir, "gone.md")));
  // Back to one level: the folder goes, the top index holds the sections again.
  config(repo, { agentIndex: { levels: 1 } });
  assert.equal(run(repo, ["render"]).status, 0);
  assert.ok(!existsSync(dir), "the area folder is removed");
  assert.match(readFileSync(join(repo, "zdd", "agent-index.md"), "utf8"), /^## Things$/m);
  assert.equal(run(repo, ["render", "--check"]).status, 0);
});
