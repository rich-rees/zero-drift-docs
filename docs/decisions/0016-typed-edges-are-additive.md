# 0016 — Edges gain a verb, additively: `facts.edges` beside a flat `refs`, an optional `verb` on graph edges

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-97 (ZDD 2.1), from the grill on 2026-10-08. A record's `refs` has always been a flat, sorted list of ids and the graph has one kind of edge. The 2.1 extractors want edges that mean different things: a page *uses* a component, a component *calls* a route, a surface *subscribes* to a table, a job *writes* a table, a module *depends on* a service, a surface *belongs to* an app.

## Context

`refs` is read by the resolver, by claims, by the renderer's references
section and by the viewer's backlinks. Changing its shape would be a
metadata-contract break, and the repo's rule makes that a major version.
2.1 is additive and opt-in: an adopter who switches nothing on must get
byte-identical artifacts.

## Decision

1. **`refs` stays a flat id list.** Every existing consumer is unchanged.
2. **A record may carry `facts.edges`:** a map from verb to the ids it
   covers, `{ "subscribes": ["table:db/audit_events"] }`. Every id in
   `facts.edges` also appears in `refs` (the resolver resolves both; an
   unresolved `?` ref under a verb resolves the same way and the verb
   follows the resolved ids). An id in `refs` under no verb is a plain
   reference, as today.
3. **The graph artifact's edges gain an optional `verb`.** A graph with no
   verbs is still `zdd-graph/1`; viewers treat a missing verb as plain.
4. **The vocabulary is documented by the engine:** `uses`, `usedBy`, `calls`,
   `subscribes`, `reads`, `writes`, `dependsOn`, `belongsTo`. `usedBy` exists
   because extractors cannot see each other's records: a component names the
   surface that imports it, since it cannot add `uses` to the surface. An unknown
   verb is kept in the record and the graph and drawn as plain, so a local
   extractor may coin one without the engine refusing it.
5. **The renderer and the agent index say the verb** ("subscribes to
   audit_events") where one exists, and "references" where none does.

## Why / rejected alternatives

- **`refs` as `{ id, verb }` objects.** The right shape, and a contract
  break. Deferred to a major release; this decision should be read as the
  bridge to it, not the end state.
- **No verbs, prose per kind.** Loses the one thing a front-end reader asks
  the graph: which of these lines is a subscription and which a call.

## Consequences

- Existing metadata is byte-identical until an extractor the adopter has
  switched on emits a verb.
- The lanes viewer may draw a verb distinctly (a dashed `subscribes`, a
  directed `writes`); that is a viewer choice, not graph shape.
