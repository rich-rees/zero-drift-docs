# 0029 — The tally reads records out of git and its denominator out of the stores; a malformed record warns at `lint --merge`, never fails

**Date:** 2026-10-10 · **Status:** accepted · **Origin:** CAS-105 (ZDD 2.4) grill questions 6, 7 and 9. **Extends** [0028](0028-the-zdd-record-lives-in-the-update-commit-message-five-sections-in-plain-sentences.md) (the record's shape) and [0009](0009-unclaimed-records-warn-never-fail.md) (the warning tier).

## Context

The record answers "what did ZDD do on this PR". The evidence Rich wants is
over time: per artifact, how often it turned, confirmed or supplied reuse,
what it stored, and which artifacts were there and never mattered. The
last needs a denominator the record does not carry, because a record says
what was used, not what was loaded. And a shape a command parses is a shape
that can silently drift: a misspelt section or a missing counterfactual
drops a commit out of the counts with no one told.

## Decision

1. **`zdd-engine tally [--since <ref|date>] [--json]`** walks `git log` on
   the current branch, parses every `ZDD record:`, `ZDD record (amended):`
   and legacy `Pattern record:` block, and prints one row per section with
   the counts of `turned`, `confirmed`, `reused` (map only) and `stored`
   over the update commits in range, then **the ADRs, glossary terms and
   blessings in the current stores that no record in the range ever
   named**. Comments and the map have no item list to check against, so
   they get counts only. A line the shape refuses (a `turned` with no
   counterfactual, a verb in the wrong section) is a read, not a use
   (decision 0027): the tally names it, by commit and why, and leaves it
   out of the counts and the naming; the rest of its record still counts,
   so one typo never erases a commit. `--json` is the shape a host copies
   into its own tracker. A `--since` that is not a commit must be an ISO
   date (year 1970–2099), read as UTC when it carries no offset: git's
   looser date grammar takes `garbage` and a year past 2099 as no filter
   at all, and a bare date as the machine's midnight, which is not the
   same bytes on every machine.
2. **The denominator comes from the stores, not from the record.** The
   tally reads the ADR index, the glossary and the blessing index as they
   are now. No `loaded:` line is written: it would depend on a session
   remembering what it read, lengthen every record, and still not say which
   specific ADR nobody cites. Reading the stores is deterministic and names
   them.
3. **`lint --merge` reads the branch's commits since the base and warns**
   on a malformed record: a section missing, empty or out of order, a verb
   it does not know, `reused` outside `map`, `- none` beside lines, a
   `turned` or `confirmed` whose sentence carries no counterfactual
   construction (*would*, *about to*, *instead*, *otherwise*, *rather
   than*). **Warn only, never fail**, in the tier
   decision 0009 set. It checks shape; whether a sentence is true stays with
   the reviewer. A branch with no update commit yet is normal, so absence of
   a record is never a warning. A plain `lint` does not read git at all.
4. **This ships as 2.4.0, a minor.** A new engine command, a new warning in
   `lint --merge`, a rewritten `zdd/instructions.md` that "upgrade ZDD"
   replaces in every adopter, and changed text in `load`, `patterns` and
   `update`. No config-schema or metadata-contract break and no new
   mandatory generated file, so not a major; a new command and a changed
   update contract are more than a patch, and the release checklist's
   upgrade-note and "Upgrading to X.Y" slots are per minor. The task was
   named 2.3.1; the task and CAS-104 carry the correction.

## Consequences

- `lint --merge` gains a git dependency it did not have, the same one
  `freshness` already carries. Where git cannot answer (no base ref, a
  shallow clone), the record check says so in one line and skips, as
  decision 0026 had derive do for the ignore set.
- A record under the old `Pattern record:` heading counts toward the
  `blessings` section only, so history from before 2.4 is not lost and is
  not inflated.
- The "never named" list is only as good as the range: an ADR written last
  week shows as never named until a record cites it. The report says the
  range it covered.
- The engine stays LLM-free: parsing and counting, no judgment.

## Rejected

- **Nothing checks the record**, the tally skips what it cannot parse. A
  record nobody can parse is drift of the kind ZDD exists to catch, and the
  PR check is the last moment someone can still fix it.
- **A failing lint** on a malformed record. A commit message cannot be
  fixed without a rewrite, and the tier for "wrong but not broken" is a
  warning (decision 0009).
- **2.3.1, a patch.** Continuity with CAS-104's text, at the cost of bending
  the per-minor release slots and a changelog where a patch carries a
  command.
