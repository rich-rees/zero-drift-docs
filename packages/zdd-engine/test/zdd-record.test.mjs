// The ZDD record parser (decision 0028): five fixed sections, fixed verbs,
// a plain sentence; a legacy `Pattern record:` read as the blessings section
// alone; shape problems reported, never thrown. Pure — no git here.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, recordsInLog, namesIn, glossaryTerms, SECTIONS } from "../src/lib/zdd-record.mjs";

const GOOD = `feat: offers (CAS-1)

ZDD record:
glossary:
- confirmed: the glossary says an "offer" is a bid on a job, so the new table is called offers, not bids
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

test("parseRecord: a well-formed record parses every section with no problems; trailers after it are not lines", () => {
  const r = parseRecord(GOOD);
  assert.equal(r.kind, "zdd");
  assert.equal(r.amended, false);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(Object.keys(r.sections), SECTIONS);
  assert.equal(r.sections.glossary.length, 2);
  assert.deepEqual(r.sections.glossary[0], { verb: "confirmed", text: 'the glossary says an "offer" is a bid on a job, so the new table is called offers, not bids' });
  assert.equal(r.sections.adrs[0].verb, "turned");
  assert.deepEqual(r.sections.blessings.map((e) => e.verb), ["followed", "minted"]);
  assert.deepEqual(r.sections.map.map((e) => e.verb), ["reused", "stored"]);
  assert.deepEqual(r.sections.comments, [], "'- none' is an empty section");
});

test("parseRecord: no heading → null; an amended record is flagged", () => {
  assert.equal(parseRecord("fix: a typo\n\nNothing here.\n"), null);
  const r = parseRecord("fix\n\nZDD record (amended):\nglossary:\n- none\nadrs:\n- none\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n");
  assert.equal(r.amended, true);
  assert.deepEqual(r.problems, []);
});

test("parseRecord: shape problems — a missing section, an unknown verb, reused outside map, a turned with no counterfactual, a blessing verb elsewhere", () => {
  const r = parseRecord(`x

ZDD record:
glossary:
- reused: a term, somewhere
adrs:
- turned: ADR-0003 is about retries
- followed: ADR-0003
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
  // Lines that parsed still count (one typo never erases a commit).
  assert.equal(r.sections.adrs.length, 2);
  assert.equal(r.sections.map.length, 0);
});

test("parseRecord: sections out of order and an unknown section are named; '- none' with a sentence is a problem", () => {
  const r = parseRecord("x\n\nZDD record:\nadrs:\n- none\nglossary:\n- none because\nmetadata:\n- stored: a route\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n");
  const p = r.problems.join("\n");
  assert.match(p, /sections out of order \(adrs, glossary/);
  assert.match(p, /unknown section 'metadata'/);
  assert.match(p, /glossary: '- none' takes no sentence/);
});

test("parseRecord: a legacy Pattern record is the blessings section alone, with its verbs, and no missing-section problems", () => {
  const r = parseRecord(`feat: x

Pattern record:
- followed: jobs: How do I add a cron? — stall sweeper
- dropped candidate: How do I log? — because it was one site
- no blessing applied: the migration
- precedent: src/api/offers.ts — declined — because it was a one-off
`);
  assert.equal(r.kind, "pattern");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sections.blessings.map((e) => e.verb), ["followed", "dropped candidate", "no blessing applied", "precedent"]);
  for (const s of SECTIONS) if (s !== "blessings") assert.deepEqual(r.sections[s], []);
});

test("parseRecord: CRLF messages and a control character in a line are handled; the excerpt is printable", () => {
  const r = parseRecord("x\r\n\r\nZDD record:\r\nglossary:\r\n- none\r\nadrs:\r\n- none\r\nblessings:\r\n- none\r\nmap:\r\n- bogus\x07: x\r\ncomments:\r\n- none\r\n");
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /map: a line with no known verb: 'bogus\?: x'/);
});

test("recordsInLog: splits git's %H%x1f%B%x1e stream into commits, parsing each; a chunk with no hash is dropped", () => {
  const log = `abc1234567\x1fsubject one\n\nZDD record:\nglossary:\n- none\nadrs:\n- none\nblessings:\n- none\nmap:\n- none\ncomments:\n- none\n\x1e` + `def7654321\x1fplain commit\n\x1e` + `garbage\x1e`;
  const commits = recordsInLog(log);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].hash, "abc1234567");
  assert.equal(commits[0].subject, "subject one");
  assert.equal(commits[0].record.kind, "zdd");
  assert.equal(commits[1].record, null);
});

test("namesIn: ADR numbers anywhere in the record; terms and questions as whole matches, case-insensitive", () => {
  const r = parseRecord(GOOD);
  const n = namesIn(r);
  assert.deepEqual([...n.adrs], ["0015"]);
  assert.equal(n.mentions("Offer"), true);
  assert.equal(n.mentions("How do I add a scheduled job?"), true);
  assert.equal(n.mentions("thing"), false, "save_thing() is an identifier, not the term");
  assert.equal(n.mentions("stalls"), false, "'stall' is not 'stalls'");
  assert.equal(n.mentions("Nothing"), false);
});

test("glossaryTerms: every **Term**: opener, in order, deduped", () => {
  assert.deepEqual(glossaryTerms("# G\n\n**Thing**: a thing.\n\n**Audit trail** — the log.\n\n**Thing**: again.\nnot **bold** inline\n"), ["Thing", "Audit trail"]);
});
