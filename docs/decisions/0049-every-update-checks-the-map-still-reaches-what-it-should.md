# 0049 — Every update checks the map still reaches what it should, and a gap is answered once

**Date:** 2026-11-03 · **Status:** accepted · **Origin:** ZDD-11, the design session on 2026-11-03 (Rich's calls, five questions), from an adopter that added a second data-access library weeks after bootstrap while ZDD went on reading only the first. **Extends** [0048](0048-the-app-owns-its-adapters-zdd-ships-starters-not-readers.md): the unread report covers what an adapter saw and could not read; this covers what no adapter looks at. **Extends** [0039](0039-detection-lives-in-each-adapter-bootstrap-builds-the-gaps-and-checks-together.md) point 3: the coverage check runs at every update and in CI, not once at bootstrap.

## Context

Detection and the coverage report ran at bootstrap and at upgrade only. An
adopter bootstrapped with one data-access library and, weeks later, a
session added a second one for transactions. No adapter looked at the new
code, so it reported nothing unread, and routes that used it reached no
table for about five weeks before anyone saw it on the human index.
Libraries are unlimited, so no catalogue can name them all ahead of time:
ZDD has to notice when its map has gone dark, whatever caused it.

Measured read-only on two adopters, the coverage report finds about 130 and
250 records that reach nothing or that nothing reaches, most of them normal
(a table with no foreign key, a trigger function, a leaf component).

## Decision

1. **"Update ZDD" cannot finish until every finding is answered,** and no
   answer traps anyone. A finding is fixed (an adapter now reads it, built
   or extended through the `extractor` skill), marked **fine** with a reason
   (nothing to map: a health check touches no table), or marked a **known
   gap** with a reason (it cannot be mapped, for example table names built
   at runtime). A known gap stays visible in the human index and the agent
   index as a part of the map not to trust. The pressure is towards mapping.
2. **The whole repo, every run,** never a diff against a branch or a saved
   map. A gap is answered once, with the same one-time marks as unread items,
   so a gap a skipped update left behind surfaces on the next run.
3. **What counts.** By default the core flags routes, screens and background
   tasks that reach nothing, and tables nothing reaches: where a gap usually
   means a reader is missing (about 27 and 26 items on the two adopters). An
   adapter may name further kinds of its own records that must link, as an
   optional contract step. The core lists record kinds, never a stack.
4. **Every update asks the starter library,** when it is reachable: each
   starter's "do you fit this repo now?", and any that fit and are not
   installed are offered, as at bootstrap. Offline, or where the developer
   declined the library, one line says it was skipped. The session also
   judges the libraries its own work added, in the `update` skill, never in
   the engine: does any adapter read them?
5. **CI enforces the gaps,** through `lint`, as it does unread items: a fresh
   install is strict, an upgraded repo warns until every existing gap is
   answered and a command turns strict on (0035, 0040 point 7).

## Consequences

- A new library goes dark for one session at most: the update that brought
  it in, or the pull request it rides in.
- A repo carries one answer per normal gap, written once.
- Point 4 depends on the library being reachable, and is never required:
  points 1 to 3 hold without it.
- A route that keeps one link and quietly loses another is caught only by
  point 4 or by the session's own judgement, not by the gap list.

## As built (ZDD-11 slice 6)

- **The gap list** is `lib/gaps.mjs`, and the engine's `gaps` command
  reports it (derived in memory, writing nothing). What counts as a link is
  the coverage report's own rule, now one function both share: a ref or a
  typed edge to a record that exists and is not itself. The core's kinds
  are `route`, `surface` and `background-task` that reach nothing, and
  `table` that nothing reaches. On the two adopters measured, after the
  0048 upgrade, that is 27 (2 tasks, 17 routes, 8 screens) and 26 (1 task,
  8 routes, 17 screens), and no table: the decision's counts. Unread
  records are never gaps.
- **The contract step** is an optional row, `gaps`: an adapter may export
  `GAPS = { reachNothing: [kinds], reachedByNothing: [kinds] }`, at most 50
  kinds a direction, never `unread`. A kind is counted for every record of
  it, whichever adapter minted it: the core keeps no owner per record (a
  background task merges two readers' records). A malformed `GAPS` stops
  derive, naming the adapter. lint and render read the same export by
  importing the module and never running its derive: the repo's own code,
  which derive runs in full in the same CI step before lint (CR-358). A
  module that will not load, whatever it throws, is a one-line note with
  the core's kinds standing; under `gaps.strict` it also fails lint, since
  its kinds are unknown, and render warns (CR-358, CR-361). No starter
  declares one yet.
- **A bound** (CR-360): at most 10,000 gaps, what the answer lists can
  hold. Past it the list stops before it is sorted or printed: the kinds
  or the readers are wrong. Every narrator prints at most 500 open gaps;
  `--json` holds them all.
- **An id** is `gap:<kind>/<16 hex>`, a SHA-256 of the direction and the
  record's id. A mark survives the record's title, file and description
  changing, and lapses when the record is renamed. A kind in both
  directions is two gaps.
- **Where the answers live** (the slice's call). A block of its own beside
  `unread`, `"gaps": { "strict", "fine": [{ id, what, why }], "known": [...] }`,
  read by the same parser: `marksConfig` in `lib/unread.mjs` now reads both
  blocks, so a misspelt key, an id of the wrong shape, a mark with no `why`
  and an id in both lists are errors, never enforcement off; `derive`
  refuses such a block too, so CI stops before lint could read it, and the
  plugin's config schema describes it (CR-356). A block of its
  own, because an upgraded repo raises the two checks at different times:
  `unread.strict` may already be on when the gaps arrive. The writer is
  shared too: `bootstrap.mjs gaps --fine=<ids> | --known=<ids> --why=…`,
  `--forget`, `--raise` and `--check` run through the same function as
  `unread --mark`, which keeps its own words. A gap answered `fine` that is
  then answered `known` moves, one answer per id. Fixed is no mark: the gap
  is gone, and a mark it leaves warns as stale, never fails.
- **Known gaps in both indexes.** The agent index gains a `## Known gaps`
  section after "Apps & packages", one line per gap with its record linked
  and its reason; the cytoscape viewer a header button, "Known gaps: N",
  and a filterable peek whose rows open the record's node with the way
  back; `minimal` a list above the rest. Viewers get `docs.gaps`, ready-read.
  All of it only when a gap is answered `known`, and render reads the
  adapters' `GAPS` only then, so a repo with none gets the same agent
  index and the same viewer data; its human index moves only by the
  viewer's script, inlined in the page, as every viewer change does on a
  pin move (CR-355), which the upgrade's render step regenerates. A `fine`
  mark changes neither index. The section's text is escaped as markdown,
  so a record's title or a reason cannot forge a link, a code span or
  raw HTML in the index every session loads (CR-359). The one golden that moved is the
  full-page human index, by viz.js lines only (its README says so); no
  graph, metadata, agent-index or BUNDLE byte moved.
- **lint** reads the list from the records derive wrote, in the walk it
  already makes for claims and unread items, so `derive --check` before it
  keeps the list true. Under `gaps.strict` an open gap fails, and so does a
  metadata file lint cannot read (what links there is unknown); off, the
  gaps are one warning with the list. The route to an answer is said once,
  above the failures. A fresh install writes `"gaps": { "strict": true,
  "fine": [], "known": [] }`; an upgrade never does: its plan names the
  step, and `gaps --raise` writes it once every gap has an answer and
  refuses before (the upgrade skill's step 4d).
- **The update's gate** is `bootstrap.mjs gaps --check`, which exits 1
  while any gap is open, `strict` or not: point 1 binds the update, point 5
  only CI. The update skill's step 6 takes the gaps one at a time and does
  not go on until it exits 0.
- **The library at every update** is `bootstrap.mjs library`: the pinned
  version's starters asked by detection, and those that fit and are not
  among the config's `extractors` offered with their evidence and options.
  Taking one is a repair `apply` naming it, which copies it. A no is kept
  in the record beside the copies, the one file the plugin keeps about
  them: `declinedOffers` for named starters, `library: "declined"` for all
  of it, which `apply` with `"starters": false` now writes too. A no by
  name is validated whole before anything is written (CR-357): every name a
  starter on offer now, so a typo cannot hide a later starter, and the
  record as the next read takes it. Unreachable,
  declined, or a detection that cannot run is one line, `skipped`, and never
  a failure. The update skill's step 7 runs it, then judges the
  dependencies the diff added against the adapters, in the session.
- **The session-start notice of 0048 point 7** is `check-starters.mjs`,
  printed by the SessionStart hook (whether or not the auto-load is on)
  and run by `load`'s step 0. It reads `starters --json` and says one line
  when the pinned library notes fixes for a copy not yet taken or declined.
  It runs no engine (which files of a copy changed is the move's question,
  so `changed` is empty), and every route to the library is bounded to 15
  seconds, npm read from its cache with `--offline` (CR-354), so a session
  start never waits on the network; it is silent offline, after a no, and
  when every copy is level. The hook imports it only when it runs, and runs
  it after the agent index, so nothing in it can cost the session its index
  (CR-367).
- **Proved** on read-only `git archive` copies of the two adopters, after
  the 0048 upgrade (copy, prove, move): the counts above; the notice named
  the baseline copies' fixes before the move (6 and 5) and was silent
  after; `gaps --check` exited 1; lint warned with the full count and
  exited 0; `--raise` refused; with every gap answered (one known) the
  check passed, `--raise` wrote strict, both indexes showed the known gap,
  `render --check` and strict lint passed, and taking one answer away failed
  lint. The library offered nothing new on either. A fresh install on a
  throwaway repo wrote strict, failed lint on its three gaps, and passed
  once they were answered.

## Rejected

- **Report and let the update finish.** A warning is what went unread for
  five weeks.
- **Only fixed or fine as answers.** Something truly unmappable would be
  marked fine to get past the check, hiding the gap the check exists for.
- **Only what the branch changed, or a saved map from the last update.** A
  skipped update's gaps never return, or another generated file to keep in
  step, and CI cannot judge it.
- **Every record in both directions.** Hundreds of normal items per repo,
  marked without being read.
- **The library only at upgrade, or never after bootstrap.** A session builds
  from nothing a reader the library already had, reviewed.
- **Only at the update, not in CI.** A session that skips the update merges a
  gap.
