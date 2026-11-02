# 0048 — The app owns its adapters; ZDD ships starters, not readers

**Date:** 2026-11-02 · **Status:** accepted · **Origin:** the design session on 2026-11-02 (Rich's calls, eight questions), after an adopter's rename migration showed that `supabase` follows no function rename. **Supersedes, in part:** [0036](0036-the-core-knows-no-stack-adapters-live-beside-it.md), points 2 to 5: the catalogue leaves the package and an adapter is copied by default, not by exception. [0039](0039-detection-lives-in-each-adapter-bootstrap-builds-the-gaps-and-checks-together.md), points 1 and 2: detection stays in the adapter, proves its fit, and a part is split in two. [0040](0040-adapters-declare-a-contract-number-and-pass-one-standard-suite.md), points 3 and 6: no adapter is updated by a release, so every adapter is the adopter's own. **Keeps** the contract, the standard suite and 0040 point 2 (open until 1.0).

## Context

0036 took every stack out of the core, but the bundled adapters stayed in the
one package, so a defect in one still needed a ZDD release and every adopter's
pin to move. It has happened twice since an adopter's routes went weeks with no
edges to tables: first the data-access reader, then the migration reader.
Both failures were silent, and the second reached past the split:

- `ALTER FUNCTION … RENAME`, `ALTER TABLE IF EXISTS ONLY … RENAME`, `SET
  SCHEMA` and a rename inside a `DO` block change nothing and say nothing, and
  a column rename leaves a stale foreign key.
- The tripwire for unread statements prints only under `--verbose`.
- `supabase` says yes to any `.sql` under a `migrations` folder, so "database
  access" reads as covered and 0039's offer to build an adapter never comes.
  Tried on files in each shape: Prisma's folder per migration loses every later
  change; goose and dbmate replay their undo steps and end with no tables;
  Flyway applies `V10` before `V9`; MySQL and SQL Server quoting yield no tables.
- `sqlalchemy` claims the same part while reading only queries, which hides a
  repo with no schema reader.

The copy route 0036 promised was never finished: the `extractor` skill does not
mention it, and bundled adapters import core helpers the package does not
export. A hand-written local adapter is the only route that works today.

## Decision

1. **The adopter's repo owns every adapter it runs.** It can fix, delete or
   recreate anything to do with one without a ZDD release. The core runs no
   adapter of its own, and a new stack version is the adopter's change to make.
2. **The catalogue becomes a starter library,** a second npm package with a
   version of its own, outside the engine package. The core depends on nothing
   in it, and a repo whose adapters are in place needs it for nothing: `derive`,
   CI and the hooks run without it. The core keeps a few test-only adapters for
   its own suites, unpublished.
3. **The library is an offer, never a requirement.** Bootstrap reads it, asks
   every starter whether it fits, and says what it found and why it would help:
   "I recognise your stack is Supabase with SQLAlchemy. I already have adapters
   for that in my starter library. Would you like me to bring them across to
   save you time and tokens?" On a yes it copies them in, with their tests, and
   adapts them to the repo. On a no, or when no starter fits, it builds from
   nothing against the contract, and a repo can do that for every adapter it
   has. One library, one folder per adapter; separate packages, ours or anyone's,
   stay open for later.
4. **A copied adapter is fully self-contained.** It carries its own helpers.
   Its one link to ZDD is the contract: the `io` it is handed and the records
   it returns. The `extractor` skill and bootstrap know that contract and build
   to it.
5. **An adapter reports what it saw and could not read.** The report is part of
   the contract. Every item shows in every run and in the human index, and fails
   CI until the adapter is fixed or the item is marked fine, once, with the mark
   kept in the repo. The coverage report stays as the second net: an adapter can
   only report what it noticed it missed.
6. **A starter only claims what it proved it can read.** Detection is a trial
   read, and a starter whose read does not make sense declines, so the part
   stays uncovered and bootstrap offers to build. "Database access" becomes
   two parts, schema and queries, so a repo with one of them is told about
   the other.
7. **A starter's fixes reach a copy on a yes.** A copy records the library
   version it came from, and each fix carries a note saying what changed and
   who it affects. At session load the check compares the two; the session reads
   the note against the repo and recommends. The developer answers once, the
   answer is kept in the repo, and on a yes a session applies the fix and runs
   the adapter's tests. Offline, it says nothing. No model enters `derive`.
8. **"Upgrade ZDD" moves an adopter across in one step:** every adapter the repo
   uses is copied in unchanged and the records are proved byte-identical. The core
   drops its adapters in the same release. Items the new report finds are
   answered in the upgrade, so no upgrade turns CI red by surprise (0035).
9. **The contract is built as if locked.** It grows by optional steps. Until
   1.0 it may still change if it proves unfit (0040 point 2); at 1.0 it freezes.

## Consequences

- An adapter defect never needs a ZDD release. A starter defect costs a future
  adopter a flawed first draft, and no running repo anything.
- A ZDD upgrade cannot change what a repo's adapters produce, unless the contract
  changes.
- The hard parsers survive, as code every adopter holds. A defect in one is
  fixed once per copy, and the note narrows that but does not close it.
- A heavily changed copy is harder to patch from a starter's fix.
- Each adopter carries adapter code and tests, and bootstrap costs more time and
  tokens.
- The engine's suites and goldens are rebuilt around the test-only adapters, and
  every adopter takes one large PR, once.

## Rejected

- **Built in until it needs changing, then ejected.** Quicker to install and
  fixes keep arriving, but two kinds of adapter, and a generic reader in place
  until someone notices it is wrong, which is how both failures happened.
- **Finish the copy route and change nothing else.** The least work, and adapter
  defects would still need ZDD releases.
- **Starters stay in the engine package.** One package, but adapters stay tied to
  the core's version.
- **No starters: every adapter generated from the repo.** Rejected again for
  0036's reason: the hard parsers would be rewritten shallower each time.
- **A package per adapter.** Each would need its own publishing, and asking 25
  packages whether they fit means fetching them all, or a list of stacks in the core.
- **Helpers made public, or a helper package.** Smaller adapters, but a helper
  defect waits on someone else's release.
- **Applying a starter's fixes automatically.** The adapter would change with
  no one choosing it, which ends ownership.
- **Reporting unread items as a warning, or in a log.** A warning is what went
  unread for weeks.
- **Rebuilding each adopter's adapters at the move.** The best fit, but no proof
  nothing changed, and record ids would shift under the map and blessings.
