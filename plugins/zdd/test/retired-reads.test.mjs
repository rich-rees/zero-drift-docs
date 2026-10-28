// The retired-names sweep reads code, not only words (ZDD-10, finding 2 of
// PressPlay's move to 0.11.0): a fence's install check (`config.engine`) and
// a session-start script (`require(...).engine`) read the config's old
// `engine` key by property, so they broke silently when 0.9 renamed it
// `release`. And a lock test asserting `<!-- zdd:begin -->` is ABSENT from
// CLAUDE.md, or present in AGENTS.md (which keeps the block), is not a
// retired name at all. The cases are the two adopters' own lines.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Ledger, findRetiredNames } from "../scripts/bootstrap.mjs";

const sweep = (t, files) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-retired-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return findRetiredNames(new Ledger(root)).join("\n");
};

test("ZDD-10: a property read of the config's old `engine` key is listed, in JS, shell and Python, where the file names zdd/config.json", (t) => {
  const notes = sweep(t, {
    ".claude/hooks/plugins.test.mjs": 'const read = (p) => JSON.parse(readFileSync(p, "utf8"));\nassert.equal(`v${read("zdd/config.json").engine}`, ZDD_TAG);\n',
    ".claude/hooks/session-start.sh": "#!/bin/sh\nPIN=$(node -p 'require(\"./zdd/config.json\").engine')\n",
    ".claude/hooks/fence.mjs": 'const config = JSON.parse(readFileSync(join(root, "zdd", "config.json"), "utf8"));\nif (!config.engine) strict = true;\nconst pin = config["engine"];\n',
    "scripts/pin.py": 'cfg = json.load(open("zdd/config.json"))\nprint(cfg.get("engine"))\n',
  });
  assert.match(notes, /\.claude\/hooks\/plugins\.test\.mjs:2 still says `\.engine` — since 0\.9\.0 that is the config's `release`/, notes);
  assert.match(notes, /\.claude\/hooks\/session-start\.sh:2 still says `\.engine`/, notes);
  assert.match(notes, /\.claude\/hooks\/fence\.mjs:2 still says `\.engine`/, notes);
  assert.match(notes, /\.claude\/hooks\/fence\.mjs:3 still says `\["engine"\]`/, notes);
  assert.match(notes, /scripts\/pin\.py:2 still says `get\("engine"`/, notes);
});

test("ZDD-10: an `engine` that is not ZDD's config is left alone", (t) => {
  const notes = sweep(t, {
    "apps/api/app/db.py": "from sqlalchemy.engine import URL, make_url\n",
    "apps/api/tests/test_housekeeping.py": 'seen["engine"], seen["now"] = engine, now\nassert seen["engine"] is engine\n',
    "scripts/build.mjs": "const r = render.engine;\n",
    // Names the config, but writes the key in a fixture: not a read.
    "test/fixture.mjs": 'writeFileSync("zdd/config.json", JSON.stringify({ engine: "2.5.0" }));\n',
  });
  assert.doesNotMatch(notes, /engine/, notes);
});

test("ZDD-10: an assertion that the old marker is absent, or a line about AGENTS.md's block, is not a retired name; a doc that still puts the marker in CLAUDE.md is", (t) => {
  const notes = sweep(t, {
    ".claude/hooks/plugins.test.mjs": [
      'assert.ok(!claude.some((l) => l.includes("<!-- zdd:begin -->")), "no managed block left in CLAUDE.md");',
      'assert.doesNotMatch(claudeMd, /<!-- zdd:begin -->/);',
      'expect(text).not.toContain("<!-- zdd:begin -->");',
      'assert.equal(agents.split("<!-- zdd:begin -->").length - 1, 1, "one zdd:begin marker in AGENTS.md");',
      'const block = agents.match(/<!-- zdd:begin -->\\r?\\n([\\s\\S]*?)<!-- zdd:end -->/);',
      "",
    ].join("\n"),
    "docs/setup.md": "Put the `<!-- zdd:begin -->` block in CLAUDE.md.\n",
  });
  assert.doesNotMatch(notes, /plugins\.test\.mjs/, notes);
  assert.match(notes, /docs\/setup\.md:1 still says `<!-- zdd:begin -->`/, notes);
});

test("ZDD-10: an accepted ADR is history — a retired name in the ADR folders is never listed; the same name in a doc is", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zdd-retired-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const rel of ["zdd/adr/0004-ci.md", "zdd/adr-harness/0006-loading.md", "docs/setup.md"]) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), "CI calls @rich-rees/zdd-engine and bootstrap --upgrade moves it.\n");
  }
  const notes = findRetiredNames(new Ledger(root), { adrDirs: ["zdd/adr", "zdd/adr-harness"] }).join("\n");
  assert.doesNotMatch(notes, /zdd\/adr/, notes);
  assert.match(notes, /docs\/setup\.md:1 still says `@rich-rees\/zdd-engine`/, notes);
  assert.match(notes, /docs\/setup\.md:1 still says `bootstrap --upgrade`/, notes);
});
