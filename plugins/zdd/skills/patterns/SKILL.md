---
name: patterns
description: "\"choose patterns\" — the Zero-Drift Docs step between design and code. With ZDD loaded and the design settled, read the blessing index whole, open the blessings that match the planned work, check for existing code to reuse, and commit a pattern plan (zdd/patterns-plan.md): per piece of work, follow a blessing, depart from one and why, no blessing applies, or a new pattern that is a candidate blessing. Use once the design is settled and before any code is written for a unit of work; triggers on \"choose patterns\"."
---

# zdd:patterns — choose patterns

The spoken form is **"choose patterns"**. It sits between the two other verbs:
**load** says what exists, the design says what we want, and this step
decides, before a line of code, *which existing pattern each piece of the work
copies* — and writes the decision down, so it can be checked against the code
at **update**.

Why it exists: the map's **blessings** name the exemplar to copy and the
pattern to refuse, because the most common pattern in a codebase is often the
deprecated one. A blessing only helps if it is read *before* the code is
written. Left to chance, a session copies the nearest example, misses the
blessed one, and rewrites logic that already exists. "Choose", not "seek": the
output is a committed, reasoned choice, and "no blessing applies" is a choice
too.

## When

- **After the design is settled, before any code** for a unit of work. It
  needs both inputs: ZDD loaded (what exists) and the design (what we want).
  If the design is not settled, stop and say so — this step chooses patterns
  for a design; it does not make one.
- **On a path that splits work into tickets, run it per ticket, when that
  ticket's build starts.** A spec may name likely blessings as a hint; only
  the ticket's own step binds.
- Not for work that writes no code (a product or docs-only change).

## Paths

The defaults are below; `zdd/config.json` may move either under `paths.*`
(`paths.blessingIndex`, `paths.patternsPlan`), so read that block first when it
exists. The agent index and metadata paths are the ones `load` used.

- the **blessing index** — `zdd/blessing-index.md` (generated; never edit)
- the **pattern plan** — `zdd/patterns-plan.md` (this step writes it)

## Steps

1. **Check the inputs.** ZDD is loaded in this session (if not, run `load`
   first and declare it). Name the design in one line, and list the **pieces of
   planned work** — one line each, at the grain of "a new endpoint", "a new
   screen", "a table and its migration", "a background job", not of files.
   Name the **apps** the work touches.
2. **Read an existing plan first.** If the plan file is already on the branch
   (a resumed build, another ticket of the same branch), read it: add this
   work's pieces under their own heading and keep everything already there.
3. **Read the blessing index whole.** It is one line per blessing: the
   trigger question and the reason, app-level slices first.
   - For **every app the work touches**, open each of its app-level
     blessings in full — they are cross-cutting, so all of them apply.
   - For **each piece**, open in full (in its slice) every blessing whose
     question matches the piece. Read the whole blessing: the exemplar, the
     refusal and the reason, and the ADR it cites when the choice is close.
4. **Look for logic that already exists.** Blessings say *how to build X*;
   "this already exists, reuse it" is the inventory's job. For each piece,
   check the agent index's feature sections and their pointers, and the
   metadata (`zdd/metadata/`: functions, routes, modules, tables) for
   something that already does it, then grep the code. A function to reuse is
   a line in the plan, so duplicated logic is caught as well as a wrong
   pattern.
5. **Name any unblessed precedent.** Existing code you intend to copy that no
   blessing covers is a decision too: say which file, and why it is the right
   model. Copying it without saying so is how the nearest example wins.
6. **Choose, per piece, exactly one outcome:**
   - **follow** `<slice>: <trigger question>` — because …
   - **depart from** `<slice>: <trigger question>` — because … (a departure
     with a reason is legitimate; a silent one is the failure this step
     exists to prevent)
   - **no blessing applies** — say what you checked
   - **new pattern, candidate blessing** — the question it would answer, the
     exemplar it would point at once written, the pattern it refuses — because …
7. **Write the plan file** in the shape below, **say the plan aloud** (one
   line per piece), and commit it on the branch. It is a working file: it
   crosses sessions and machines because it is committed.

## The plan file

```markdown
# Pattern plan

<!-- Working file from "choose patterns". "update ZDD" reconciles it
against the final diff, mints the blessings that survived, records the
rest in the update commit's message and deletes this file in that commit.
CI (lint --merge) fails while it exists. -->

Work: <the unit of work, one line; a ticket id if there is one>
Apps touched: <app>, <app> (app-level blessings read in full)

## Plan

- **<piece>** — follow `<slice>: <trigger question>` — because …
- **<piece>** — depart from `<slice>: <trigger question>` — because …
- **<piece>** — no blessing applies — checked <slices / questions>
- **<piece>** — new pattern, candidate blessing: "<Question?> Copy <exemplar>
  — never <refused pattern>." — because …

## Reuse

- **<piece>** — reuse `<function>` in `<path>` instead of writing it again

## Unblessed precedent

- **<piece>** — copying `<path>`, which no blessing covers — because …

## Changes during the build

- **<piece>** — was <outcome>, now <outcome> — because …
```

Leave a section out when it has nothing in it. **Changes of mind during the
build are edits to this file, with their reason**, under *Changes during the
build* — never a silent rewrite of the plan line.

## What happens next

- **The build** follows the plan. When the code disagrees with it, the plan is
  edited (with the reason) or the code is — not ignored.
- **"update ZDD"** reconciles the plan against the code *as it will merge*:
  it mints the candidate blessings that survived (exemplar linked, reason
  given), records dropped candidates with why, offers any unblessed precedent
  as a candidate (minted only on the developer's word), writes the reconciled
  record into the update commit's message, and **deletes the plan file in
  that commit**. Never at merge: a merge runs no code.
- **CI** (`lint --merge`) fails while the plan file exists, so a plan cannot
  reach the base branch unreconciled. A local `lint` only warns: the branch
  stays pushable while the build runs.

## When there are no blessings yet

The index says "No blessings yet". The step still runs: every piece is "no
blessing applies" or a new pattern, and the reuse and precedent checks still
catch duplicated logic. This is how a young map gets its first blessings —
proposed here, decided at update.
