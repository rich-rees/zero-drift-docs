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
