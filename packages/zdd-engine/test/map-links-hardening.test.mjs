// The map-links parser and the lint's map walk against untrusted text and
// trees (DIO-313 review CR-018..CR-025): fenced code and HTML comments are
// not structure, headings may be indented, CR-only endings are normalised,
// a stamp is a stamp only at the start of a line, links on another drive are
// outside the bundle, symlinks are skipped, oversized concepts fail loudly,
// and control characters never reach the diagnostics.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractBlessings, forwardStamps, extractLinks, structuralLines } from "../src/lib/map-links.mjs";
import { walkMarkdown, readBounded, regularFileInside } from "../src/lib/walk-markdown.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG, "bin", "zdd-engine.mjs");
const FIXTURE = join(PKG, "test", "fixture");

const mkRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-harden-"));
  cpSync(FIXTURE, repo, { recursive: true });
  return repo;
};
const lint = (repo) => spawnSync(process.execPath, [BIN, "lint"], { cwd: repo, encoding: "utf8" });
const concept = (repo, name, body) =>
  writeFileSync(join(repo, "zdd", "map", "features", `${name}.md`), `---\ntype: Feature\ntitle: ${name}\ndescription: test\nresource: src\ntags: [${name}]\n---\n\n${body}`);

test("structuralLines: fenced code (``` and ~~~, indented up to 3 spaces, closed by a fence at least as long) and HTML comments are blanked, line numbers kept", () => {
  const body = ["a", "```md", "# not a heading", "```", "b", "  ~~~", "- not an item", "~~~~", "c", "<!-- # not", "a heading -->", "d", "````", "```", "still fenced", "````", "e"].join("\n");
  const lines = structuralLines(body);
  assert.equal(lines.length, 17, "one entry per line");
  assert.deepEqual(lines.filter(Boolean), ["a", "b", "c", "d", "e"]);
  // CR-033: a comment opener inside a fence is code; a fence marker inside a comment is commentary; an unclosed comment blanks to the end.
  assert.deepEqual(extractBlessings("# Blessings\n```md\n<!-- literal in code\n```\n- stale, per ADR-0001\n-->").map((b) => b.adrs), [["0001"]]);
  assert.deepEqual(structuralLines("x <!-- ```\n# Blessings\n--> y\n- after, ADR-0002\n<!-- open\n- gone ADR-0003").filter(Boolean), ["x ", " y", "- after, ADR-0002"]);
  assert.deepEqual(extractBlessings("# Blessings\n- a <!-- ADR-0009 --> per ADR-0002\n").map((b) => b.adrs), [["0002"]]);
  // CR-034: a fence opener right after a comment closes still opens a fence, so the fenced example stays an example.
  assert.deepEqual(extractBlessings("# Blessings\n<!-- note\n-->```md\n- fenced, per ADR-9999\n```\n- real, per ADR-0002\n").map((b) => b.adrs), [["0002"]]);
  assert.deepEqual(forwardStamps("<!-- x -->```\nSuperseded by ADR-0044\n```\n"), [], "a stamp inside a fence that opened after a comment is not a stamp");
  assert.deepEqual(structuralLines("```<!-- open\ncommentary\n-->\nstill code\n```\nafter").filter(Boolean), ["after"], "a fence opener before an unclosed comment opens, the comment runs, the fence resumes");
  assert.deepEqual(structuralLines("<!-- a --> text <!-- b --> more").filter(Boolean), [" text  more"]);
  // CR-035: a comment opener after a fence opener on the same line is code, so the fence closes normally and later structure is seen.
  assert.deepEqual(structuralLines("<!-- first -->```<!-- second\n```\n-->\n# Blessings\n- real, per ADR-0007\nSuperseded by ADR-0044").filter(Boolean), ["-->", "# Blessings", "- real, per ADR-0007", "Superseded by ADR-0044"]);
  assert.deepEqual(extractBlessings("<!-- first -->```<!-- second\n```\n-->\n# Blessings\n- real, per ADR-0007\n").map((b) => b.adrs), [["0007"]]);
  assert.deepEqual(structuralLines("```<!-- open\ncommentary\n```\n# after").filter(Boolean), ["# after"], "…and the fence closes on its own line even with the stray opener before it");
});

