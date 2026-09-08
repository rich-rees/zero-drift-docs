// The blessing-citation lint (DIO-313): the semantic map's first hard check.
// A blessing that cites a fully superseded ADR, or one that does not exist,
// fails `zdd-engine lint`; a citation of an ADR superseded in part, or a
// blessing with no citation, is a WARNING on stderr and exit 0. Observed at
// the CLI seam on scratch copies of the Next.js fixture (whose ADR-0001 is
// superseded by ADR-0002), plus the section parser on its own.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractBlessings, forwardStamps } from "../src/lib/map-links.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-bless-"));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const lint = (repo) => spawnSync(process.execPath, [BIN, "lint"], { cwd: repo, encoding: "utf8" });
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

test("lint: a blessing citing a fully superseded ADR fails, naming the concept, the blessing and the superseding ADR", () => {
  const repo = mkRepo();
  concept(repo, "widgets", "# Blessings\n- Adding a widget? copy `src/widgets.ts`, per ADR-0001 — never ad-hoc SQL.\n");
  const r = lint(repo);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Store lints failed \(1\)/);
  assert.match(r.stderr, /zdd\/map\/features\/widgets\.md \(blessing: "Adding a widget\? copy/);
  assert.match(r.stderr, /cites ADR-0001, which is superseded by ADR-0002/);
  assert.match(r.stderr, /re-bless under the current decision, or drop the blessing/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: a blessing citing the current ADR passes; citing a non-existent ADR fails", () => {
  const repo = mkRepo();
  concept(repo, "things", "# Blessings\n- Adding a thing? copy [things](/metadata/route/things.json), per ADR-0002.\n");
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /store lints passed/);
  assert.equal(r.stderr, "", "no warning for a clean blessing");
  concept(repo, "ghost", "# Blessings\n- Per ADR-0042, copy nothing.\n");
  r = lint(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ghost\.md .*cites ADR-0042, which does not exist/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: a partial supersession and a citation-less blessing are WARNING lines, exit 0", () => {
  const repo = mkRepo();
  const adrDir = join(repo, "zdd", "adr");
  writeFileSync(join(adrDir, "0003-things-get-audit.md"), "# Things get an audit trail\n\nThis supersedes ADR-0002 in part: the audit half.\n");
  writeFileSync(join(adrDir, "0002-things-replace-widgets.md"), "# Things replace widgets\n\n**Superseded in part by ADR-0003** (2026-02-01): the audit half.\n\nThis supersedes ADR-0001: the core entity is renamed.\n");
  concept(repo, "things", "# Blessings\n- Copy the things route, per ADR-0002.\n- Copy the audit log — no decision named.\n");
  const r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /store lints passed/);
  assert.match(r.stderr, /^WARNING: zdd\/map\/features\/things\.md .*cites ADR-0002, superseded in part by ADR-0003/m);
  assert.match(r.stderr, /^WARNING: zdd\/map\/features\/things\.md .*cites no ADR/m);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: an absent mapDir is greenfield-tolerated; a mistyped one in a populated bundle gets the CR-068 note", () => {
  const repo = mkRepo();
  rmSync(join(repo, "zdd", "map"), { recursive: true });
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
