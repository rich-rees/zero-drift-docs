# 0048 — The app owns its adapters; ZDD ships starters, not readers

**Date:** 2026-11-02 · **Status:** accepted; **extended by [0049](0049-every-update-checks-the-map-still-reaches-what-it-should.md)** (2026-11-03: every update checks what no adapter looks at) · **Origin:** the design session on 2026-11-02 (Rich's calls, eight questions), after an adopter's rename migration showed that `supabase` follows no function rename. **Supersedes, in part:** [0036](0036-the-core-knows-no-stack-adapters-live-beside-it.md), points 2 to 5: the catalogue leaves the package and an adapter is copied by default, not by exception. [0039](0039-detection-lives-in-each-adapter-bootstrap-builds-the-gaps-and-checks-together.md), points 1 and 2: detection stays in the adapter, proves its fit, and a part is split in two. [0040](0040-adapters-declare-a-contract-number-and-pass-one-standard-suite.md), points 3 and 6: no adapter is updated by a release, so every adapter is the adopter's own. **Keeps** the contract, the standard suite and 0040 point 2 (open until 1.0).

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
  schema.
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
- **A `DO` block is judged, and only its foreign keys are applied,** where
  what decides them is known: the block runs them outright, or a guard asks
  whether that constraint or that table exists. Strings are blanked first. What
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
    name given or the name Postgres gave it, through renames. A column in a
    second key carries it in an optional `alsoReferences`, beside `references`;
  - a renamed table keeps the schema it was written with, `public` too, and
    `sqlalchemy` refs a table by its bare name, so `public.x` in code reaches
    the table in either spelling. Together these were not cosmetic: code that
    qualified a renamed table lost its data-access records with no warning;
  - `f` and `public.f` are one function, in every statement that names it;
  - `UPDATE` and `DELETE` on `storage.buckets` apply, or report when they
    are wider than one bucket; an `INSERT` of several makes them all, and
    its `ON CONFLICT` is read;
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
  and repoints every map link and blessing at an id that moved, before `lint`:
  by a table's `renamedFrom`, and to the surviving record where `f` and
  `public.f` became one. Two proofs, in order, so what the move did and
  what the fixes did are never mixed. On a no, the note stands as point 7 says.

## As built (ZDD-11 slice 3)

- **Self-contained, in place.** Every bundled adapter now imports nothing
  of the core, while it still sits in `src/adapters/`. The records and the
  goldens did not move: on the two adopters measured, every record is the
  same bytes as before the slice.
- **The shared folder** (the slice's call; slices 4 and 5 copy it as it
  is). It is `_shared/`, beside the adapters. In an app that is
  `<localExtractorDir>/_shared/`, next to `<localExtractorDir>/<name>/`. It
  holds `js/`, `python/` and `background/`, where `background/shared.mjs`
  is now `tasks.mjs`, plus four small helpers at its top: `paths.mjs`,
  `slug.mjs`, `data-access.mjs` and `template-paths.mjs`. The name starts
  with `_`, and derive selects only a name that starts with a letter, so the
  folder can never be an adapter, shadow one, or take a name an adopter
  might want.
- **What the core gave up.** `data-access.mjs`, `slug.mjs` and
  `template-paths.mjs` moved out of `core/lib/`, since no core file used
  them. `repoRelative` is the one rule kept twice: the core's checks config
  paths, and `_shared/paths.mjs` checks an adapter's own option paths. A
  test holds the two to the same answers. `fastapi` no longer makes its own
  `io` when none is handed in: derive always hands one in, and that is the
  contract.
- **The contract, said where the core reads it.** The core joins a
  `data-access` record on `resource[0]` and `facts.function`, and drops one
  marked `requireRefs` that nothing reaches. The contract table and
  CONTRIBUTING now say so. `dataAccessRecord` is only one way to build that
  shape, so it is shared code. The same goes for a background task's
  transient keys (`runs`, `processKeys`, `deploys`, `unresolved`): the
  core's merge reads them, and the adapters' comments now name that merge
  rather than a core file.
- **The copy set comes from the imports.** `moduleReach(entry, within)` in
  `core/lib/suite.mjs` returns every file that one module's static relative
  imports reach inside a folder, sorted, and it names any import that leaves
  the folder or finds no file. It resolves an import as Node does, as a URL,
  so a query, a fragment or an escaped name reaches the file Node loads. It
  never reads through a link, and it is bounded like the suite's own copies
  (1 MiB per file, 64 MiB and 20,000 files in all). Copying an adapter brings its folder (not its
  `example/`) and each `_shared/` file that any of its modules reach. That
  is what the starter library and the upgrade will copy. The standard suite
  now copies a local adapter's reached files into its scratch repos too.
  Before this, a local adapter that imported a helper beside it failed the
  suite's derive.
- **The tests that pin it.** In the border test: no file under
  `src/adapters/` imports `src/core/`, a package, or anything dynamically.
  Every adapter's files reach only their own folder and `_shared/`, and
  `_shared/` reaches only itself. Each catalogue adapter, copied alone with
  its reach into an empty folder, loads and derives. Each guard was shown red
  with a mutant. Check 5 of the standard suite still passes for every
  adapter.
- **Adapter tests reach ZDD through one file**, `test/adapter-kit.mjs`. It
  exports `ioFor`, `scanFor` and `trialRead`: the `io` and the detection
  `scan` the contract hands an adapter, and the adapter's own answer to
  detect. The scan is built by the same `detectScan` that detection uses,
  over every adapter the repo has, so a test sees the folders another
  adapter skips skipped too. A test that travels with its adapter imports node built-ins, its
  adapter, `_shared/` and the kit, and nothing else, and the border test
  holds that for `sql-replay`, `supabase-formats`, `supabase`, `fastapi`
  and `wrapper-resolution`. What the core does with the answers (coverage,
  and what a decline leaves uncovered) moved to `schema-coverage.test.mjs`,
  because that test is the core's. An app needs its own kit with the same
  three exports, and slice 4 decides where it comes from.
- **The baseline, self-contained** (for slices 4 and 5). It is at
  `packages/zdd-engine/test/starters-baseline/`, laid out as an app holds
  it: `supabase/` and `sqlalchemy/` as they were at `419293d`, with only
  their imports rewired; `_shared/`, holding exactly the files those two
  reach; and `tests/`, all three of `supabase`'s own tests at `419293d`,
  now going through the kit (`sqlalchemy`'s live in `data-access.test.mjs`,
  which reads the core's resolution, and stay in the engine). The kit is the
  one file that leaves the folder: it is the seam an app provides, and
  slice 4 supplies it. Every file's bytes are pinned by a hash, so a change
  is a deliberate step, as a golden's is. The catalogue never runs the
  baseline. A test builds an engine with it in place of today's two
  adapters and derives every engine fixture, each run succeeding, to the
  same bytes; the baseline's own tests pass on it. Outside
  the repo, on both adopters, it reproduces `419293d`'s engine record for
  record.

## As built (ZDD-11 slice 4)

- **The library.** `packages/zdd-starter-adapters`, npm
  `@rich-rees/zdd-starter-adapters` (Rich's name: it says what it holds), on
  a version line of its own from 0.1.0. It holds `adapters/<name>/` for every
  starter and `adapters/_shared/`, laid out as an app's `localExtractorDir`
  is, plus `notes.json` and a README. The engine package holds no adapter,
  and its published files hold none (a test).
- **Two versions from one tree** (the slice's call). The tree is 0.2.0,
  today's starters with the fixes. 0.1.0, the baseline, is the tree with
  `baseline/adapters/` laid over it: the `419293d` `supabase` and
  `sqlalchemy` whole, and the `_shared/` files they reach. Every other
  starter is the same in both. `scripts/stage.mjs <version> <dir>` writes a
  version's published files into a folder; it stages the baseline and the
  tree's own version and refuses any other, because a later version is
  staged from the tree at its own commit. 0.1.0 is frozen:
  `baseline/manifest-0.1.0.json` pins the hash of every file it stages, so a
  later change to any starter makes staging 0.1.0 fail instead of changing
  it (CR-291). Re-pinning is a narrated step, and only before 0.1.0 is
  published. The overlay is kept, unpublished, so slice 5's upgrade tests
  can stage both versions and prove the move against the first.
- **The fix note** (the slice's call; slice 5 reads it). `notes.json` lists
  every version, oldest first: `{ "notes": 1, "versions": [{ version,
  summary, starters: { <name>: { fixes: [{ what, who, moves }] } } }] }`.
  `what` says what changed, `who` which repos it affects, in words a session
  can test against a repo, and `moves` how record ids move, so the upgrade
  knows what to repoint. 0.1.0 has an empty `starters`. A staged version
  carries only the notes up to it. The stager checks the notes whole before
  it stages anything (CR-297): `notes: 1`, versions oldest first and each
  once, the baseline first, the package's version last, every starter named
  a starter of the library, every fix three non-empty strings.
- **Release.** A tag `starter-adapters-vX.Y.Z` on `main` runs
  `release-starter-adapters.yml`, in two jobs so no adapter code runs where
  a publish can (CR-290). `prove` has a read-only token: it stages a
  throwaway copy and runs both suites and that copy's own tests. `publish`
  stages the version again, fresh, publishes it by trusted publishing, waits
  until it can be fetched, and makes a GitHub release that is never marked
  Latest. A rerun resumes only when npm's tarball integrity equals the fresh
  stage's (CR-296). Nothing is published yet: the package's first publish
  and its trusted publisher are Rich's release-time steps.
- **The core runs only the repo's own adapters.** `catalogue.json`,
  `lib/catalogue.mjs`, the aliases, the retired names and the bundles are
  gone. A name `localExtractorDir` does not hold stops derive with one plain
  message naming the starter library and "upgrade ZDD". It is generic,
  because the core cannot tell a former catalogue name from a typo without
  naming stacks. The pre-1.0 `adapter` key is refused with the same route.
  0036 point 5 goes: a copy keeps its name, so config names and record ids
  stay as they are. Without aliases an options key names exactly one
  adapter; one under a name no listed adapter has is said on every derive
  and never fails (CR-424).
- **A folder of adapters** (`lib/adapter-folder.mjs`) is the core's one way
  to read many adapters: `<name>/index.mjs`, a selectable name, never
  through a link. `detect --adapters=<dir>` and `preview --adapters=<dir>`
  read the folder they are given (bootstrap passes the library's), so
  detection reads the library without the core knowing a stack. With no
  `--adapters`, detect asks the repo's own `localExtractorDir`. The preview
  copies each chosen adapter, with what it reaches, into its throwaway
  repo's `zdd/extractors`.
- **The adapter folder is never source** (found by this slice's tests).
  Every adapter, with its tests and its suite fixture, now lives in the
  app, so an adapter that walks the whole repo read the fixtures as the
  app's code. The io takes `notSource`, and derive and detect pass the
  repo's `localExtractorDir`: a walk never enters it, and a read refuses it
  as absent, with its own reason. The kit's io and scan apply the same rule
  (CR-292), and so does detection for a folder of adapters it is given
  inside the repo (CR-293). Paths compare case-folded where the filesystem
  folds, and config refuses `.` as `localExtractorDir`, because then nothing
  would be source (CR-294). An adapter that is a link is refused by derive
  and the suite, and a folder of adapters is checked for imports that leave
  it, or pass through a link, before any of its code runs (CR-295).
- **The suite.** A companion is another adapter in the same folder, copied
  into the scratch repos with the adapter. Nothing is skipped as ZDD's own.
  `SUITE` gains an optional `allowEmpty: true`, for an adapter that emits
  nothing by design (`generic`). **Every starter now carries its own
  `fixture/` and `SUITE`** (the baseline's two as well; derive never reads
  either), so a copy passes the app's `zdd-engine suite`, which a fresh
  install holds to every check. The library's suite runs each starter
  exactly as an app's suite does.
- **The kit, Rich's call A.** The engine package's public entry,
  `@rich-rees/zdd`, is the kit and nothing else: `ioFor(root, name)`,
  `scanFor(root, adapters)` and `trialRead(mod, root, adapters)`. Both
  scan calls are async and take the folder of the app's adapters; the scan
  skips what every adapter in it names. A travelling test finds that
  folder as `new URL("../../", import.meta.url)`, which is right in the
  library and in an app. `zdd-engine test [--adapters=<dir>]` runs
  `<name>/test/*.test.mjs`, and a scaffolded adapter's `<name>/*.test.mjs`
  (CR-305), with `@rich-rees/zdd` resolved to the running engine by a
  module hook, so an app with no `node_modules` runs them. The hook needs
  Node 20.6, so both packages now say `>=20.6` (CR-299). `--config` names
  the config whose `localExtractorDir` it reads (CR-298), and a config that
  cannot be read is said, never taken for no folder (CR-303, CR-314). The kit
  freezes with the contract at 1.0.
- **Tests.** The engine keeps the tests of the core alone, a small
  stack-free fixture for its store lints, and two test-only adapters in
  `test/adapters/` (`notes`, `lists`, with a `_shared/`). They name no
  stack, and the border test checks that. Every golden, every stack
  fixture and every test that needs a real starter moved to the library's
  `test/`, unchanged except for paths. That suite may reach the engine's
  source, since it tests the core with the starters. Each starter's
  travelling tests are in `adapters/<name>/test/`; they import only node
  built-ins, their own files, `_shared/` and the kit, and a test holds that.
  A fixture is copied with every starter in its `zdd/extractors`, which is
  how an app holds them after the upgrade. No golden was regenerated.
- **Proved on the two adopters**, read-only copies: the library's 0.1.0
  adapters, copied into `zdd/extractors`, give `419293d`'s records byte for
  byte (242 and 327), and 0.2.0 gives the slice 3 tip's (255 and 327).

## As built (ZDD-11 slice 5)

- **Where the plugin finds the library.** The plugin pins one version, and
  the baseline, in `plugins/zdd/starter-adapters.json` (a test holds them
  to the library's `package.json`, `notes.json` and stager). A version is
  found, in order: `ZDD_STARTER_ADAPTERS_DIR`, now a folder of staged
  versions, `<dir>/<X.Y.Z>/` (a test, or a dry run against a build not yet
  published); the library beside the plugin in this repository, staged
  fresh by its own stager; else npm, installed with no scripts into a
  private temporary folder, with npm's integrity check and its cache. Each
  route is held to the package name and the exact version. The preflight
  checks the pinned version is on the registry.
- **The copy set comes from the engine** (the slice's call). The plugin
  carries no engine and cannot import one, so a new engine command,
  `copy-set --adapters=<dir>`, names each adapter's files by the slice 3
  rule (its folder without `example/`, and the `_shared/` files its code
  and tests reach) and its `SUITE`. It writes nothing; bootstrap writes the
  copy, never over a file the repo has. A library test holds the command
  to the rule.
- **A companion comes too** (the slice's call). Dropping a companion the
  app does not take was the plan; tried, it fails the suite, because a
  query reader's fixture gives nothing without a route reader beside it.
  So the companion is copied as an adapter in the folder that `extractors`
  does not list: derive never runs it, the suite reads the starter beside
  it exactly as the library does, and the record marks it `companionOf`.
  The cost is code the app does not run, until its fixture is rewritten in
  the app's own stack. One of the two adopters measured takes one.
- **The record** is `<localExtractorDir>/starters.json`: the version each
  copy came from, a `declined` version once the developer says no, and the
  SHA-256 of every file copied, line endings aside. A move to a fixed
  version touches only files still as they were copied, and refuses,
  writing nothing, when any changed. A file the app had before is never
  replaced and never recorded. The engine ignores the file.
- **Bootstrap's offer.** Detection reads the pinned library and names the
  starters that fit; the skill asks once, in plain words. `"starters":
  true` (the default) copies them, sets `localExtractorDir`, and a repair
  apply that adds an adapter copies it too. On a no, nothing is copied but
  `generic`, the adapter that reads nothing, so derive runs until the
  developer's own are built; the config cannot be empty, and `generic`
  names no stack.
- **The upgrade.** After the config rewrites (the legacy `adapter` key,
  the renamed and split extractors, the added data-access readers), every
  name the folder does not hold is copied: the baseline from a release
  before 0.14, else the pinned version. The plan computes the same copy and
  writes nothing. Then `bootstrap.mjs starters --prove` is the first proof
  (`derive --check` with the copies in place), `starters` lists the fixes
  from the notes, and `--move` or `--decline` answers the one question.
  `--move` derives first, so it compares against what the copies make; it
  moves the copies, runs their tests (a failure puts every file back), runs
  derive, repoints every map link and blessing at a moved id, and
  `claims.allowUnclaimed`, then lints. An id moved when it is gone and one
  record of its kind and namespace has the same name past its schema: the
  two moves the notes name. Anything else gone is named for a hand fix.
- **The suite logic.** A copy no one has changed passes the suite as the
  library proved, so the upgrade raises `suiteChecks` when every adapter is
  one; an adapter the repo wrote or changed keeps the interview.
- **Detection's greenfield list** is now `starters` in detect's output (it
  was `catalogue`, which also named the release check's marketplace copy).
- **Proved on the two adopters**, read-only `git archive` copies: the
  upgrade copied the baseline and `--prove` passed with 242 and 327
  records, byte for byte as committed; `--move` gave 255 and 327, equal to
  slice 4's 0.2.0 run, with four table ids moved and one map page
  repointed on the first, five records changed on the second, and lint,
  the adapters' tests and the suite green on both.

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
