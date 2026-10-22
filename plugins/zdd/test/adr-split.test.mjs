// split-adrs (ZDD-1, decision 0034): the opt-in step that splits one ADR set
// into an application set and a harness set. A Scope tag line decides and a
// sentence that starts with "Scope:" does not; the plan proposes and writes
// nothing; the write takes the plan's token and a set for every untagged ADR,
// and refuses whole before its first write; it moves the files with their
// numbers, re-points links inside the bundle, lists the ones outside, and
// the engine's render and lint are then green.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scopeTag, repointLinks, linksToMoved } from "../scripts/lib/adr-split.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");

let scratch;
before(() => (scratch = mkdtempSync(join(tmpdir(), "zdd-split-"))));
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const split = (repo, args) => spawnSync(process.execPath, [SCRIPT, "split-adrs", ...args, `--root=${repo}`, "--json"], { encoding: "utf8" });
const ok = (repo, args) => {
  const r = split(repo, args);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const engine = (repo, args) => spawnSync(process.execPath, [ENGINE_BIN, ...args, `--root=${repo}`], { encoding: "utf8" });
const tree = (dir) => {
  const out = {};
  const walk = (d, rel = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else out[r] = readFileSync(join(d, e.name), "utf8");
    }
  };
  walk(dir);
  return out;
};
// The engine fixture, with a map page and a README that link ADR-0001, and a
// third ADR tagged harness.
const adopter = (name) => {
  const repo = join(scratch, name);
  cpSync(join(ENGINE, "test", "fixture"), repo, { recursive: true });
  const glossary = join(repo, "zdd", "glossary.md");
  writeFileSync(glossary, readFileSync(glossary, "utf8") + "\nSee [the old entity](adr/0001-widgets-are-the-core-entity.md).\n");
  writeFileSync(join(repo, "README.md"), "# App\n\nWhy widgets: [ADR-0001](zdd/adr/0001-widgets-are-the-core-entity.md).\n");
  writeFileSync(join(repo, "zdd", "adr", "0003-review-runs-as-a-campaign.md"), "# Review runs as a campaign\n\n**Scope:** harness\n\nEvery PR gets one, per [ADR-0002](0002-things-replace-widgets.md).\n");
  assert.equal(engine(repo, ["derive"]).status, 0);
  return repo;
};

test("scopeTag: an exact Scope line decides, bold or not, quoted or not; a sentence that starts with Scope: decides nothing", () => {
  assert.equal(scopeTag("# X\n\nScope: harness\n"), "harness");
  assert.equal(scopeTag("**Scope:** product\n"), "application");
  assert.equal(scopeTag("> **Scope: harness**\n"), "harness");
  assert.equal(scopeTag("Scope: application.\r\n"), "application");
  // One adopter's ADR: an argument, not a tag.
  assert.equal(scopeTag("**Scope: a *saved* delivery address is not blocked.** That is the MQ picker's legitimate path."), null);
  assert.equal(scopeTag("Scope: harness and product both\n"), null);
  assert.equal(scopeTag("No tag at all.\n"), null);
});

test("repointLinks: a moved file's links, and links to it, still name the same files; bundle-absolute stays bundle-absolute; nothing else moves", () => {
  const moved = new Map([["zdd/adr/0001-a.md", "zdd/adr-harness/0001-a.md"]]);
  assert.equal(repointLinks("[b](0002-b.md) [self](0001-a.md#x) [u](https://x.y)", { oldRel: "zdd/adr/0001-a.md", newRel: "zdd/adr-harness/0001-a.md", moved, bundleDir: "zdd" }), "[b](../adr/0002-b.md) [self](0001-a.md#x) [u](https://x.y)");
  assert.equal(repointLinks("[a](../../adr/0001-a.md) [b](../../adr/0002-b.md) [abs](/adr/0001-a.md) [<a>](<../../adr/0001-a.md>)", { oldRel: "zdd/map/features/f.md", newRel: "zdd/map/features/f.md", moved, bundleDir: "zdd" }), "[a](../../adr-harness/0001-a.md) [b](../../adr/0002-b.md) [abs](/adr-harness/0001-a.md) [<a>](<../../adr-harness/0001-a.md>)");
  assert.deepEqual(linksToMoved("x\n[ADR-0001](zdd/adr/0001-a.md)\nsee zdd/adr/0001-a.md too\n", { fileRel: "README.md", moved, bundleDir: "zdd" }), [{ line: 2, link: "zdd/adr/0001-a.md" }, { line: 3, link: "zdd/adr/0001-a.md" }]);
});

