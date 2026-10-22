// "upgrade ZDD" moves blessings out of the semantic map (ZDD-1, decision
// 0032): the plugin's parser agrees with the engine's on the same pages, the
// proposal reads where, applies-to and first-built-in off the page, the plan
// writes nothing, a plain upgrade writes no blessing, --move-blessings writes
// the confirmed list and the engine's lint is then green, and a blessing that
// cannot move stays and is named.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findMapBlessings, proposeMove, blessingSlug, rebaseLinks, removeMoved, blessingFileText, triggerQuestion } from "../scripts/lib/blessing-move.mjs";
import { extractBlessings, blessingShape } from "../../../packages/zdd-engine/src/lib/map-links.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(PLUGIN, "scripts", "bootstrap.mjs");
const ENGINE = resolve(PLUGIN, "..", "..", "packages", "zdd-engine");
const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;

let scratch, home;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "zdd-bless-move-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});
after(() => scratch && rmSync(scratch, { recursive: true, force: true }));

const run = (root, args) => execFileSync(process.execPath, [SCRIPT, ...args, `--root=${root}`, `--home=${home}`], { encoding: "utf8" });
const runJson = (root, args) => JSON.parse(run(root, [...args, "--json"]));
const engine = (root, args) => spawnSync(process.execPath, [ENGINE_BIN, ...args, `--root=${root}`], { encoding: "utf8" });

// The engine fixture as a 2.4 adopter had it: blessings on the map pages, no
// blessing store, metadata derived.
const APP_PAGE = `---
type: Application
title: Fixture App
description: The fixture Next.js app the engine tests derive against.
resource: src
tags: [things]
---

A deliberately tiny Next.js App Router app: one feature, one wrapper page,
one hooks route pair, two migrations.

- [Things](../features/things.md)

# Blessings
- Adding a page? Make it a thin wrapper over a component in \`src/components/\`,
  as \`src/app/page.tsx\` does, because the component is what a test renders —
  never logic in the page file.
`;
const THINGS_PAGE = `---
type: Feature
title: Things
description: CRUD for things with an audit trail (ADR-0002).
resource: src/components
tags: [things]
---

The things catalogue: list, edit, and audit things.

- [things table](../../metadata/table/db--things.json)
- [/api/things](../../metadata/route/things.json)

# Blessings
- Adding an endpoint for things? Copy [/api/things](../../metadata/route/things.json),
  per ADR-0002 — never a route named for widgets.
- Saving a thing? Call \`migrations/00002_things.sql\` (\`save_thing\`) and extend it,
  because the function is what logs the change.

# Notes
Kept as written.
`;
const adopter = (name) => {
  const repo = join(scratch, name);
  cpSync(join(ENGINE, "test", "fixture"), repo, { recursive: true });
  rmSync(join(repo, "zdd", "blessings"), { recursive: true, force: true });
  const cfg = JSON.parse(readFileSync(join(repo, "zdd", "config.json"), "utf8"));
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ ...cfg, engine: "2.4.1" }, null, 2) + "\n");
  writeFileSync(join(repo, "zdd", "map", "apps", "fixture-app.md"), APP_PAGE);
  writeFileSync(join(repo, "zdd", "map", "features", "things.md"), THINGS_PAGE);
  assert.equal(engine(repo, ["derive"]).status, 0);
  return repo;
};

test("findMapBlessings agrees with the engine's extractBlessings: the same items, texts, citations and lines, fences and comments included", () => {
  const bodies = [
    APP_PAGE,
    THINGS_PAGE,
    "# Blessings\n```md\n# Example\n- copy x, per ADR-9999\n```\n- Real? the real one, per ADR-0002\n",
    "# Blessings\n<!-- - hidden ADR-0001 -->\n- Shown? per ADR-0003\n  wrapped ADR-0004\n\n- After a blank? ADR 0005\n## Next\n- not one\n",
    "intro\r\n# Blessing\r\n- crlf? ADR-0002\r\n",
    "  # Blessings\n1. Numbered? per ADR-0006\n* Star? yes\n",
  ];
  for (const page of bodies) {
    const fm = /^---\n[\s\S]*?\n---\n?/.exec(page.replace(/\r\n/g, "\n"));
    const body = fm ? page.replace(/\r\n/g, "\n").slice(fm[0].length) : page;
    const engineSide = extractBlessings(body).map((b) => ({ text: b.text, adrs: b.adrs, line: b.line }));
    const pluginSide = findMapBlessings(page).items.map((b) => ({ text: b.text, adrs: b.adrs, line: b.line }));
    assert.deepEqual(pluginSide, engineSide, page);
    for (const b of findMapBlessings(page).items) assert.equal(triggerQuestion(b.text), blessingShape(b.text).question, b.text);
  }
});

