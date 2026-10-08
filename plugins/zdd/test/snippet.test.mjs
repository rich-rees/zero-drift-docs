// CAS-101: the instruction block an adopter gets (CLAUDE.md, and AGENTS.md
// for Codex) names every user-facing skill — a new skill without a line here
// fails — and carries the rules every adopter needs, which Cascade and DiO
// had each hand-written: the release line leads the reply, generated-file
// conflicts are merged then regenerated, "update ZDD" is never delegated, and
// a developer joining the repo is told how to install.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOCK = readFileSync(join(PLUGIN, "templates", "claude-md-snippet.md"), "utf8");
const SKILLS = readdirSync(join(PLUGIN, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test("the block names every user-facing skill as `(Skill: <name>)` or in backticks", () => {
  assert.ok(SKILLS.length >= 7, SKILLS.join(", "));
  for (const s of SKILLS) assert.ok(BLOCK.includes(`\`${s}\``), `the block does not name the \`${s}\` skill — add a line for it`);
});

test("the block carries the adopter rules (CAS-101)", () => {
  assert.match(BLOCK, /"upgrade ZDD"/);
  assert.match(BLOCK, /first line of your reply/i);
  assert.match(BLOCK, /merge.*commit the merge.*regenerate/is);
  assert.match(BLOCK, /never (?:hand|delegate)[\s\S]*subagent|subagent[\s\S]*never/i);
  assert.match(BLOCK, /claude plugin install zdd@zero-drift-docs --scope project/);
  assert.match(BLOCK, /README/);
});

test("the block stays small: it is read in every session of every adopter", () => {
  const lines = BLOCK.trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= 50, `${lines} lines — move setup detail to the README and keep the per-session rules here`);
});
