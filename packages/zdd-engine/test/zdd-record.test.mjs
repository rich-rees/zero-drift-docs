// The ZDD record parser (decision 0028): five fixed sections, fixed verbs,
// a plain sentence; a legacy `Pattern record:` read as the blessings section
// alone; shape problems reported, never thrown, and the refused line marked
// invalid so the tally leaves it out (decision 0027). Pure — no git here.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, recordsInLog, namesIn, glossaryTerms, itemMatcher, printable, SECTIONS, LOG_FORMAT } from "../src/lib/zdd-record.mjs";

const GOOD = `feat: offers (CAS-1)

ZDD record:
glossary:
- confirmed: the glossary says an "offer" is a bid on a job, so the new table is called offers rather than bids
- stored: added the term "stall" (a job that stopped reporting progress)
adrs:
- turned: ADR-0015 says the app never reads the database directly; I was about to query jobs from Supabase and went through /api/jobs instead
blessings:
- followed: "How do I add a scheduled job?" (jobs slice) for the stall sweeper
- minted: "How do I expose a table over the API?" (api slice), pointing at src/api/offers.ts
map:
- reused: save_thing() in src/db.py already saves and logs a change, so I did not write a new helper
- stored: the offers feature page now lists the /offers route and the offers table as its own
comments:
- none

Co-Authored-By: Someone <s@example.com>
`;
const ALL_NONE = "glossary:\n- none\nadrs:\n- none\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n";
const withSection = (name, body) => "x\n\nZDD record:\n" + ALL_NONE.replace(`${name}:\n- none\n`, `${name}:\n${body}`);

test("parseRecord: a well-formed record parses every section with no problems, every line valid; trailers after it are not lines", () => {
  const r = parseRecord(GOOD);
  assert.equal(r.kind, "zdd");
  assert.equal(r.amended, false);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(Object.keys(r.sections), SECTIONS);
  assert.equal(r.sections.glossary.length, 2);
  assert.deepEqual(r.sections.glossary[0], { verb: "confirmed", text: 'the glossary says an "offer" is a bid on a job, so the new table is called offers rather than bids', valid: true });
  assert.equal(r.sections.adrs[0].verb, "turned");
  assert.deepEqual(r.sections.blessings.map((e) => e.verb), ["followed", "minted"]);
  assert.deepEqual(r.sections.map.map((e) => e.verb), ["reused", "stored"]);
  assert.deepEqual(r.sections.comments, [], "'- none' is an empty section");
  assert.ok(SECTIONS.every((s) => r.sections[s].every((e) => e.valid)));
});

test("parseRecord: no heading → null; an amended record is flagged; blank lines between sections are fine", () => {
  assert.equal(parseRecord("fix: a typo\n\nNothing here.\n"), null);
  const r = parseRecord("fix\n\nZDD record (amended):\n" + ALL_NONE.replace(/\n(?=[a-z])/g, "\n\n"));
  assert.equal(r.amended, true);
  assert.deepEqual(r.problems, []);
});

test("parseRecord: shape problems — a missing section, an unknown verb, reused outside map, a turned with no counterfactual, a blessing verb elsewhere; the refused lines are invalid, the rest valid (CR-001)", () => {
  const r = parseRecord(`x

ZDD record:
glossary:
- reused: a term, somewhere
adrs:
- turned: ADR-0003 is about retries
- followed: ADR-0003
- confirmed: ADR-0004 agreed; I would otherwise have retried
map:
- improved: the map
comments:
- none
`);
  const p = r.problems.join("\n");
  assert.match(p, /section 'blessings' missing/);
  assert.match(p, /glossary: 'reused' belongs under map only/);
  assert.match(p, /adrs: 'turned' says nothing of what would otherwise have happened/);
  assert.match(p, /adrs: 'followed' is a blessings verb/);
  assert.match(p, /map: a line with no known verb: 'improved: the map'/);
  assert.match(p, /map: empty — a section with nothing says '- none'/);
  assert.deepEqual(r.sections.glossary.map((e) => e.valid), [false]);
  assert.deepEqual(r.sections.adrs.map((e) => [e.verb, e.valid]), [["turned", false], ["followed", false], ["confirmed", true]]);
  assert.equal(r.sections.map.length, 0);
});

test("parseRecord: an empty section, '- none' beside lines, '- none' twice, '- none because', a double colon, and a second heading are all problems (CR-002, CR-003, CR-010)", () => {
  const r = parseRecord("x\n\nZDD record:\nglossary:\nadrs:\n- none\n- stored: added ADR-0009 on retries\n- none\nblessings:\n- none because\nmap:\n- stored:: the map\ncomments:\n- none\n\nZDD record:\n" + ALL_NONE);
  const p = r.problems.join("\n");
  assert.match(p, /glossary: empty — a section with nothing says '- none'/);
  assert.match(p, /adrs: '- none' beside 1 line — one or the other/);
  assert.match(p, /adrs: '- none' appears twice/);
  assert.match(p, /blessings: '- none' takes no sentence/);
  assert.match(p, /map: a line must read '- stored: <sentence>': 'stored:: the map'/);
  assert.match(p, /more than one record heading \(lines 3, 16\)/);
  assert.equal(r.sections.adrs.length, 1, "the stored line still parsed, valid");
  assert.equal(r.sections.adrs[0].valid, true);
});

