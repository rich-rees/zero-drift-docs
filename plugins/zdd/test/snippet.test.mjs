// CAS-101, reshaped in CAS-103: ZDD's instructions (zdd/instructions.md,
// copied into AGENTS.md for Codex) name every user-facing skill — a new skill
// without a line here fails — and carry the rules every adopter needs: the
// release line leads the reply with its three cases, generated-file conflicts
// take either side then regenerate, "update ZDD" is never delegated, a
// developer joining the repo is told both install commands in order, and a
// ZDD defect has a home. Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BODY = readFileSync(join(PLUGIN, "templates", "instructions.md"), "utf8");
const SKILLS = readdirSync(join(PLUGIN, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test("the instructions name every user-facing skill as `(Skill: <name>)` or in backticks", () => {
  assert.ok(SKILLS.length >= 7, SKILLS.join(", "));
  for (const s of SKILLS) assert.ok(BODY.includes(`\`${s}\``), `the instructions do not name the \`${s}\` skill — add a line for it`);
});

test("the instructions carry the adopter rules (CAS-101, CAS-103)", () => {
  assert.match(BODY, /"upgrade ZDD"/);
  assert.match(BODY, /first line of your reply/i);
  assert.match(BODY, /take either side[\s\S]*commit[\s\S]*regenerate/i);
  assert.match(BODY, /never (?:hand|delegate)[\s\S]*subagent|subagent[\s\S]*never/i);
  assert.match(BODY, /claude plugin install mattpocock-skills@zero-drift-docs --scope project/);
  assert.match(BODY, /claude plugin install zdd@zero-drift-docs --scope project/);
  assert.match(BODY, /zero-drift-docs#readme/);
  assert.match(BODY, /zero-drift-docs\/issues/);
  assert.doesNotMatch(BODY, /zdd:begin|zdd:end/, "the body carries no markers; the writers add them for AGENTS.md");
});

test("the instructions stay small: they are read in every session of every adopter", () => {
  const lines = BODY.trimEnd().split(/\r?\n/).length;
  assert.ok(lines <= 70, `${lines} lines — move setup detail to the README and keep the per-session rules here`);
});
