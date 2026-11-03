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
4. **A copied adapter is fully self-contained within the app.** What it needs
   comes with it, and code several starters share (`js`, `python`,
   `background`, the small helpers) is kept once, in one shared folder beside
   the adapters, the app's own. It arrives only with a starter that needs it,
   and an adapter built from nothing may use it or ignore it. An adapter's one
   link to ZDD is the contract: the `io` it is handed and the records it
   returns. The `extractor` skill and bootstrap know that contract and build to
   it.
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

## As built (ZDD-11 slice 1)

- **The step.** `unread` is an optional row of the contract table:
  `derive` may return `unread: [{ file, what }]` beside `records`. `CONTRACT`
  stays 1 (0040 point 2, and an optional step asks nothing of an adapter). An
  adapter without the list keeps working and says nothing. `file` is
  repo-relative and holds no control, format or line-separator character; `what`
  is shown as one line of plain text up to 300 characters. Extra keys on an
  item are ignored, so the step can grow by optional fields (point 9). An
  adapter may not mint a record of kind `unread`: that kind is the core's. An
  adapter reporting over 5,000 items stops derive: each is a file, and a
  hostile source must not choose how many.
- **An item is a record.** The core turns each item into a record of kind
  `unread` under `paths.metadataDir`, named `<adapter>--<hash>.json`, with no
  new path or mandatory file: a repo with nothing unread gets no folder. So
  `derive --check` keeps the list true, the prune removes what an adapter
  stops reporting, and `lint` and `render` read one list without running an
  adapter. Unread records are neither graph nodes nor claimable, and the
  coverage report does not count them: `graph.json`, the agent index and
  every other record are unchanged. Viewers get them ready-read, as blessings
  (0043).
- **An id** is `unread:<adapter>/<16 hex>`, a SHA-256 of the adapter, the file
  and the whole text as the adapter wrote it, line endings aside. No line
  number, so a mark survives the code around the item moving and lapses when
  the item changes, whitespace included. One statement written twice in a file
  is one item with one answer.
