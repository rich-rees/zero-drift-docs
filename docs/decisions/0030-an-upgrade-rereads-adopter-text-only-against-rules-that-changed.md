# 0030 — An upgrade re-reads the adopter's text only against the rules that changed since the repo's pin

**Date:** 2026-10-13 · **Status:** accepted · **Origin:** 2.4.1 (ZDD 2.4.1) finding 3, Rich's call (question 3 of the task's design questions). **Narrows** the text pass 2.2.0 added and 2.3.0, finding 4 reshaped (one paragraph or bullet at a time); [0024](0024-zdd-instructions-in-a-file-of-their-own.md) is where the instructions moved into a file of their own.

## Context

On an upgrade, ZDD reads the adopter's own `CLAUDE.md` / `AGENTS.md` text,
outside its import line or block, a paragraph at a time, and lists every
unit that speaks to one of its rules, with what ZDD now says beside it, so
the team can read the two together: same, different or contradicting.

The second adopter's move to 2.3 listed 33 paragraphs. Every one restated a ZDD rule
and added the second adopter's own; none was droppable. Each later upgrade would list
the same 33 again, though neither side had changed. A pass that asks the
same question every release teaches the team to skip it, and then misses
the paragraph that a changed rule actually contradicts.

Two remedies were weighed. A stricter matcher (a unit counts only when it
restates a rule's substance, not just names its verb) means word lists
that miss and over-match unpredictably, and still re-asks about unchanged
rules on every upgrade. Recording which units the team has already
accepted would need a new store in the adopter's repo.

## Decision

1. **Every rule in `INSTRUCTION_RULES` carries `since`**: the release that
   last changed what it says.
2. **An upgrade from X lists a unit only for the rules changed after X**
   (the repo's engine pin before the run), and shows only those rules
   beside it. A unit speaking to no changed rule is not listed. A repo with
   no pin, or a pin that is not a version, is read against every rule.
3. **A test pins each rule's `says` (by hash) to its `since`**: changing
   what a rule says without moving its `since` fails, so a reworded rule
   is always re-read on the next upgrade.

## Consequences

- A team is asked about a paragraph once per change to the rule it speaks
  to, not once per upgrade.
- The first upgrade from before a rule existed (any pin before 2.3, for
  most rules) still lists everything: that read is the one that matters.
- A paragraph the team edits after an upgrade is not re-read until a rule
  it speaks to changes. That is the cost: the pass checks ZDD's changes
  against the team's text, never the team's changes against ZDD's rules.
- A rule whose wording is only reflowed must keep its `since` and get a
  new hash in the test, a deliberate step, never automatic.