test("split-adrs --plan proposes a set per ADR — a tag decides, the rest wait for the developer — and writes nothing", () => {
  const repo = adopter("plan");
  const before = tree(repo);
  const plan = ok(repo, ["--plan"]);
  assert.deepEqual(plan.proposals.map((p) => [p.num, p.tag]), [["0001", null], ["0002", null], ["0003", "harness"]]);
  assert.equal(plan.dir, "zdd/adr-harness");
  assert.match(plan.token, /^[0-9a-f]{8}$/);
  assert.ok(plan.notes.some((n) => /2 of 3 ADRs carry no Scope tag line — propose a set for each/.test(n)), plan.notes.join("\n"));
  assert.deepEqual(tree(repo), before);
});

test("the write is judged whole before its first byte: no token, a stale token, an untagged ADR left undecided, one named twice, a stranger — each refused, the repo as it was", () => {
  const repo = adopter("judged");
  const { token } = ok(repo, ["--plan"]);
  const before = tree(repo);
  for (const [args, why] of [
    [["--harness=0001", "--application=0002"], /split-adrs takes the token split-adrs --plan printed/],
    [["--token=deadbeef", "--harness=0001", "--application=0002"], /the ADRs changed since the plan/],
    [[`--token=${token}`, "--harness=0001"], /no set given for the untagged ADR ADR-0002 — name each in --harness or --application/],
    [[`--token=${token}`, "--harness=0001,0002", "--application=0002"], /ADR-0002 named in both --harness and --application/],
    [[`--token=${token}`, "--harness=0009", "--application=0001,0002"], /ADR-0009 is not in zdd\/adr\//],
    [[`--token=${token}`, "--harness=1", "--application=0002"], /--harness takes ADR numbers, four digits each/],
  ]) {
    const r = split(repo, args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, why);
    assert.deepEqual(tree(repo), before, `${args.join(" ")}: nothing written`);
  }
});

test("split-adrs moves the harness ADRs with their numbers, writes the two config keys, re-points links inside zdd/, lists the ones outside; render and lint are then green", () => {
  const repo = adopter("write");
  const { token } = ok(repo, ["--plan"]);
  const r = ok(repo, [`--token=${token}`, "--harness=0001", "--application=0002"]);
  assert.deepEqual(r.moved, [
    { from: "zdd/adr/0001-widgets-are-the-core-entity.md", to: "zdd/adr-harness/0001-widgets-are-the-core-entity.md" },
    { from: "zdd/adr/0003-review-runs-as-a-campaign.md", to: "zdd/adr-harness/0003-review-runs-as-a-campaign.md" },
  ], "0003 by its tag, 0001 by the developer's word");
  assert.ok(!existsSync(join(repo, "zdd", "adr", "0001-widgets-are-the-core-entity.md")));
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  assert.deepEqual([cfg.paths.harnessAdrDir, cfg.paths.harnessAdrIndex], ["zdd/adr-harness", "zdd/adr-harness-index.md"]);
  assert.match(readFileSync(join(repo, "zdd", "adr-harness", "0001-widgets-are-the-core-entity.md"), "utf8"), /\*\*Superseded by \[ADR-0002\]\(\.\.\/adr\/0002-things-replace-widgets\.md\)\*\*/, "a moved ADR's link to one that stayed");
  assert.match(readFileSync(join(repo, "zdd", "adr-harness", "0003-review-runs-as-a-campaign.md"), "utf8"), /per \[ADR-0002\]\(\.\.\/adr\/0002-things-replace-widgets\.md\)/);
  assert.match(readFileSync(join(repo, "zdd", "glossary.md"), "utf8"), /See \[the old entity\]\(adr-harness\/0001-widgets-are-the-core-entity\.md\)\./);
  assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "# App\n\nWhy widgets: [ADR-0001](zdd/adr/0001-widgets-are-the-core-entity.md).\n", "outside zdd/ nothing is written");
  assert.ok(r.notes.some((n) => /^README\.md:3 still points at zdd\/adr\/0001-widgets-are-the-core-entity\.md — now zdd\/adr-harness\/0001-widgets-are-the-core-entity\.md; ZDD never edits outside zdd\//.test(n)), r.notes.join("\n"));
  { const rr = engine(repo, ["render"]); assert.equal(rr.status, 0, rr.stderr + rr.stdout); }
  assert.match(readFileSync(join(repo, "zdd", "adr-harness-index.md"), "utf8"), /^- \[ADR-0001\]\(adr-harness\/0001-widgets-are-the-core-entity\.md\)/m);
  const lint = engine(repo, ["lint"]);
  assert.equal(lint.status, 0, lint.stderr);
});

test("split-adrs with nothing to move still opens the set: the config keys and an empty folder", () => {
  const repo = adopter("empty");
  rmSync(join(repo, "zdd", "adr", "0003-review-runs-as-a-campaign.md"));
  const { token } = ok(repo, ["--plan"]);
  const r = ok(repo, [`--token=${token}`, "--application=0001,0002"]);
  assert.deepEqual(r.moved, []);
  assert.ok(existsSync(join(repo, "zdd", "adr-harness", ".gitkeep")));
  { const rr = engine(repo, ["render"]); assert.equal(rr.status, 0, rr.stderr + rr.stdout); }
  assert.ok(existsSync(join(repo, "zdd", "adr-harness-index.md")));
});

test("artifactPaths reads the harness pair like the engine: both or neither, apart from the application folder and from the blessing store; strict throws, lenient drops the pair (CR-008's harness half)", async () => {
  const { artifactPaths } = await import("../scripts/lib/repo.mjs");
  const both = artifactPaths({ paths: { harnessAdrDir: "zdd/adr-harness", harnessAdrIndex: "zdd/adr-harness-index.md" } });
  assert.deepEqual([both.harnessAdrDir, both.harnessAdrIndex], ["zdd/adr-harness", "zdd/adr-harness-index.md"]);
  assert.equal(artifactPaths({}).harnessAdrDir, undefined, "absent by default");
  assert.throws(() => artifactPaths({ paths: { harnessAdrDir: "zdd/adr-harness" } }), /paths\.harnessAdrDir is set but paths\.harnessAdrIndex is not/);
  assert.equal(artifactPaths({ paths: { harnessAdrDir: "zdd/adr-harness" } }, { lenient: true }).harnessAdrDir, undefined);
  assert.throws(() => artifactPaths({ paths: { harnessAdrDir: "zdd/adr/h", harnessAdrIndex: "zdd/h.md" } }), /overlaps paths\.adrDir/);
  assert.throws(() => artifactPaths({ paths: { harnessAdrDir: "zdd/h", harnessAdrIndex: "zdd/h.md", blessingsDir: "zdd/h/b" } }), /paths\.blessingsDir "zdd\/h\/b" overlaps paths\.harnessAdrDir/);
  assert.throws(() => artifactPaths({ paths: { harnessAdrDir: "zdd/h", harnessAdrIndex: "zdd/adr-index.md" } }), /paths\.adrIndex and paths\.harnessAdrIndex are both "zdd\/adr-index\.md"/);
});

test("ZDD's instructions name the harness index only when the set is configured; without it the text is unchanged", async () => {
  const { instructionsBody } = await import("../scripts/bootstrap.mjs");
  const plain = instructionsBody({});
  assert.doesNotMatch(plain, /harness/i);
  const two = instructionsBody({ harnessAdrDir: "zdd/adr-harness", harnessAdrIndex: "zdd/adr-harness-index.md" });
  assert.match(two, /`zdd\/adr-index\.md` whole \(and `zdd\/adr-harness-index\.md`, the harness decisions, when the work touches how the team builds\), and the ADRs your task/);
  assert.match(two, /`zdd\/adr-index\.md`, `zdd\/adr-harness-index\.md`, `zdd\/blessing-index\.md`,/);
  assert.equal(two.replace(/ \(and `zdd\/adr-harness-index\.md`[^)]*\)/, "").replace(" `zdd/adr-harness-index.md`,", ""), plain);
});
