// 2.2.0: the release checklist, backed where a test can reach. The README's
// and CONTRIBUTING's status lines name the plugin's version — 2.0.0 and 2.1.0
// both shipped with CONTRIBUTING still saying an older one — and the README
// has a roadmap and a Versioning entry for it.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PLUGIN, "..", "..");
const VERSION = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const lines = (text) => text.split(/\r?\n/);

test("README status names the plugin version", () => {
  assert.ok(README.includes(`**Status: ${VERSION}.**`), `README: "**Status: ${VERSION}.**"`);
});

test("CONTRIBUTING status names the plugin version", () => {
  assert.ok(readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8").includes(`ZDD is \`${VERSION}\``), `CONTRIBUTING: "ZDD is \`${VERSION}\`"`);
});

test("README's roadmap and Versioning each have an entry for this release", () => {
  assert.ok(lines(README).some((l) => l.startsWith(`- [x] **${VERSION}**`)), `roadmap: "- [x] **${VERSION}**"`);
  assert.ok(lines(README).some((l) => l.startsWith(`- **\`${VERSION}\` —`)), `Versioning: "- **\`${VERSION}\` —"`);
});

// CR-380 (ZDD-11 slice 7 campaign): the checklist tests above hold that a
// release has texts; this holds what 0.14's say, across the upgrade note,
// the upgrade skill's section, the README's Versioning entry and the
// instructions, against the pinned starter library.
test("0.14's release texts name the route the scripts take: the copies, both proofs, the answers, what moves, and the repo owning its adapters", async () => {
  const { UPGRADE_NOTES, instructionsBody } = await import(new URL("../scripts/bootstrap.mjs", import.meta.url).href);
  const STARTERS = JSON.parse(readFileSync(join(PLUGIN, "starter-adapters.json"), "utf8"));
  const notes = UPGRADE_NOTES["0.14.0"]({ ownAdaptersBefore: true }).join("\n");
  const skill = readFileSync(join(PLUGIN, "skills", "upgrade", "SKILL.md"), "utf8");
  const section = skill.slice(skill.indexOf("## Upgrading to 0.14"), skill.indexOf("## Upgrading to 0.13"));
  const entry = README.slice(README.indexOf("- **`0.14.0` —"), README.indexOf("- **`0.13.0` —"));
  for (const [name, text] of [["UPGRADE_NOTES 0.14.0", notes], ["Upgrading to 0.14", section], ["README Versioning 0.14.0", entry]]) {
    for (const must of ["starters --prove", "--move", "--decline", "unread --raise", "gaps --raise", "zdd/extractors/", STARTERS.package.replace("@rich-rees/", "")]) {
      assert.ok(text.includes(must), `${name} names ${must}`);
    }
    assert.match(text, /never fails/, `${name}: lint warns before the raise, never fails`);
    assert.match(text, /first\s+time\s+is\s+named,\s+not\s+counted\s+as\s+moved/, `${name}: proof 1 and the new unread items (CR-370)`);
    assert.doesNotMatch(text, /`graph\.json` move only with the fixes or once\s+a gap is answered known|graph\.json move only with the fixes or once a gap/, `${name}: a known gap moves no graph (CR-377)`);
  }
  assert.ok(notes.includes(STARTERS.baseline) && notes.includes(STARTERS.version), "the note names the baseline and the fixed version");
  assert.ok(section.includes(STARTERS.baseline) && section.includes(STARTERS.version), "the section names both versions");
  assert.match(section, /companion/i);
  assert.match(section, /From the old line/, "CR-371");
  assert.match(skill, /## Step 4d — the map's gaps/);
  assert.match(skill, /## Step 4c — what the adapters could not read/);
  const body = instructionsBody();
  assert.match(body, /answer every gap the map check names/);
  assert.match(body, /localExtractorDir[\s\S]{0,40}are its own code/);
});
