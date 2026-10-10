# 0027 — A use is a decision turned or confirmed, never a read: said in chat at the moment, informational, never a gate

**Date:** 2026-10-10 · **Status:** accepted · **Origin:** CAS-105 (ZDD 2.4) grill questions 1, 2, 3 and 8, from a conversation with Rich the morning after 2.3.0 shipped. **Extends** [0015](0015-choose-patterns-blessings-are-read-before-building.md): the pattern record it introduced becomes one section of a record that covers every artifact.

## Context

Only blessings leave a trace today: "update ZDD" writes a `Pattern record:`
into the update commit's message. The glossary, the ADRs, the semantic map
and agent index, the codebase metadata and the code comments are used
silently, so nobody can say what ZDD bought on a task, and a developer
watching a session cannot tell why it chose what it chose. Rich's baseline
(2026-10-10, 92 Cascade session transcripts) counts reads: ADR files opened
in 43 sessions, the glossary in 23, the metadata in 1. Reads are not
benefit; many ADR reads were sessions writing ADRs. The evidence wanted is
which artifacts change what the agent does, over time, which is also the
case for ZDD as a plugin.

## Decision

1. **A use is a moment an artifact changed or confirmed a decision, never a
   read.** Two verbs: **turned** (the session was about to do X; the artifact
   turned it to Y) and **confirmed** (the session was going to do Y; the
   artifact said yes). Each use names the thing (a term, an ADR number, a
   blessing's question, a path) and carries the counterfactual in the same
   sentence: what would otherwise have happened, in those words (*would*,
   *about to*, *instead*, *otherwise*, *rather than*; a bare *not* or
   *changed* is how any summary of an ADR reads, and is not one). **A line
   with no counterfactual is a read and does not count.** That rule, not a gate, is
   the guard against the agent grading its own usefulness. Loading is never
   a use: `load`'s declaration gains the `ZDD:` prefix (`ZDD: loaded …`) so
   every ZDD utterance scans alike, and the instructions say plainly that it
   logs nothing.
2. **Five artifact sections, and no section for the codebase metadata:**
   `glossary`, `adrs`, `blessings`, `map` (the semantic map and the agent
   index together, since the index is rendered from the map and a session
   cannot tell which it used), `comments`. The metadata is reached through
   index pointers and the "choose patterns" reuse check, so its one real win,
   a function or route that already existed, is credited under `map` with a
   third verb, **reused** (allowed only there). A `metadata` section would
   read "none" on nearly every task and tempt the tally into calling the one
   artifact that costs no human effort dead weight.
3. **Said in chat at the moment, informationally.** When an artifact turns,
   confirms or supplies reuse for a decision, the session prints one line,
   inline in whatever it is writing: `ZDD: <artifact> <verb> — <the
   sentence>`. It then carries on. No stop, no confirm, no new gate: a
   developer watching can interrupt and argue; one who is not loses nothing,
   because the same line lands in the record (decision 0028) where the PR's
   reviewer sees it. Nothing is said when nothing was used.

## Consequences

- A wrong `turned` can run through a whole build before anyone sees it. The
  record and its review are the mitigation, by design.
- "Confirmed" lets an ADR that keeps every session on the right path show as
  what it is; the tally reports turned and confirmed apart, so a confirm-only
  artifact is visible as such rather than as dead weight or as a steer.
- The counterfactual rule is enforceable only by shape (decision 0029 warns
  on a `turned` or `confirmed` with no "would have" / "was about to" sense).
  Whether the sentence is honest stays with the reviewer.
- The instructions file (`zdd/instructions.md`, decision 0024) carries the
  say-it rule, so it applies in both hosts without a skill being invoked.

## Rejected

- **Changed only, no confirmed.** Fewest lines and hardest to game, but it
  under-reports exactly the artifacts that work best.
- **Changed, confirmed or read.** The baseline Rich already measured by hand,
  and the thing the task set out not to count.
- **A stop on every line** so the developer can question it. It turns a
  decision an ADR already made into a fresh question every session.
- **A `metadata` section.** Double-counts the index's use and lands the
  dead-weight verdict on generated plumbing.