test("proposeMove: where from a code span naming a file (the next identifier span is its symbol), or from a metadata link through its record; applies-to only from an app or package page; links rebased", () => {
  const repo = adopter("propose");
  const ctx = (page, pageType) => ({
    page,
    pageType,
    mapDir: "zdd/map",
    blessingsDir: "zdd/blessings",
    bundleDir: "zdd",
    metadataDir: "zdd/metadata",
    adrDir: "zdd/adr",
    isFile: (r) => existsSync(join(repo, r)) && !r.endsWith("/") && readdirSafe(join(repo, r)) === null,
    readRecord: (r) => JSON.parse(readFileSync(join(repo, r), "utf8")),
  });
  const [page] = findMapBlessings(APP_PAGE).items;
  const p = proposeMove(page, ctx("zdd/map/apps/fixture-app.md", "Application"));
  assert.equal(p.where, "src/app/page.tsx", "a folder span is no file; the next span is");
  assert.equal(p.appliesTo, "apps/fixture-app");
  assert.equal(p.firstBuiltIn, "apps/fixture-app");
  assert.equal(p.kind, "copy");
  assert.equal(p.problem, null);
  const [endpoint, saving] = findMapBlessings(THINGS_PAGE).items;
  const e = proposeMove(endpoint, ctx("zdd/map/features/things.md", "Feature"));
  assert.equal(e.where, "src/app/api/things/route.ts", "a metadata link names its record's one file");
  assert.equal(e.appliesTo, null);
  assert.deepEqual(e.adrs, ["0002"]);
  assert.match(e.text, /\]\(\.\.\/metadata\/route\/things\.json\)/, "rebased from zdd/map/features to zdd/blessings");
  const s = proposeMove(saving, ctx("zdd/map/features/things.md", "Feature"));
  assert.deepEqual([s.where, s.symbol, s.kind], ["migrations/00002_things.sql", "save_thing", "extend"]);
  assert.equal(proposeMove({ text: "Copy x.", adrs: [] }, ctx("zdd/map/features/things.md", "Feature")).problem.startsWith("it opens with no trigger question"), true);
  assert.match(proposeMove({ text: "Adding x? Copy the way we do it.", adrs: [] }, ctx("zdd/map/features/things.md", "Feature")).problem, /no link or path in it names a repo file/);
});
const readdirSafe = (p) => {
  try {
    return readdirSync(p);
  } catch {
    return null;
  }
};

test("blessingSlug, rebaseLinks and blessingFileText", () => {
  assert.equal(blessingSlug("Adding an endpoint for things?"), "adding-an-endpoint-for-things");
  assert.equal(blessingSlug("A refusal that has to `name` things (an email now; Salesforce later)?"), "a-refusal-that-has-to-name-things-an-email-now-salesforce");
  assert.equal(rebaseLinks("[a](../../metadata/x.json#f) [b](https://x.y) [c](/metadata/y.json) [d](<../../adr/0001 x.md>)", "zdd/map/features", "zdd/blessings"), "[a](../metadata/x.json#f) [b](https://x.y) [c](/metadata/y.json) [d](<../adr/0001 x.md>)");
  assert.equal(
    blessingFileText({ where: "a.ts", symbol: "f", kind: "extend", appliesTo: "apps/web", firstBuiltIn: "apps/web", adrs: ["0001", "0002"], text: "Adding X? Extend f." }),
    "---\nwhere: a.ts (f)\nkind: extend\napplies-to: apps/web\nfirst-built-in: apps/web\nadr: ADR-0001, ADR-0002\n---\n\nAdding X? Extend f.\n",
  );
});