test("extractBlessings (CR-020, CR-022): fenced examples are neither headings nor items, an indented heading counts, a comment is invisible, CR-only files parse", () => {
  const body = [
    "# Blessings",
    "- Real one, per ADR-0002.",
    "```markdown",
    "# Notes",
    "- Fenced example, per ADR-9999.",
    "```",
    "- Still in the section after the fence, per ADR-0001.",
    "<!-- - commented out, per ADR-8888 -->",
    "   ## Key paths",
    "- not a blessing, per ADR-7777",
  ].join("\n");
  assert.deepEqual(
    extractBlessings(body).map((b) => [b.line, b.adrs]),
    [
      [2, ["0002"]],
      [7, ["0001"]],
    ],
  );
  assert.deepEqual(extractBlessings("```\n# Blessings\n- fake, per ADR-0042\n```\n"), [], "a fenced # Blessings is not a section");
  assert.deepEqual(extractBlessings("# Blessings\r- cr only ADR-0002\r- and ADR-0003\r").map((b) => b.adrs), [["0002"], ["0003"]]);
});

test("forwardStamps (CR-021): only a line that OPENS with the stamp counts — bold, blockquoted, linked or bare; prose, negation, fences and comments do not", () => {
  const text = [
    "# ADR",
    "> **Superseded by [ADR-0002](0002-x.md)** (2026-01-02): renamed.",
    "**Superseded in part by ADR-0031** (2026-08-01): one rule moved.",
    "Superseded in part by [ADR-0087](0087-y.md) — plain paragraph.",
    "This is not superseded by ADR-0042, whatever the rumour says.",
    "We considered marking it superseded by ADR-0043 and did not.",
    "```",
    "Superseded by ADR-0044 — an example of the stamp format",
    "```",
    "<!-- Superseded by ADR-0045 -->",
    "   > Superseded by ADR-0046 (indented blockquote, still a stamp)",
  ].join("\n");
  assert.deepEqual(forwardStamps(text), [
    { partial: false, by: "0002" },
    { partial: true, by: "0031" },
    { partial: true, by: "0087" },
    { partial: false, by: "0046" },
  ]);
});

test("extractLinks (CR-023): a target on another drive, a UNC share, or above the bundle is not an edge on any platform; a fenced link still is (render bytes unchanged)", () => {
  const bundle = process.platform === "win32" ? "C:\\r\\zdd" : "/r/zdd";
  const doc = join(bundle, "map", "features");
  const body = "[a](/metadata/route/a.json) [b](../../../outside.md) [c](//server/share/x.json) [c2](\\\\server\\share\\x.json) [d](D:/x.json) [e](https://x/y.json)\n```\n[f](/metadata/route/f.json)\n```\n";
  const ids = extractLinks(body, doc, bundle);
  assert.ok(ids.includes("metadata/route/a"));
  assert.ok(ids.includes("metadata/route/f"), "links inside fences are still edges — extractLinks is byte-identical with 1.0 by design");
  assert.deepEqual(ids, ["metadata/route/a", "metadata/route/f"]);
});

