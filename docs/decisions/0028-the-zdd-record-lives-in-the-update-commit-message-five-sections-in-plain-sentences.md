# 0028 — The ZDD record lives in the update commit's message only: five fixed sections, fixed verbs, plain sentences

**Date:** 2026-10-10 · **Status:** accepted · **Origin:** CAS-105 (ZDD 2.4) grill questions 4 and 5. **Extends** [0015](0015-choose-patterns-blessings-are-read-before-building.md) (the pattern record) and [0027](0027-a-use-is-a-decision-turned-or-confirmed-said-at-the-moment-never-a-gate.md) (what a use is).

## Context

The pattern record proved the commit message as a home: it rides with the
code, is reviewed with the PR, and needs no file an adopter's CI must
carry. Generalising it to every artifact raises two choices: whether a file
should hold it too, and how strict its shape must be, since a command will
now parse it (decision 0029) and a host harness will copy it out.

## Decision

1. **The commit message is the only home.** "update ZDD" writes the record,
   under a `ZDD record:` heading, into the update commit's message, from the
   `ZDD:` lines said during the session and the reconciled pattern plan.
   `load` and `patterns` write nothing durable. A host harness (a build
   summary, a tracker page) copies the record **out of the message**, never
   the other way round, so the commit stays the one source the tally trusts.
   ZDD stays tool-neutral: no tracker, no host, no new artifact.
2. **The shape is fixed, the words are a person's.**
   ```
   ZDD record:
   glossary:
   - confirmed: the glossary says an "offer" is a bid on a job, so the new table is called offers rather than bids
   - stored: added the term "stall" (a job that stopped reporting progress)
   adrs:
   - turned: ADR-0015 says the app never reads the database directly; I was about to query jobs from Supabase and went through /api/jobs instead
   blessings:
   - followed: "How do I add a scheduled job?" (jobs slice) for the stall sweeper
   map:
   - reused: save_thing() in src/db.py already saves and logs a change, so I did not write a new helper
   - stored: the offers feature page now lists the /offers route and the offers table as its own
   comments:
   - none
   ```
   All five sections, always, in that order; `- none` when a section has
   nothing. Every line opens with one fixed verb: `turned`, `confirmed`,
   `stored` in any section; `reused` under `map` only; and under
   `blessings` today's verbs unchanged (`followed`, `departed`, `minted`,
   `dropped candidate`, `precedent`, `no blessing applied`). After the verb,
   **one sentence a reviewer who has never read ZDD's docs can follow**: it
   names the thing by something they can open (a term, an ADR number, a
   blessing's question, a path) and says what happened to the decision. For
   `turned` and `confirmed` the sentence says what would otherwise have
   happened; for `stored`, what was written and in a few words what it means.
   The verbs are what the tally counts; the sentence is for people.
3. **A later update on the same branch** writes `ZDD record (amended):`
   with only the lines that changed, as the pattern record did. **`Pattern
   record:`** stays accepted by the tally and the lint for history written
   before 2.4, read as the `blessings` section alone.

## Consequences

- Update commit messages grow by ten to fifteen lines on a typical PR. That
  is the record being readable in `git log` by anyone on the team, which is
  also what makes it worth copying into a build summary.
- **A squash merge loses the record** unless the merger keeps the message.
  This repo and both adopters merge with merge commits; the upgrade note
  says so for anyone who does not.
- Cascade's and DiO's adoption (a build summary section, Notion, the stage
  line vocabulary) is their upgrade tasks' work (CAS-104 for Cascade), and
  takes 2.4.0 rather than 2.3.0.

## Rejected

- **A committed record file** (`zdd/record/<branch>.md`). Greppable and
  squash-proof, but the first artifact that would exist only for ZDD's own
  bookkeeping, and a new generated file adopters' CI must carry (decision
  0002 calls a mandatory one a breaking change).
- **The engine's dialect in the lines** (`stored: slice offers claims
  route:/offers, table:db/offers`). Exact and short, and unreadable to the
  reviewer the record is for.
