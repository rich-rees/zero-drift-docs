// The ZDD record (CAS-105, decisions 0027–0029): what the skills WRITE is what
// the engine READS. The update skill's example record and the blessings
// shape it hands the reconciler parse with the engine's parser and no shape
// problem; the instructions file carries the say-it rule in the words the
// skills use; load, patterns and update each name their part; the upgrade
// note and section exist (upgrade.test.mjs holds the version half).
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecord, SECTIONS, USE_VERBS, STORE_VERB, BLESSING_VERBS } from "../../../packages/zdd-engine/src/lib/zdd-record.mjs";
import { INSTRUCTION_RULES, UPGRADE_NOTES } from "../scripts/bootstrap.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(PLUGIN, ...p), "utf8");
const UPDATE = read("skills", "update", "SKILL.md");
const INSTRUCTIONS = read("templates", "instructions.md");
const fence = (text, opener) => {
  const i = text.indexOf(opener);
  assert.ok(i > -1, `no fenced block opening with ${JSON.stringify(opener)}`);
  const start = text.lastIndexOf("```", i);
  const end = text.indexOf("```", i);
  // A block inside a numbered step is indented three spaces: dedent it.
  return text.slice(start + 3, end).replace(/^[^\n]*\n/, "").replace(/^ {3}/gm, "");
};

test("the update skill's example ZDD record parses with the engine's parser: every section, every verb family, no shape problem", () => {
  const example = fence(UPDATE, "ZDD record:\nglossary:");
  const r = parseRecord("feat: x\n\n" + example);
  assert.ok(r && r.kind === "zdd", "the example is a ZDD record");
  assert.deepEqual(r.problems, [], r.problems.join("\n"));
  for (const s of SECTIONS) assert.ok(r.sections[s].length > 0, `${s}: the example shows at least one line`);
  const verbs = new Set(SECTIONS.flatMap((s) => r.sections[s].map((e) => e.verb)));
  for (const v of [...USE_VERBS, STORE_VERB, "followed", "minted"]) assert.ok(verbs.has(v), `the example shows '${v}'`);
  assert.ok(r.sections.map.some((e) => e.verb === "reused"), "reused is shown under map");
});

test("the blessings shape the reconciler writes uses only the engine's blessing verbs, and parses when placed in a full record", () => {
  const shape = fence(UPDATE, 'blessings:\n   - followed: "<trigger question>"');
  const verbs = [...shape.matchAll(/^- ([a-z ]+?):/gm)].map((m) => m[1]);
  assert.deepEqual(verbs, BLESSING_VERBS, "the six verbs, in the skill's order");
  const full = "x\n\nZDD record:\nglossary:\n- none\nadrs:\n- none\n" + shape.replace(/<[^>]+>|…/g, "thing") + "map:\n- none\ncomments:\n- none\n";
  const r = parseRecord(full);
  assert.deepEqual(r.problems, [], r.problems.join("\n"));
  assert.equal(r.sections.blessings.length, BLESSING_VERBS.length);
});

test("the instructions file carries the say-it rule in the record's words, and its example line would count as a use", () => {
  assert.match(INSTRUCTIONS, /Say it when ZDD changes a decision/);
  assert.match(INSTRUCTIONS, /reading is\s+never a use/i);
  assert.match(INSTRUCTIONS, /no stop, no\s+question/);
  assert.match(INSTRUCTIONS, /ZDD record/);
  for (const s of SECTIONS) assert.ok(INSTRUCTIONS.includes(`\`${s}\``), `instructions name the ${s} section`);
  assert.match(INSTRUCTIONS, /zdd-engine tally/);
  // The example line, as an adrs entry, is a turned line with a counterfactual.
  const m = INSTRUCTIONS.match(/`ZDD: ADR-0015\s+turned — ([^`]+)`/);
  assert.ok(m, "the instructions show an example line");
  const r = parseRecord(`x\n\nZDD record:\nglossary:\n- none\nadrs:\n- turned: ADR-0015 ${m[1].replace(/\s+/g, " ")}\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n`);
  assert.deepEqual(r.problems, []);
  // The finder's rule for it matches the instructions themselves (the finder test holds the rest).
  const rule = INSTRUCTION_RULES.find((x) => x.id === "record");
  assert.ok(rule && rule.match.test(INSTRUCTIONS));
});

test("load declares with the ZDD: prefix and claims no benefit; patterns says the reuse line; update's description names the record", () => {
  const load = read("skills", "load", "SKILL.md");
  assert.match(load, /ZDD: loaded glossary/);
  assert.match(load, /read, never a use/);
  const patterns = read("skills", "patterns", "SKILL.md");
  assert.match(patterns, /ZDD: map reused — /);
  assert.match(UPDATE, /^description: ".*write the ZDD record/m);
  assert.match(UPDATE, /ZDD record \(amended\):/);
  assert.doesNotMatch(UPDATE.replace(/Before 2\.4 the record was\s+`Pattern record:`[^.]*\./, ""), /Pattern record/, "the old heading survives only as the legacy note");
});

test("the 2.4 upgrade note names the record, the tally and the lint warning; the Upgrading section exists", () => {
  const notes = UPGRADE_NOTES["2.4.0"]({ paths: { bundleDir: "zdd" }, config: {} }).join("\n");
  assert.match(notes, /zdd\/instructions\.md/);
  assert.match(notes, /ZDD record:/);
  assert.match(notes, /zdd-engine tally/);
  assert.match(notes, /lint --merge.*WARN/);
  assert.match(read("skills", "upgrade", "SKILL.md"), /^## Upgrading to 2\.4 \(the ZDD record\)/m);
});
