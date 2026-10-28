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

Why it exists: **blessings** — one file each in the blessing store,
`zdd/blessings/` — name the existing code to copy or extend and the pattern
to refuse, because the most common pattern in a codebase is often the
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

The defaults are below; `zdd/config.json` may move any of them under
`paths.*` (`paths.blessingIndex`, `paths.blessingsDir`, `paths.patternsPlan`),
so read that block first when it exists. The agent index and metadata paths
are the ones `load` used.

- the **blessing index** — `zdd/blessing-index.md` (generated; never edit)
- the **blessing store** — `zdd/blessings/`, one file per blessing; its file
  name (without `.md`) is the blessing's name
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
   trigger question linked to its file, then **where** (`copy:` or
   `extend:` and the code) and **why** (the ADR or the reason). House rules
   come first, under "Applies to" their app. A line that opens with
   **high** is a blessing marked `importance: high` — often needed and
   costly to reinvent — and comes first in its section: when its question
   is anywhere near the work, open it.
   - For **every app the work touches**, open each of its house rules in
     full — they apply to all work in that app.
   - For **each piece**, open in full (its file in the blessing store) every
     blessing whose question matches the piece. Read the whole blessing: the
     `where:` code itself, the refusal and the reason, and the ADR it cites
     when the choice is close.
   - A **`copy`** blessing shows a method: you write new code shaped like
     the exemplar, and the exemplar is not touched.
   - An **`extend`** blessing names shared code to reuse, and to extend if
     you must. Its index line names **who uses it** ("used by 3: …"): the
     files that import it, read from the source on every render (decision
     0046). Extending it means **retesting every one of them**: put them on
     the plan's *Retest* line. "Users unknown to ZDD (…)" says why ZDD
     cannot tell — a kind of file no adapter reads, or a read cut short;
     "used by 3 or more" is a read cut short too. Then grep for the callers
     before you plan the change, and list what you find.
4. **Look for logic that already exists.** Blessings say *how to build X*;
   "this already exists, reuse it" is the inventory's job. For each piece,
   check the agent index's feature sections and their pointers, and the
   metadata (`zdd/metadata/`: functions, routes, modules, tables) for
   something that already does it, then grep the code. A function to reuse is
   a line in the plan, so duplicated logic is caught as well as a wrong
   pattern. **Say it at the moment** (`ZDD: map reused — ZDD's codebase
   metadata shows save_thing() in src/db.py already saves and logs a change,
   so no new helper`): that is the one use the inventory gets credit for.
   Name blessings the same way as you open them ("I've found a ZDD blessing
   for uploading a file, so I'll read its exemplar") and when you propose
   one ("I'm going to create a ZDD blessing here for …"). The plan's *Reuse* line below
   is the same reuse written down; "update ZDD" carries it into the ZDD
   record's `map` section as one `reused` line (decision 0027).
5. **Name any unblessed precedent.** Existing code you intend to copy that no
   blessing covers is a decision too: say which file, and why it is the right
   model. Copying it without saying so is how the nearest example wins.
6. **Choose, per piece, exactly one outcome:**
   - **follow** `<blessing>` ("<trigger question>") — because …
   - **depart from** `<blessing>` ("<trigger question>") — because … (a
     departure with a reason is legitimate; a silent one is the failure this
     step exists to prevent). Departing from a **high** blessing is
     building your own version of what it names: say why its code cannot
     serve, not only that this piece differs.
   - **no blessing applies** — say what you checked
   - **new pattern, candidate blessing** — the question it would answer (a
     *kind* of work that recurs, not this feature's instance), the existing
     code it would point at — a shared helper or base layer to reuse, named
     now if it exists, or the code this work will write — whether it is
     `copy` or `extend`, the one trap it refuses, and the reason. It must pass the test in
     [authoring.md](../authoring.md): pointer to reusable code first; a rule
     with no code to point at is an ADR and a code comment, not a blessing.
     Propose **`importance: high`** only when it is both **often needed**
     and **costly to reinvent**, and say so with the reason; the developer
     confirms it at "update ZDD". Keep it scarce — lint warns past a fifth
     of the store.
   - Seeing a piece about to **reinvent** what an existing normal blessing
     names (a modal of its own where a side-peek blessing applies) is the
     moment to **suggest** marking that blessing high: say so, with the
     reason, and put it on the plan's *Proposed high* line. Never edit the
     blessing file here: "update ZDD" confirms it against the final diff
     and writes it on the developer's yes.
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
Apps touched: <app>, <app> (house rules read in full)

## Plan

- **<piece>** — follow `<blessing>` ("<trigger question>") — because …
- **<piece>** — depart from `<blessing>` ("<trigger question>") — because …
- **<piece>** — no blessing applies — checked <questions>
- **<piece>** — new pattern, candidate blessing (<copy | extend>[, proposed high]): "<Question?>
  Copy <exemplar> — never <refused pattern>." — because …

## Proposed high

- `<blessing>` ("<trigger question>") — often needed and costly to reinvent: …

## Retest

- **<piece>** — extends `<blessing>`'s `<where>`: retest <user>, <user> (from
  the index; or, where it says "users unknown to ZDD (…)", found by grep: …)

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
  it mints the candidate blessings that survived (one file each, `where:`
  and `kind:` in the header, reason given), checks every *Retest* line was
  retested (or the plan says why not), records dropped candidates with why, offers any unblessed precedent
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
