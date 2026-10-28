// The blessing lints (1.1.0; the blessing store since ZDD-1, decision
// 0031). A blessing that cites a fully superseded ADR, or one that does not
// exist, fails `zdd-engine lint`; a citation of an ADR superseded in part is
// a WARNING on stderr and exit 0. The blessing's shape (2.0.0): no trigger
// question fails; no reason (neither an ADR nor "because …") and over the
// length budget warn. Its header (decision 0031): no `where`, a `where` that
// names no file in the repo, no `kind` or a wrong one, and an `applies-to`
// that names no app or package page fail; an unknown `first-built-in` or
// header key warns. A Blessings section left on a map page fails, naming the
// upgrade. The pattern plan warns, and fails with --merge. Observed at the
// CLI seam on scratch copies of the Next.js fixture (whose ADR-0001 is
// superseded by ADR-0002), plus the parsers on their own.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractBlessings, forwardStamps, blessingShape } from "../src/core/lib/map-links.mjs";
import { parseWhere, readBlessing, usersOf, highBudget } from "../src/core/lib/blessings.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-bless-"));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const lint = (repo) => spawnSync(process.execPath, [BIN, "lint"], { cwd: repo, encoding: "utf8" });
// One blessing file. `header` is the lines between the fences; the default
// names a real file of the fixture and a kind, so a test states only what it
// is about.
const bless = (repo, id, text, header = "where: src/app/page.tsx\nkind: copy") =>
  writeFileSync(join(repo, "zdd", "blessings", `${id}.md`), `---\n${header}\n---\n\n${text}\n`);
const concept = (repo, name, body) =>
  writeFileSync(join(repo, "zdd", "map", "features", `${name}.md`), `---\ntype: Feature\ntitle: ${name}\ndescription: test\nresource: src\ntags: [${name}]\n---\n\n${body}`);

test("extractBlessings: items under a Blessings heading of any level, wrapped lines joined, citations in every spelling, other sections ignored", () => {
  const body = [
    "Intro paragraph mentioning ADR-0009 (not a blessing).",
    "",
    "# Edges",
    "- an edge per ADR-0008",
    "",
    "## Blessings",
    "- Adding a route? copy [x](/metadata/route/x.json), per ADR-0012 — never inline auth.",
    "* Saving? go through the RPC per [ADR-0005](../../adr/0005-x.md); see also ADR-0005 again",
    "  and ADR-0006 on the wrapped line.",
    "1. A numbered one with no citation at all",
    "",
    "- after a blank line, still in the section, ADR 0007",
    "# Key paths",
    "- `src/` per ADR-0099",
  ].join("\n");
  const found = extractBlessings(body);
  assert.deepEqual(
    found.map((b) => b.adrs),
    [["0012"], ["0005", "0006"], [], ["0007"]],
  );
  assert.deepEqual(found.map((b) => b.line), [7, 8, 10, 12]);
  assert.match(found[1].text, /wrapped line/);
  assert.deepEqual(extractBlessings("# Blessing\n- singular heading ADR-0001\n").map((b) => b.adrs), [["0001"]]);
  assert.deepEqual(extractBlessings("no section\n- ADR-0001\n"), []);
  assert.deepEqual(extractBlessings("# Blessings\r\n- crlf ADR-0002\r\n").map((b) => b.adrs), [["0002"]]);
});

test("forwardStamps: full and partial stamps, bold or plain, linked or bare", () => {
  const text = [
    "# Old",
    "> **Superseded by [ADR-0002](0002-x.md)** (2026-01-02): renamed.",
    "**Superseded in part by ADR-0031** (2026-08-01): one rule moved.",
    "Superseded in part by [ADR-0087](0087-y.md) — plain paragraph.",
    "This supersedes ADR-0001 — the active claim is not a stamp.",
  ].join("\n");
  assert.deepEqual(forwardStamps(text), [
    { partial: false, by: "0002" },
    { partial: true, by: "0031" },
    { partial: true, by: "0087" },
  ]);
});