- **Where the marks live** (the slice's call): `zdd/config.json`, beside
  `claims` and `suiteChecks`, as `"unread": { "strict": true, "fine": [{ "id",
  "what", "why" }] }`. The repo's config is already where a repo's standing
  answers to a check live (`claims.allowUnclaimed`), and a mark then reviews
  as one reviewed line. `why` is required: a mark is read by the next person,
  and "fine" with no reason is how a gap goes unread again. `what` is a copy of
  the item's text for the reviewer, never compared.
  `bootstrap.mjs unread --mark=<id> --why=…` is the writer; it refuses an id no
  adapter reports now, so a typed id cannot excuse nothing. `--forget` takes
  a mark away. A misspelt key in the block is an error, never enforcement
  silently off.
- **Which command fails** (the slice's call): `lint`, plain, so the pre-push
  hook and CI agree. `unread.strict` is what makes an open item a failure, as
  `claims.strict` does; off or absent, `lint` warns (0040 point 7, 0035). A
  fresh install writes `strict: true`. An upgrade never does: its plan names
  the step, and `bootstrap.mjs unread --raise` writes it once every item has
  an answer, and refuses before (the upgrade skill's step 4c, for point 8).
  Under strict, an unreadable unread record fails too. A mark no item answers
  warns and never fails: it excuses nothing, and fixing an adapter must not
  turn CI red. Lint reads the records as written, like every other lint over
  metadata: `derive --check` runs before it in CI and the pre-push hook, and
  it is what a deleted or edited record fails.
- **Visible by default.** `derive`, with or without `--check` or `--verbose`,
  prints an `UNREAD` line per item, unanswered first, then those marked fine
  with their reason, at most 500 lines and then a count, so a repo with
  thousands cannot lose the end of a piped log. The engine's `unread` (derived in
  memory, writes nothing) lists them all. The cytoscape viewer gains a header
  button with the open count, only when there is an item, and a filterable
  Unread peek; `minimal` lists them above the rest. A mark moves the human
  index, so `render --check` holds the two together.
- **The part split.** `PARTS` has `schema` and `queries` where it had
  `database access`. `supabase` is schema; `sqlalchemy`, `supabase-js` and
  `supabase-py` are queries. Nothing an adopter holds names a part, so
  nothing migrates.
- **First reporter.** `supabase` reports the whole of each statement its replay
  skips, which were diagnostics. What it skips is unchanged, including
  statements it could ignore safely (slice 2 owns the reader): on the adopters
  measured that is 13 and 1 `DROP INDEX` statements, and nothing else.

## As built (ZDD-11 slice 2)

- **The reader.** `supabase` now follows `ALTER FUNCTION`, `PROCEDURE` and
  `ROUTINE … RENAME TO` and `SET SCHEMA`, `ALTER TABLE … SET SCHEMA`, `IF
  EXISTS ONLY`, a `DROP` with no `COLUMN` word, and a column rename into the
  foreign keys that name it. A procedure is a record like a function. A
  routine record gains `renamedFrom`, as a table has. A rename stays in its
  schema, except that a `public` table still loses `public.` (below).
- **What a name is.** Quoted, with spaces, `"public"."User"`, `$` and letters
  past ASCII all read. A quoted name holding a dot does not: a name is held as
  one string with its schema before the first dot, so the statement reports.
  A record's file name encodes what the store refuses as `~<hex>`, and a plain
  name stays as it is.
- **The tripwire** (the slice's call on where it stops). It reports what could
  change the model and was not applied: `ALTER`, `RENAME` or `DROP` on a table
  the history never made, an `ALTER TABLE` action outside the list, a change to
  a column that is not there, a rename onto something that is, `DROP SCHEMA`,
  `DROP TYPE … CASCADE`. It stays quiet on what the model does not hold, which
  goes past the `DROP INDEX` this slice was asked for: `DROP POLICY`, `DROP
  VIEW` and their like, because a normal repo writes `DROP POLICY IF EXISTS`
  and the trial read turns on the same list. A guarded `DROP` of a table never
  made is a no-op the replay gets right.
- **Tables an app does not own** are a named list of the schemas Postgres and
  the platform own, in the adapter. A schema the list misses raises an item,
  answered once, which is the safer way to be wrong.
- **A `DO` block is judged, never applied.** Strings are blanked first. What
  the model does not hold is quiet; `CREATE TABLE` and `CREATE TRIGGER` are
  answered when a plain statement makes the same thing by the end of the
  replay; anything else, and any `EXECUTE`, reports the whole block.
- **The trial read.** `detect` replays each folder as `derive` would, and
  returns `{ declined: [reasons] }` in place of a proposal. The core passes it
  on as `declined` and bootstrap reads it out; the part stays uncovered. It
  declines on a change to a table or function the files never make, any other
  statement it cannot read, files that undo themselves, files that create
  tables and end with none, a table two folders make, two names that would be
  one record file, and migrations that yield no table, function or bucket
  at all. It names no tool.
- **All or nothing** (the slice's call). One folder's bad read declines the
  whole claim, and one unread statement declines it. `schema` is a claim on the
  repo, so a half-read repo must not read as covered. The cost: one odd
  statement in a good history turns a usable starter down. The reasons say
  exactly which statement, so the developer can see it.
- **Undo steps, by behaviour.** The trial never looks for a tool's markers. A
  file that makes something and takes it away again, or changes a name or a
  type back, holds undo steps replayed as forward ones. A forward migration
  that makes a scratch table or helper function and drops it declines too;
  the reason says so, and that is the known false decline.
- **Read or declined, by format.** `.down.sql`, `down.sql` and `U<n>__` files
  are never replayed, so golang-migrate is read. `V<version>__` sorts by
  version, so Flyway is read, in a `migrations` folder; in `db/migration` it is
  not looked at. Plain Postgres, a SQLite rename and plain MySQL are read.
  Prisma is declined: a lone file under a versioned folder name is one
  migration, and the replay reads the files of one folder. Goose and dbmate,
  MySQL backticks and its own statements, and SQL Server are declined.
- **A clean starter, and a baseline to prove the move against** (Rich's call,
  after the slice first left these for later). The first commits of the slice
  moved no adopter's records. The fixes after them do, and the starter ships
  with them, because a new adopter must never receive a known bug:
  - a foreign key added by `ALTER`, at table level, with no column list, or
    in a guarded `DO` block is read; `DROP CONSTRAINT` takes one away, by the
    name given or the name Postgres gave it, through renames;
  - a renamed table keeps the schema it was written with, `public` too, and
    `sqlalchemy` refs a table by its bare name, so `public.x` in code reaches
    the table in either spelling. Together these were not cosmetic: code that
    qualified a renamed table lost its data-access records with no warning;
  - `f` and `public.f` are one function, in every statement that names it;
  - `UPDATE` and `DELETE` on `storage.buckets` apply, or report when they
    are wider than one bucket; an `INSERT` of several makes them all;
  - `UNIQUE(a, b)` with no space is no column; a type changed `USING`
    something is the type; a `CREATE TABLE` over a table that is there
    reports.
  This narrows point 8, it does not break it. Commit `419293d` is the baseline:
  the reader as it reproduces adopters' records. The core did not move
  with these fixes (the alias they first needed went into `sqlalchemy`, so the
  baseline on 0.14 reproduces the records), and that must stay so.
- **The upgrade's route to the fixes** (slice 4 and 5 build it). The library's
  first version is the baseline; its next carries the fixes and the note
  point 7 describes. New adopters get the latest. "Upgrade ZDD" copies the
  baseline, proves the records byte-identical, then in the same upgrade
  offers the note and, on a yes, moves the copy to the fixed version, runs the
  adapter's tests, and derives. It reads the changed records against the note,
  and repoints every map link and blessing at an id that moved, by the table's
  `renamedFrom`, before `lint`. Two proofs, in order, so what the move did and
  what the fixes did are never mixed. On a no, the note stands as point 7 says.

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
- **A full copy of the shared code in every adapter.** Deleting one adapter
  touches nothing else, but one repo with both front end and back end came to
  about 11,000 lines against 6,000, and one defect to fix in up to five places.
- **Applying a starter's fixes automatically.** The adapter would change with
  no one choosing it, which ends ownership.
- **Reporting unread items as a warning, or in a log.** A warning is what went
  unread for weeks.
- **Rebuilding each adopter's adapters at the move.** The best fit, but no proof
  nothing changed, and record ids would shift under the map and blessings.
