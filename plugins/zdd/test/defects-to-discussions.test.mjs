// Decision 0041 in every place it speaks (slice 6 campaign CR-160): a ZDD
// defect goes to the developer in plain words and to the repo's Discussions
// ("Bug reports"); nothing sends one to Issues. And the upgrade's text pass
// flags an adopter's own instruction that still says Issues.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTRUCTION_RULES } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DISCUSSIONS = "https://github.com/rich-rees/zero-drift-docs/discussions";
const read = (...p) => readFileSync(join(PLUGIN, ...p), "utf8");

test("every place that routes a ZDD defect names Discussions and never Issues", () => {
  const places = {
    "templates/instructions.md": read("templates", "instructions.md"),
    "skills/bootstrap": read("skills", "bootstrap", "SKILL.md"),
    "skills/upgrade": read("skills", "upgrade", "SKILL.md"),
    "the fence's reply": read("scripts", "fence.mjs"),
    "the preflight's missing-engine line": read("scripts", "bootstrap.mjs").match(/so this is a ZDD defect — [^`]*`/)?.[0] ?? "",
  };
  for (const [where, text] of Object.entries(places)) {
    assert.ok(text.includes(DISCUSSIONS.replace("https://github.com/rich-rees/zero-drift-docs", "")) || text.includes(DISCUSSIONS), `${where}: no Discussions link`);
    assert.doesNotMatch(text, /zero-drift-docs\/issues|labelled `finding`/, where);
  }
  for (const where of ["templates/instructions.md", "skills/bootstrap", "skills/upgrade"]) {
    const text = places[where].replace(/\s+/g, " ");
    assert.match(text, /plain words/, `${where}: the developer hears it in plain words`);
    assert.match(text, /ready-written report/, `${where}: a report to post`);
    assert.match(text, /Bug reports/, `${where}: the category`);
  }
  // CR-163: contributors are sent to Discussions and pull requests.
  const contributing = readFileSync(join(PLUGIN, "..", "..", "CONTRIBUTING.md"), "utf8");
  assert.doesNotMatch(contributing, /Issues and discussion are welcome/);
  assert.match(contributing.replace(/\s+>?\s*/g, " "), /bug reports go to the repo's Discussions/);
  const rule = INSTRUCTION_RULES.find((r) => r.id === "findings");
  assert.match(rule.says, /plain words.*Discussions \(Bug reports\).*no Issues/);
});

test("the upgrade's text pass flags a team's own instruction that still sends ZDD defects to Issues", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "zdd-0041-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "zdd"), { recursive: true });
  writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify({ extractors: ["generic"], engine: "2.5.0" }));
  writeFileSync(join(repo, "CLAUDE.md"), "# Ours\n\n@zdd/instructions.md\n\n## Process\n\nFile ZDD bugs at https://github.com/rich-rees/zero-drift-docs/issues with the finding label.\n");
  const plan = JSON.parse(execFileSync(process.execPath, [join(PLUGIN, "scripts", "bootstrap.mjs"), "upgrade", "--plan", "--json", `--root=${repo}`, `--home=${join(repo, "home")}`], { encoding: "utf8" }));
  const hit = plan.duplicates.find((d) => /zero-drift-docs\/issues/.test(d.text));
  assert.ok(hit && hit.rules.includes("findings"), JSON.stringify(plan.duplicates));
});