test("lint: a blessing citing a fully superseded ADR fails, naming the file, the blessing and the superseding ADR", () => {
  const repo = mkRepo();
  bless(repo, "adding-a-widget", "Adding a widget? copy `src/widgets.ts`, per ADR-0001 — never ad-hoc SQL.");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Store lints failed \(1\)/);
  assert.match(r.stderr, /zdd\/blessings\/adding-a-widget\.md \(blessing: "Adding a widget\? copy/, "file and excerpt");
  assert.match(r.stderr, /cites ADR-0001, which is superseded by ADR-0002/);
  assert.match(r.stderr, /re-bless under the current decision, or drop the blessing/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: a blessing citing the current ADR passes; citing a non-existent ADR fails; the header's adr: is a citation too", () => {
  const repo = mkRepo();
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /store lints passed/);
  assert.equal(r.stderr, "", "the fixture's three blessings are clean");
  bless(repo, "ghost", "Copying a ghost? Copy nothing.", "where: src/app/page.tsx\nkind: copy\nadr: ADR-0042");
  r = lint(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ghost\.md .*cites ADR-0042, which does not exist/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: a partial supersession and a reasonless blessing are WARNING lines, exit 0; an inline 'because' is a reason", () => {
  const repo = mkRepo();
  const adrDir = join(repo, "zdd", "adr");
  writeFileSync(join(adrDir, "0003-things-get-audit.md"), "# Things get an audit trail\n\nThis supersedes ADR-0002 in part: the audit half.\n");
  writeFileSync(join(adrDir, "0002-things-replace-widgets.md"), "# Things replace widgets\n\n**Superseded in part by ADR-0003** (2026-02-01): the audit half.\n\nThis supersedes ADR-0001: the core entity is renamed.\n");
  bless(repo, "auditing-a-change", "Auditing a change? Copy the audit log — no decision named.");
  bless(repo, "naming-a-file", "Naming a file? Use kebab-case because the deploy is case-sensitive.");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /store lints passed/);
  assert.match(r.stderr, /^WARNING: zdd\/blessings\/adding-an-endpoint-for-things\.md .*cites ADR-0002, superseded in part by ADR-0003/m);
  assert.match(r.stderr, /^WARNING: zdd\/blessings\/auditing-a-change\.md .*gives no reason — cite the ADR that blessed it \('adr:'\), or say why inline/m);
  assert.doesNotMatch(r.stderr, /naming-a-file\.md .*gives no reason/, "a 'because' clause is a reason; no ADR is required");
  rmSync(repo, { recursive: true, force: true });
});

test("lint (2.0.0): a blessing that opens with no trigger question FAILS, naming the fix; a question after the first sentence is not one", () => {
  const repo = mkRepo();
  bless(repo, "a", "Copy the things route, per ADR-0002.");
  bless(repo, "b", "Copy it. Adding a route? per ADR-0002.");
  bless(repo, "c", "Adding a route (any route; even a hook)? Copy [/api/things](../metadata/route/things.json?x=1), per ADR-0002.");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Store lints failed \(2\)/);
  assert.match(r.stderr, /blessings\/a\.md .*opens with no trigger question — start it with the question it answers/);
  assert.match(r.stderr, /blessings\/b\.md .*opens with no trigger question/);
  assert.doesNotMatch(r.stderr, /blessings\/c\.md .*trigger question/, "a semicolon inside the question, and a ? inside a URL, are fine");
  rmSync(repo, { recursive: true, force: true });
});

test("lint (2.0.0): over the length budget is a WARNING; link targets do not count, link text does", () => {
  const repo = mkRepo();
  bless(repo, "long", "Adding a route? " + "word ".repeat(60) + "per ADR-0002.");
  bless(repo, "linky", `Adding a route? Copy [x](../metadata/route/${"a".repeat(400)}.json), per ADR-0002.`);
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^WARNING: zdd\/blessings\/long\.md .*is 329 characters \(budget 300\) — .*the detail belongs in the ADR/m);
  assert.doesNotMatch(r.stderr, /linky\.md .*characters/);
  rmSync(repo, { recursive: true, force: true });
});