test("removeMoved: only the moved items go; an emptied section loses its heading and the blank lines before it; a section with a fenced example or an item left keeps its heading; CRLF is kept", () => {
  const found = findMapBlessings(THINGS_PAGE);
  assert.equal(removeMoved(THINGS_PAGE, found, found.items), THINGS_PAGE.replace(/# Blessings\n[\s\S]*?\n\n(?=# Notes)/, ""), "the blank line before the heading stays, to part the page from the next heading");
  assert.match(removeMoved(THINGS_PAGE, found, [found.items[0]]), /# Blessings\n- Saving a thing\?/);
  const fenced = "x\n\n# Blessings\n```md\n# Example\n```\n- Moved? a\n";
  const f = findMapBlessings(fenced);
  assert.equal(removeMoved(fenced, f, f.items), "x\n\n# Blessings\n```md\n# Example\n```\n");
  const crlf = "x\r\n\r\n# Blessings\r\n- Moved? a\r\n";
  const c = findMapBlessings(crlf);
  assert.equal(removeMoved(crlf, c, c.items), "x\r\n");
});

test("upgrade --plan lists every blessing with what the move would write and writes nothing; a plain upgrade moves none and says how", () => {
  const repo = adopter("plan");
  const plan = runJson(repo, ["upgrade", "--plan"]);
  assert.deepEqual(plan.blessingMoves.proposals.map((p) => [p.id, p.from, p.where, p.kind, p.appliesTo]), [
    ["adding-a-page", "zdd/map/apps/fixture-app.md:15", "src/app/page.tsx", "copy", "apps/fixture-app"],
    ["adding-an-endpoint-for-things", "zdd/map/features/things.md:15", "src/app/api/things/route.ts", "copy", null],
    ["saving-a-thing", "zdd/map/features/things.md:17", "migrations/00002_things.sql", "extend", null],
  ]);
  assert.ok(!existsSync(join(repo, "zdd", "blessings")), "nothing written");
  const text = run(repo, ["upgrade", "--plan"]);
  assert.match(text, /blessing zdd\/map\/features\/things\.md:17: "Saving a thing\?"\n {6}→ zdd\/blessings\/saving-a-thing\.md\n {8}where: migrations\/00002_things\.sql \(save_thing\)\n {8}kind: extend \(proposed — .*--kinds=saving-a-thing:copy\)/, text);
  const plain = runJson(repo, ["upgrade"]);
  assert.ok(!existsSync(join(repo, "zdd", "blessings")), "a plain upgrade moves no blessing");
  assert.ok(plain.notes.some((n) => /3 blessings still on map pages .*run upgrade again with --move-blessings/.test(n)), plain.notes.join("\n"));
  const lint = engine(repo, ["lint"]);
  assert.equal(lint.status, 1, "lint fails while blessings stay in the map");
  assert.match(lint.stderr, /fixture-app\.md: holds 1 blessing under a Blessings heading .*say "upgrade ZDD"/);
});

test("upgrade --move-blessings writes the confirmed list, a --kinds answer included, and the engine's lint and render are then green", () => {
  const repo = adopter("move");
  const r = runJson(repo, ["upgrade", "--move-blessings", "--kinds=adding-an-endpoint-for-things:extend"]);
  assert.deepEqual(r.blessingMoves.moved.map((p) => p.id), ["adding-a-page", "adding-an-endpoint-for-things", "saving-a-thing"]);
  assert.equal(
    readFileSync(join(repo, "zdd", "blessings", "adding-an-endpoint-for-things.md"), "utf8"),
    "---\nwhere: src/app/api/things/route.ts\nkind: extend\nfirst-built-in: features/things\nadr: ADR-0002\n---\n\nAdding an endpoint for things? Copy [/api/things](../metadata/route/things.json),\nper ADR-0002 — never a route named for widgets.\n",
  );
  const things = readFileSync(join(repo, "zdd", "map", "features", "things.md"), "utf8");
  assert.doesNotMatch(things, /Blessings/);
  assert.match(things, /- \[\/api\/things\]\(\.\.\/\.\.\/metadata\/route\/things\.json\)\n\n# Notes\nKept as written\.\n$/, "every other byte kept");
  assert.ok(r.notes.some((n) => n === "zdd/map/features/things.md: 2 blessings moved to zdd/blessings/ (2.5, decision 0032)"), r.notes.join("\n"));
  const lint = engine(repo, ["lint"]);
  assert.equal(lint.status, 0, lint.stderr);
  assert.equal(engine(repo, ["render"]).status, 0);
  const index = readFileSync(join(repo, "zdd", "blessing-index.md"), "utf8");
  assert.match(index, /extend: `migrations\/00002_things\.sql` \(save_thing\), used by 1: \/api\/things\/\[id\]/);
  const again = runJson(repo, ["upgrade", "--move-blessings"]);
  assert.deepEqual(again.blessingMoves.proposals, [], "a second run finds nothing to move");
  assert.equal(VERSION.split(".")[0] >= "2", true);
});

test("a blessing that cannot move stays on its page and is named; the others move; --kinds is checked", () => {
  const repo = adopter("left");
  writeFileSync(join(repo, "zdd", "map", "features", "things.md"), THINGS_PAGE.replace("# Notes", "- Copy the audit call, per ADR-0002.\n- Adding a report? Do it the usual way.\n\n# Notes"));
  const r = runJson(repo, ["upgrade", "--move-blessings"]);
  assert.deepEqual(r.blessingMoves.left.map((p) => p.from), ["zdd/map/features/things.md:20", "zdd/map/features/things.md:21"]);
  assert.ok(r.notes.some((n) => /^zdd\/map\/features\/things\.md:20: this blessing cannot move — it opens with no trigger question/.test(n)), r.notes.join("\n"));
  const things = readFileSync(join(repo, "zdd", "map", "features", "things.md"), "utf8");
  assert.match(things, /# Blessings\n\n- Copy the audit call, per ADR-0002\.\n- Adding a report\? Do it the usual way\.\n\n# Notes/, "only the moved items' lines go");
  assert.equal(engine(repo, ["lint"]).status, 1);
  const bad = spawnSync(process.execPath, [SCRIPT, "upgrade", "--plan", "--kinds=adding-a-page:imitate", `--root=${repo}`, `--home=${home}`], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--kinds takes <file name>:<copy\|extend> pairs/);
  const unknown = spawnSync(process.execPath, [SCRIPT, "upgrade", "--plan", "--kinds=no-such-blessing:copy", `--root=${repo}`, `--home=${home}`], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /--kinds names no-such-blessing, which this run does not propose/);
});
