import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGlossaryTerms,
  diffRanges,
  termsForRanges,
  changedTerms,
  parseNameStatus,
} from "../src/lib/store-changes.mjs";

const GLOSSARY = [
  "# Ubiquitous Language", // 1
  "", // 2
  "Preamble prose.", // 3
  "", // 4
  "**Member**:", // 5
  "An end user.", // 6
  "_Avoid_: user.", // 7
  "", // 8
  "**Journey**:", // 9
  "The authored graph.", // 10
  "", // 11
  "**Journey Run**:", // 12
  "One execution.", // 13
].join("\n");

test("parseGlossaryTerms finds bold-colon entries with 1-indexed lines", () => {
  assert.deepEqual(parseGlossaryTerms(GLOSSARY), [
    { term: "Member", line: 5 },
    { term: "Journey", line: 9 },
    { term: "Journey Run", line: 12 },
  ]);
});

test("parseGlossaryTerms ignores bold cross-references mid-line", () => {
  assert.deepEqual(parseGlossaryTerms("See **Member**: yes\n**Real**: entry"), [
    { term: "Real", line: 2 },
  ]);
});

test("diffRanges parses both sides of -U0 hunk headers", () => {
  const diff = [
    "@@ -5,2 +5,3 @@",
    "+new line",
    "@@ -20 +22 @@",
    "+x",
    "@@ -30,4 +33,0 @@", // pure deletion
  ].join("\n");
  assert.deepEqual(diffRanges(diff), [
    { old: { start: 5, count: 2 }, new: { start: 5, count: 3 } },
    { old: { start: 20, count: 1 }, new: { start: 22, count: 1 } },
    { old: { start: 30, count: 4 }, new: { start: 33, count: 0 } },
  ]);
});

test("termsForRanges maps ranges to enclosing terms, in glossary order", () => {
  // line 6 is inside Member; line 10 inside Journey
  assert.deepEqual(
    termsForRanges(GLOSSARY, [{ start: 10, count: 1 }, { start: 6, count: 1 }]),
    ["Member", "Journey"],
  );
});

test("termsForRanges spans multiple terms and dedupes", () => {
  assert.deepEqual(termsForRanges(GLOSSARY, [{ start: 7, count: 4 }]), [
    "Member",
    "Journey",
  ]);
});

test("termsForRanges skips preamble-only changes", () => {
  assert.deepEqual(termsForRanges(GLOSSARY, [{ start: 3, count: 1 }]), []);
});

test("termsForRanges ignores zero-count ranges (side untouched by the hunk)", () => {
  assert.deepEqual(termsForRanges(GLOSSARY, [{ start: 10, count: 0 }]), []);
});

// changedTerms: the deletion-aware composition (Codex review finding).
const OLD_G = GLOSSARY; // Member(5) / Journey(9) / Journey Run(12)

test("changedTerms: whole-term deletion highlights nothing — not the neighbor", () => {
  // Journey (lines 9-11) deleted entirely; new side is positioned after
  // Member's block with count 0.
  const newG = [
    "# Ubiquitous Language", "", "Preamble prose.", "",
    "**Member**:", "An end user.", "_Avoid_: user.", "",
    "**Journey Run**:", "One execution.",
  ].join("\n");
  const diff = "@@ -9,3 +8,0 @@";
  assert.deepEqual(changedTerms(OLD_G, newG, diff), []);
});

test("changedTerms: deletion inside a surviving term highlights that term", () => {
  // Member loses its _Avoid_ line (old line 7); Member survives.
  const newG = [
    "# Ubiquitous Language", "", "Preamble prose.", "",
    "**Member**:", "An end user.", "",
    "**Journey**:", "The authored graph.", "",
    "**Journey Run**:", "One execution.",
  ].join("\n");
  const diff = "@@ -7 +6,0 @@";
  assert.deepEqual(changedTerms(OLD_G, newG, diff), ["Member"]);
});

test("changedTerms: plain edit highlights the edited term via the new side", () => {
  const diff = "@@ -10 +10 @@";
  assert.deepEqual(changedTerms(OLD_G, OLD_G, diff), ["Journey"]);
});

test("termsForRanges reaches the last term (open-ended span)", () => {
  assert.deepEqual(termsForRanges(GLOSSARY, [{ start: 13, count: 1 }]), ["Journey Run"]);
});

test("termsForRanges emits a duplicated term name once", () => {
  const g = ["**Dup**:", "first entry.", "**Other**:", "x.", "**Dup**:", "legacy entry."].join("\n");
  assert.deepEqual(termsForRanges(g, [{ start: 2, count: 1 }, { start: 6, count: 1 }]), ["Dup"]);
});

test("parseNameStatus classifies adds/edits, skips deletes, takes rename targets", () => {
  const out = parseNameStatus(
    [
      "A\tzdd/adr/0034-new-thing.md",
      "M\tzdd/adr/0021-wiki-embeds-glossary-and-adr-corpus.md",
      "D\tzdd/adr/0002-dead.md",
      "R095\tzdd/adr/0005-old-name.md\tzdd/adr/0005-new-name.md",
      "M\tzdd/glossary.md",
      "M\tzdd/adr/_issues.json", // not an ADR file
    ].join("\n"),
    "zdd/glossary.md",
    "zdd/adr/",
  );
  assert.equal(out.glossaryChanged, true);
  assert.deepEqual(out.adrs, [
    { file: "0005-new-name.md", status: "updated" },
    { file: "0021-wiki-embeds-glossary-and-adr-corpus.md", status: "updated" },
    { file: "0034-new-thing.md", status: "new" },
  ]);
});

test("parseNameStatus with no store paths reports nothing", () => {
  const out = parseNameStatus("", "zdd/glossary.md", "zdd/adr/");
  assert.deepEqual(out, { adrs: [], glossaryChanged: false });
});
