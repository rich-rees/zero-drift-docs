# The unclaimed-records lint warns, never fails

**Date:** 2026-09-25 · **Status:** accepted · **Origin:** CAS-63 — Cascade's human index showed empty UI-surface and Feature rows although the web app had sign-in, a shell, administration, Activity and the outbound queues; every "update ZDD" since CAS-50 had put its web knowledge into the app node's blessings, and the features folder held a `.gitkeep`.

`zdd-engine lint` lists every route, table, function and surface that no
feature slice links — "unclaimed" — as a **warning on stderr with exit 0**,
and the same count sits in the human index header. Nothing in the engine or
the plugin fails, blocks or gates on an unclaimed record. The `update` skill
names the list as the checklist a unit of work reads against its diff.

Features are the curated half: nothing mechanical asked for one before this,
so the map never said which half of the inventory it had placed. The lint
makes the gap visible; it does not close it.

## Why / rejected alternatives

- **Fail the lint on unclaimed records (blocking tier).** A repo adopting ZDD
  starts with *everything* unclaimed — a fresh bootstrap would go red on its
  first CI run and stay red until the mapping session finished, which
  inverts the adoption story (decision 0003: opt-ins are yes/no, never a
  wall). And a claim is a judgment (which feature owns a table three
  features read?), and judgment is exactly what the blocking tier does not
  gate (decision 0008). Rejected.
- **A threshold or ratchet (fail only when the count rises).** Determinism
  would need the previous count as an input, which is state the engine does
  not keep (same source bytes in, same artifacts out, no history but the
  stores'). A ratchet also fails the PR that adds the extractor that
  inventories more — punishing the honest change. Rejected.
- **Count it in the graph artifact (`graph.json`) instead of the viewers.**
  The number is derivable from the graph's Feature→metadata edges, and a
  derived number in the artifact would be a second source of truth for
  viewers to disagree with. Each viewer computes it from the edges it
  already reads; a test pins the viewers, the lint and the graph to the
  same number. Rejected.
- **Claim by tag or by `resource:` path prefix instead of by link.** A link
  is already what render turns into an edge and what the freshness nudge
  watches; a second claiming mechanism would let the two disagree. A
  feature claims a record by linking it, and only a `type: Feature` concept
  claims — an Application or External Service linking a record places
  nothing. Rejected.

## Consequences

- Adopters see one new warning block and a `(claimed/total)` suffix on the
  lint's success line; no CI changes colour on the pin bump.
- Modules and buckets are not listed: they are plumbing a feature reaches
  through its routes and tables, and listing them would bury the checklist.
- The `react-router` extractor (same release) attributes a data module's API
  calls whole to every screen that imports it, one hop deep — mechanically
  true and honest about what a grep can know; the feature slice, not the
  extractor, says which screen really owns which call.