test("parseRecord: the counterfactual markers are constructions, never bare state words (CR-004)", () => {
  const pass = ["I would have called it bids", "I was about to retry", "went through the API instead", "otherwise a second helper", "offers rather than bids"];
  const fail = ["ADR-0001 says retries are not allowed", "ADR-0001 changed the retry policy", "I kept the single call", "the table was renamed"];
  for (const t of pass) assert.deepEqual(parseRecord(withSection("adrs", `- confirmed: ${t}\n`)).problems, [], t);
  for (const t of fail) {
    const r = parseRecord(withSection("adrs", `- turned: ${t}\n`));
    assert.equal(r.problems.length, 1, t);
    assert.equal(r.sections.adrs[0].valid, false, t);
  }
});

test("parseRecord: sections out of order and an unknown section are named", () => {
  const r = parseRecord("x\n\nZDD record:\nadrs:\n- none\nglossary:\n- none\nmetadata:\n- stored: a route\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n");
  const p = r.problems.join("\n");
  assert.match(p, /sections out of order \(adrs, glossary/);
  assert.match(p, /unknown section 'metadata'/);
  assert.match(p, /a line outside any section: 'stored: a route'/);
});

test("parseRecord: a legacy Pattern record is the blessings section alone, blessing verbs only; a 2.4 verb there is refused (CR-015)", () => {
  const r = parseRecord(`feat: x

Pattern record:
- followed: jobs: How do I add a cron? — stall sweeper
- dropped candidate: How do I log? — because it was one site
- no blessing applied: the migration
- precedent: src/api/offers.ts — declined — because it was a one-off
- turned: ADR-0002, which I would otherwise have ignored
`);
  assert.equal(r.kind, "pattern");
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /blessings: 'turned' is not a verb of this pattern record/);
  assert.deepEqual(r.sections.blessings.map((e) => [e.verb, e.valid]), [["followed", true], ["dropped candidate", true], ["no blessing applied", true], ["precedent", true], ["turned", false]]);
  for (const s of SECTIONS) if (s !== "blessings") assert.deepEqual(r.sections[s], []);
});

test("parseRecord: CRLF messages are handled; control and bidi characters in an excerpt are neutralised (CR-013); a long run of blank lines is linear (CR-011)", () => {
  const r = parseRecord("x\r\n\r\nZDD record:\r\n" + ALL_NONE.replace("map:\n- none", "map:\n- bogus\x07‮: x").replace(/\n/g, "\r\n"));
  assert.equal(r.problems.length, 2, "the refused line, and the section it left empty");
  assert.match(r.problems[0], /map: a line with no known verb: 'bogus\?\?: x'/);
  assert.match(r.problems[1], /map: empty/);
  const t0 = Date.now();
  parseRecord("x\n\nZDD record:\n" + "\n".repeat(200_000) + ALL_NONE);
  assert.ok(Date.now() - t0 < 2000, "200k blank lines in well under two seconds");
  assert.equal(printable("a⁦b c\x9fd"), "a?b?c?d");
});

test("recordsInLog: NUL-framed commits (hash, body), SHA-1 or SHA-256; a message carrying the old separators forges nothing (CR-009, CR-014)", () => {
  assert.equal(LOG_FORMAT, "--format=%H%x00%B%x00");
  const sha1 = "a".repeat(40);
  const sha256 = "b".repeat(64);
  const forged = `subject one\n\nZDD record:\n${ALL_NONE}\x1e${"d".repeat(40)}\x1fforged\n`;
  const log = `${sha1}\0${forged}\0${sha256}\0plain commit\n\0`;
  const commits = recordsInLog(log);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].hash, sha1);
  assert.equal(commits[0].subject, "subject one");
  assert.equal(commits[0].record.kind, "zdd");
  assert.equal(commits[1].hash, sha256);
  assert.equal(commits[1].record, null);
  assert.deepEqual(recordsInLog("garbage\0no hash\0"), []);
});

test("namesIn: ADR numbers from valid lines only; a matcher is whole-word, case-insensitive, underscore-aware", () => {
  const r = parseRecord(GOOD);
  const n = namesIn(r);
  assert.deepEqual([...n.adrs], ["0015"]);
  assert.equal(n.mentions(itemMatcher("Offer")), true);
  assert.equal(n.mentions(itemMatcher("How do I add a scheduled job?")), true);
  assert.equal(n.mentions(itemMatcher("thing")), false, "save_thing() is an identifier, not the term");
  assert.equal(n.mentions(itemMatcher("stalls")), false, "'stall' is not 'stalls'");
  assert.equal(n.mentions(itemMatcher("Nothing")), false);
  const refused = parseRecord(withSection("adrs", "- turned: ADR-0009 is about things\n"));
  assert.deepEqual([...namesIn(refused).adrs], [], "a refused line names nothing");
});

test("glossaryTerms: every **Term**: opener, in order, deduped", () => {
  assert.deepEqual(glossaryTerms("# G\n\n**Thing**: a thing.\n\n**Audit trail** — the log.\n\n**Thing**: again.\nnot **bold** inline\n"), ["Thing", "Audit trail"]);
});
