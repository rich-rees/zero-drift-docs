# 0040 — Adapters declare a contract number of their own and pass one standard suite; upgrades interview the adopter about their own adapters

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, questions 7 and 8 of the design session on 2026-10-27 (Rich's calls), and the follow-up "could a core update tell the outer layer what to do?". **Extends** [0035](0035-a-lint-failure-the-same-releases-upgrade-clears-or-names-is-a-minor.md): a new suite check is held to the same rule as a new lint failure.

## Context

Once adapters are built per adopter (0036, 0039), a core release that adds
something (a new kind, a new fact, a required verb) has to reach code ZDD
did not write, and a lesson learned in one repo (a gitignored worktree read
as source; a commented-out route read as a route) has to reach every
adapter that could repeat it.

## Decision

1. **Each adapter declares `export const CONTRACT = n`.** It is a number of
   its own, separate from ZDD's version, raised only when the adapter
   contract changes. A table in the core lists each step and whether it is
   optional or required. A test holds the number and the table together.
2. **Before 1.0 the contract is open.** `CONTRACT` stays at 1 through
   0.9.x and may change without upgrade interviews, while the only adopters
   are the maintainer's own. It is frozen at 1.0.0, and from then on every
   change goes through the table.
3. **Upgrade reads the table.** For a catalogue adapter, the release has
   already updated it. For an adopter's own adapter on an older contract,
   the `upgrade` skill interviews them about that step only ("ZDD can now
   show message queues; does your stack have any?"), updates the adapter
   through the `extractor` skill (tests red to green), and checks the map
   together (0039). The interview text travels in the core release, never
   in the adapter: adapters stay plain code.
4. **Optional steps never block;** an adapter on an older contract keeps
   working without the new ability (as typed edges went in, 0016). A
   required step is a major, and the upgrade stops until the adapter is
   updated.
5. **One standard suite, shipped by the core, that every adapter passes:**
   the same source bytes give byte-identical records; a gitignored path is
   never read; a missing root is "nothing to inventory", never an error;
   masked comments and strings never become records; every read goes
   through `io`.
6. **The suite runs** at bootstrap, after any change to an adapter, at
   upgrade, and in the adopter's CI as a blocking step for their own
   adapters. Catalogue adapters run it in ZDD's own CI.
7. **A check new in a release starts as a warning.** The upgrade interview
   fixes the adapter, and the check blocks once it passes. No upgrade turns
   CI red by surprise (0035).

## Consequences

- A release that does not touch the contract says nothing about adapters.
- Adopters gain one ZDD step in the CI workflow ZDD already maintains, and
  a few seconds of CI.
- A copied adapter (0036 point 5) still drifts from the catalogue between
  releases. The suite and the interview narrow that, but don't close it.

## As built (ZDD-3 slice 5)

- **The number and the table** live in `src/core/lib/contract.mjs`:
  `CONTRACT = 1` and one row per step (`step`, `since`, `required`, `what`,
  and `ask`, the interview question, or none). Contract 1 is what an
  adapter does today, made explicit: `CONTRACT`, `derive`, `io`, missing
  source and the two the suite needs (`COMMENT`, `SUITE`) are required; refs,
  data access, typed edges, warnings and detection are optional. A test
  holds `CONTRACT` to the table's newest `since`. `zdd-engine contract`
  prints it; CONTRIBUTING and the engine README show it.
- **Derive judges every adapter it loads** by the table: written for a newer
  contract than the engine speaks, or behind on a required step, stops
  derive; no `CONTRACT` line warns on every derive (an existing local
  adapter keeps working, 0035); an optional step it lacks is said under
  `--verbose` only. Every catalogue adapter declares `CONTRACT = 1`.
- **The suite** is `src/core/lib/suite.mjs` and `zdd-engine suite`. It runs
  on the adapter's own fixture (Rich's call, question 1), copied into
  temporary folders outside any repo, each run a real `derive` by the same
  engine in a child process. Five numbered checks, in 0040's order: the
  same bytes under another timezone, locale and environment and on a second
  run; every fixture file copied under a gitignored folder beside it changes
  nothing; an empty repo gives no records and no error; check 4 below;
  the adapter's own files (and the relative imports they reach) import no
  `fs`, `child_process` or network module, no core module that reaches the
  filesystem save io's own, and call no `require`, dynamic `import`,
  `fetch` or `process.env`. A fixture that gives the adapter nothing of its
  own fails the run (the checks would prove nothing). An adapter may name
  catalogue **companions** that run beside it (`SUITE.companions`): a
  data-access adapter needs a schema adapter's tables and a route adapter's
  routes to say anything.
- **Check 4, commented-out code** (Rich's call, question 2): an adapter
  exports `COMMENT`, the line-comment mark per extension or file name; the
  suite comments out every line of every such fixture file and expects
  exactly what the same files with every line blank give — not the files
  removed, because in a file-tree convention a file's name is the
  declaration — with `description` left out of the comparison (a leading
  comment is where a description is read from, by design). A
  `fixture-trap/` folder, laid out like the fixture, adds what must never be
  a record (declarations inside strings) and must change nothing.
- **After the slice 5 campaign (CR-118 to CR-148).** COMMENT must classify
  every file the adapter actually reads — derive keeps a read trace for the
  suite (`ZDD_IO_TRACE`) — with `null` for a kind that takes no line comment;
  an unclassified one fails check 4, so the check can no longer pass on
  nothing. Check 5 reads imports from comment-free text and calls from text
  with strings blanked but `${…}` kept, bans `node:module`, `vm`, `os`,
  `process` and packages too, and is said to be what it is: a check for the
  honest mistake, not a sandbox (a local adapter is trusted like the repo's
  tests, decision 0010). Check 1's second machine also has another HOME,
  temp folder, user and CI flag; check 2 puts an ignored copy beside each
  file as well as under a folder; check 3 leaves out a companion's records;
  CRLF stays whole. An unknown or retired adapter fails the suite, and
  `--raise` refuses while one is configured. Only `fixture/`, `fixture-deep/`
  and `fixture-trap/` are test data. On the io side: `io.kind` says
  `unreadable` (never `missing`) when a path cannot be examined, and
  `linked` for a folder under a link; a route, page or migration io cannot
  read now stops derive, as `readFileSync` did, rather than writing an empty
  or partial record; nextjs reads each file once and its middleware matcher
  from live code only; supabase never lists an ignored folder. The managed
  pre-push hook runs the suite, the CI step goes after the whole lint step
  when a workflow has no freshness step, and the schema's `suiteChecks` stops
  at 5.
- **What blocks** (Rich's call, question 3): `suiteChecks` in
  `zdd/config.json`, one number for the repo. A failing check numbered at or
  below it fails `suite`; a newer one warns; absent, every check warns. A
  new check goes at the end of the list. Bootstrap writes the count at a
  fresh install; "upgrade ZDD" raises it at once where the repo has no
  adapter of its own, and leaves it where it has some; `bootstrap.mjs
  adapters --raise` raises it once every one of them passes. Tests bind each
  writer to the engine reading it back.
- **The interview** is `bootstrap.mjs adapters`: the engine's `suite --json`
  (which carries the table) turned into, per own adapter, the questions for
  the steps it is behind on — the text from the release's table — and each
  failing check with its fix. The upgrade skill's new step 4b asks them one
  at a time and updates the adapter through the extractor skill, red to
  green. At contract 1 there is nothing to ask; the suite is the step.
- **CI**: the workflow template gains one step, `npx -y "$ZDD_ENGINE" suite`,
  after the lint step; the upgrade adds it to an owned workflow in the
  template's words. With no adapter of the repo's own it says so and passes.
  The template's pin is still 2.5.0, which has no `suite`, until slice 6
  moves every pin to the 0.9 engine.
- **The scaffold** writes `CONTRACT`, `COMMENT` (from the mask the answers
  chose) and `SUITE` into a new local adapter, and its test file gains a
  last test that runs the suite and needs every check to pass.
- **What the suite found in the catalogue, fixed in this slice.** `supabase`,
  `nextjs` and `react-router` read the filesystem themselves; they now read
  through `io`, which gained `io.kind(rel)` (what sits at a path, without a
  read) for `react-router`'s bundler-style probing. So a symlinked folder or
  file — inside the repo too — is never followed by any adapter (Rich's
  call, replacing CR-016's in-repo follow; neither adopter has a tracked
  link), and a source file over 1 MiB is a diagnostic, not a read (neither
  adopter has one). `nextjs` read `fetch()` calls, auth markers and handler
  names inside comments, and failed on a middleware file that was all
  comment; `external-services` counted a commented-out import or env read as
  a use. All now read comment-free text. `leadingComment` moved to the
  shared JS helpers, so the background readers no longer import `nextjs`.

## Rejected

- **The adapter records the ZDD version it was written for.** No extra
  number, but every release looks like a possible change, and the adapter
  gets a meaningless edit on every upgrade.
- **The suite only at bootstrap and upgrade, never in CI.** Nothing new in
  CI, but a hand edit that breaks a rule is found months later, after its
  output is committed.