test("decision 0031: a Blessings section left on a map page FAILS, naming the count and the upgrade that moves it", () => {
  const repo = mkRepo();
  concept(repo, "widgets", "# Blessings\n- Adding a widget? Copy `src/app/page.tsx`, per ADR-0002.\n- Naming one? Kebab-case.\n");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /zdd\/map\/features\/widgets\.md: holds 2 blessings under a Blessings heading — since 2\.5 a blessing is a file of its own in zdd\/blessings\/ .*say "upgrade ZDD", which moves them/);
  rmSync(repo, { recursive: true, force: true });
});

test("decision 0031: the header — where must name a file inside the repo, kind must be copy or extend, applies-to must be an app or package page", () => {
  const repo = mkRepo();
  bless(repo, "no-where", "Adding a page? Copy it because x.", "kind: copy");
  bless(repo, "gone", "Adding a page? Copy it because x.", "where: src/app/gone.tsx\nkind: copy");
  bless(repo, "folder", "Adding a page? Copy it because x.", "where: src/app\nkind: copy");
  bless(repo, "outside", "Adding a page? Copy it because x.", "where: ../outside.ts\nkind: copy");
  bless(repo, "absolute", "Adding a page? Copy it because x.", "where: /etc/passwd\nkind: copy");
  bless(repo, "no-kind", "Adding a page? Copy it because x.", "where: src/app/page.tsx");
  bless(repo, "bad-kind", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: imitate");
  bless(repo, "feature-rule", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\napplies-to: features/things");
  bless(repo, "no-page", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\napplies-to: apps/nowhere");
  bless(repo, "no-header", "Adding a page? Copy it because x.", "");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /no-where\.md .*has no 'where:' — name the code to start from/);
  assert.match(r.stderr, /gone\.md .*'where: src\/app\/gone\.tsx' names no file in the repo — the exemplar moved or was deleted/);
  assert.match(r.stderr, /folder\.md .*'where: src\/app' names no file in the repo/);
  assert.match(r.stderr, /outside\.md .*'where: \.\.\/outside\.ts' is not a path inside the repo/);
  assert.match(r.stderr, /absolute\.md .*'where: \/etc\/passwd' is not a path inside the repo/);
  assert.match(r.stderr, /no-kind\.md .*has no 'kind:' — 'copy' \(imitate this method\) or 'extend'/);
  assert.match(r.stderr, /bad-kind\.md .*'kind: imitate' is neither 'copy' nor 'extend'/);
  assert.match(r.stderr, /feature-rule\.md .*'applies-to: features\/things' is a Feature page — a house rule applies to an app or a package/);
  assert.match(r.stderr, /no-page\.md .*'applies-to: apps\/nowhere' names no semantic-map page/);
  assert.match(r.stderr, /no-header\.md .*has no 'where:'/);
  assert.match(r.stderr, /no-header\.md .*has no 'kind:'/);
  assert.match(r.stderr, /Store lints failed \(11\)/);
  rmSync(repo, { recursive: true, force: true });
});

test("decision 0031: an unknown first-built-in and an unknown header key are WARNINGS, exit 0", () => {
  const repo = mkRepo();
  bless(repo, "lost", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\nfirst-built-in: features/nowhere\napply-to: apps/fixture-app");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^WARNING: zdd\/blessings\/lost\.md .*'first-built-in: features\/nowhere' names no semantic-map page/m);
  assert.match(r.stderr, /^WARNING: zdd\/blessings\/lost\.md .*has header line ZDD does not read \(apply-to\) — the header is where, kind, applies-to, first-built-in, adr, importance$/m);
  rmSync(repo, { recursive: true, force: true });
});

test("ZDD-7 (decision 0045): importance is 'high' or absent — any other value FAILS, case-exact, naming the fix; high passes", () => {
  const repo = mkRepo();
  bless(repo, "shouting", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\nimportance: High");
  bless(repo, "critical", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\nimportance: critical");
  bless(repo, "low", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\nimportance: low");
  bless(repo, "blank", "Adding a page? Copy it because x.", "where: src/app/page.tsx\nkind: copy\nimportance:");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /shouting\.md .*'importance: High' is not 'high' — write 'importance: high' for a blessing that is often needed and costly to reinvent, or remove the line for a normal one/);
  assert.match(r.stderr, /critical\.md .*'importance: critical' is not 'high'/);
  assert.match(r.stderr, /low\.md .*'importance: low' is not 'high'/);
  assert.match(r.stderr, /blank\.md .*'importance: ' is not 'high'/);
  assert.match(r.stderr, /Store lints failed \(4\)/);
  assert.doesNotMatch(r.stderr, /does not read/, "importance is a header key ZDD reads");
  rmSync(repo, { recursive: true, force: true });
});

test("ZDD-7 (decision 0045): more high blessings than a fifth of the store (at least one allowed) is a WARNING, exit 0, naming them", () => {
  assert.deepEqual([0, 1, 3, 4, 5, 9, 10, 14, 15, 60].map(highBudget), [1, 1, 1, 1, 1, 1, 2, 2, 3, 12]);
  const repo = mkRepo();
  // The fixture: three blessings, one of them high — at the budget, no warning.
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /importance: high'/);
  bless(repo, "showing-details", "Showing details? Copy it because x.", "where: src/app/page.tsx\nkind: copy\nimportance: high");
  r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^WARNING: 2 of 4 blessings are 'importance: high' \(at most 1: a fifth of the store, at least one\) — keep high for a blessing that is often needed and costly to reinvent; a pin on many pins none \(zdd\/blessings\/saving-a-thing\.md, zdd\/blessings\/showing-details\.md\)$/m);
  // Ten blessings allow two high: six normal ones lift the budget.
  for (let i = 0; i < 6; i++) bless(repo, `normal-${i}`, `Adding page ${i}? Copy it because x.`);
  r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /importance: high'/);
  rmSync(repo, { recursive: true, force: true });
});

test("parseWhere and readBlessing: a path with an optional symbol; the header's adr and the text's citations both count, header first", () => {
  assert.deepEqual(parseWhere("apps/api/decisions.py (RefundRefusal)"), { path: "apps/api/decisions.py", symbol: "RefundRefusal" });
  assert.deepEqual(parseWhere("`src\\lib\\upload.ts`"), { path: "src/lib/upload.ts", symbol: null });
  assert.deepEqual(parseWhere("./a.ts (`f`)"), { path: "a.ts", symbol: "f" });
  assert.equal(parseWhere(""), null);
  const b = readBlessing("---\nwhere: a.ts\nkind: extend\nadr: ADR-0009\napplies-to: apps/web.md\n---\n\nAdding X?\nCopy y, per ADR-0003 and ADR-0009.\n", "adding-x");
  assert.deepEqual(b.adrs, ["0009", "0003"]);
  assert.equal(b.text, "Adding X? Copy y, per ADR-0003 and ADR-0009.");
  assert.equal(b.kind, "extend");
  assert.equal(b.appliesTo, "apps/web");
  assert.equal(b.shape.question, "Adding X?");
});

test("usersOf (decision 0031 point 5): inbound refs and usedBy edges, narrowed by symbol, null when no record has the file", () => {
  const records = [
    { id: "component:Button", title: "Button", resource: ["ui/Button.tsx"], refs: ["surface:/b"], facts: { edges: { usedBy: ["surface:/b"] } } },
    { id: "component:Icon", title: "Icon", resource: ["ui/Button.tsx"], refs: [], facts: {} },
    { id: "surface:/a", title: "/a", resource: ["app/a.tsx"], refs: ["component:Button"], facts: {} },
    { id: "surface:/b", title: "/b", resource: ["app/b.tsx"], refs: [], facts: {} },
    { id: "surface:/c", title: "/c", resource: ["app/c.tsx"], refs: ["component:Icon"], facts: {} },
  ];
  assert.deepEqual(usersOf({ path: "ui/Button.tsx", symbol: "Button" }, records).map((r) => r.id), ["surface:/a", "surface:/b"]);
  assert.deepEqual(usersOf({ path: "ui/Button.tsx", symbol: null }, records).map((r) => r.id), ["surface:/a", "surface:/b", "surface:/c"], "no symbol: every record of the file");
  assert.deepEqual(usersOf({ path: "ui/Button.tsx", symbol: "Nope" }, records).map((r) => r.id), ["surface:/a", "surface:/b", "surface:/c"], "a symbol no record names narrows nothing");
  assert.deepEqual(usersOf({ path: "app/b.tsx", symbol: null }, records).map((r) => r.id), [], "known, and used by nothing");
  assert.equal(usersOf({ path: "lib/unknown.py", symbol: null }, records), null, "no record: unknown, never zero");
});

test("lint (2.0.0): the pattern plan warns on a plain run and fails with --merge, at its configured path", () => {
  const repo = mkRepo();
  writeFileSync(join(repo, "zdd", "patterns-plan.md"), "# Pattern plan\n");
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^WARNING: zdd\/patterns-plan\.md is on this branch — "update ZDD" reconciles and deletes it/m);
  r = spawnSync(process.execPath, [BIN, "lint", "--merge"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zdd\/patterns-plan\.md: the pattern plan must be reconciled before merge — say "update ZDD"/);
  rmSync(join(repo, "zdd", "patterns-plan.md"));
  r = spawnSync(process.execPath, [BIN, "lint", "--merge"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const cfg = join(repo, "zdd", "config.json");
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, "utf8")), paths: { patternsPlan: "plan.md" } }));
  writeFileSync(join(repo, "plan.md"), "x\n");
  r = spawnSync(process.execPath, [BIN, "lint", "--merge"], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /plan\.md: the pattern plan must be reconciled/);
  rmSync(repo, { recursive: true, force: true });
});

test("blessingShape: visible text, the question, the because clause", () => {
  const s = blessingShape("Adding a thing? Copy [the route](/metadata/route/things.json \"t\") because the auth lives there; never inline it.");
  assert.equal(s.question, "Adding a thing?");
  assert.equal(s.visible, "Adding a thing? Copy the route because the auth lives there; never inline it.");
  assert.equal(s.because, "because the auth lives there");
  assert.equal(s.length, s.visible.length);
  assert.equal(blessingShape("Copy x. Why? Because.").question, null);
  assert.equal(blessingShape("Using e.g. a queue? Copy y.").question, "Using e.g. a queue?");
  assert.equal(blessingShape("x".repeat(201) + "?").question, null, "a 'question' over 200 characters is not a trigger");
  assert.equal(blessingShape("[(app) layout](</metadata/surface/(app)--_layout.json>)? Copy it.").question, "(app) layout?");
});

test("lint: an absent mapDir is greenfield-tolerated; a mistyped one in a populated bundle gets the CR-068 note", () => {
  const repo = mkRepo();
  rmSync(join(repo, "zdd", "map"), { recursive: true });
  rmSync(join(repo, "zdd", "blessings"), { recursive: true }); // they name map pages
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^WARNING: paths\.mapDir 'zdd\/map' does not exist/m);
  const green = mkdtempSync(join(tmpdir(), "zdd-bless-green-"));
  mkdirSync(join(green, "zdd"));
  writeFileSync(join(green, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"] }));
  r = lint(green);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  rmSync(repo, { recursive: true, force: true });
  rmSync(green, { recursive: true, force: true });
});

test("CR-521: a link to an ADR or a URL is a reason, not an exemplar; a metadata record or a repo file is one", () => {
  assert.equal(blessingShape("Naming a migration? Prefix it with the ticket id, per [ADR-0001](../adr/0001-things.md) — never a sequence.").exemplar, false);
  assert.equal(blessingShape("Naming a migration? Prefix it, see [the guide](https://example.com/guide) — never a sequence.").exemplar, false);
  assert.equal(blessingShape("Adding a route? Start from [GET /me](/metadata/route/me.json) — never inline auth.").exemplar, true);
  assert.equal(blessingShape("Adding a route? Start from [the client](../../src/lib/client.ts) — never a second one.").exemplar, true);
});

test("verify CR-521: a link whose destination is no path (`](foo)`) is not an exemplar", () => {
  assert.equal(blessingShape("Adding a route? Start from [GET /me](foo) — never inline auth.").exemplar, false);
  assert.equal(blessingShape("Adding a route? Start from [GET /me](foo.ts) — never inline auth.").exemplar, true);
});