test("walkMarkdown / readBounded: symlinks are skipped (file, directory, dangling, loop), non-md ignored, a file over the cap reads as null", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-walk-"));
  mkdirSync(join(root, "a", "b"), { recursive: true });
  writeFileSync(join(root, "a", "one.md"), "x");
  writeFileSync(join(root, "a", "b", "two.md"), "y");
  writeFileSync(join(root, "a", "three.txt"), "z");
  writeFileSync(join(root, "outside.md"), "SECRET");
  let linked = true;
  try {
    symlinkSync(join(root, "outside.md"), join(root, "a", "link.md"), "file");
    symlinkSync(join(root, "a"), join(root, "a", "loop"), "junction");
    symlinkSync(join(root, "nowhere.md"), join(root, "a", "dangling.md"), "file");
  } catch {
    linked = false;
  }
  const found = walkMarkdown(join(root, "a")).map((p) => p.slice(root.length).split(/[\\/]/).filter(Boolean).join("/"));
  assert.deepEqual(found, ["a/b/two.md", "a/one.md"]);
  if (!linked) t.diagnostic("symlink creation not permitted here — link cases not exercised");
  assert.equal(readBounded(join(root, "a", "one.md")), "x");
  assert.equal(readBounded(join(root, "a", "one.md"), 0), null, "over the cap");
  assert.equal(readBounded(join(root, "a")), null, "a directory is not a file");
  // CR-013: the root handed to regularFileInside may not itself be a symlink.
  if (linked) {
    symlinkSync(join(root, "a"), join(root, "aliased"), "junction");
    assert.equal(regularFileInside(join(root, "aliased"), join(root, "aliased", "one.md")), false, "symlinked root refused");
    assert.equal(regularFileInside(join(root, "a"), join(root, "a", "one.md")), true);
    assert.equal(regularFileInside(join(root, "a"), join(root, "a", "link.md")), false, "symlinked leaf refused");
  }
  rmSync(root, { recursive: true, force: true });
});

test("lint (CR-018/CR-019/CR-025): a symlinked concept is skipped, a loop does not recurse, an oversized concept fails with its name, a control character in a blessing is neutralised", (t) => {
  const repo = mkRepo();
  const map = join(repo, "zdd", "map");
  writeFileSync(join(repo, "outside.md"), "# Blessings\n- from outside, per ADR-0001\n");
  try {
    symlinkSync(join(repo, "outside.md"), join(map, "features", "linked.md"), "file");
    symlinkSync(map, join(map, "loop"), "junction");
  } catch {
    t.diagnostic("symlink creation not permitted here");
  }
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /outside/, "the linked file's stale blessing is never read");
  concept(repo, "ctrl", "# Blessings\n- copy \x1b[31mthis\x1b[0m, per ADR-0001\n");
  r = lint(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ctrl\.md:10 \(blessing: "copy \?\[31mthis\?\[0m, per ADR-0001"\)/, "controls become ?");
  rmSync(join(map, "features", "ctrl.md"));
  writeFileSync(join(map, "features", "huge.md"), "---\ntype: Feature\ntitle: h\ndescription: d\nresource: src\ntags: []\n---\n" + "x".repeat(1024 * 1024 + 1));
  r = lint(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /zdd\/map\/features\/huge\.md: over 1024 KiB/);
  rmSync(repo, { recursive: true, force: true });
});

test("lint: the CommonMark cases end to end — a fenced example neither hides a later stale blessing nor fails on a fake one; CR-only and indented headings work", () => {
  const repo = mkRepo();
  concept(repo, "fenced", "# Blessings\n```md\n# Example\n- copy x, per ADR-9999\n```\n- the real one, per ADR-0002\n");
  let r = lint(repo);
  assert.equal(r.status, 0, r.stderr);
  concept(repo, "hidden", "# Blessings\n```\n# Key paths\n```\n- stale, per ADR-0001\n");
  r = lint(repo);
  assert.equal(r.status, 1, "the stale blessing after a fenced heading is still seen");
  assert.match(r.stderr, /hidden\.md:13 .*superseded by ADR-0002/, "file-relative line: 7 frontmatter lines + body line 6");
  rmSync(join(repo, "zdd", "map", "features", "hidden.md"));
  writeFileSync(join(repo, "zdd", "map", "features", "cr.md"), "---\rtype: Feature\rtitle: cr\rdescription: d\rresource: src\rtags: []\r---\r\r  # Blessings\r- stale, per ADR-0001\r");
  r = lint(repo);
  assert.equal(r.status, 1, "CR-only + indented heading");
  assert.match(r.stderr, /cr\.md:10 .*superseded by ADR-0002/);
  rmSync(repo, { recursive: true, force: true });
});
