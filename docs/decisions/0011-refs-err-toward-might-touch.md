# 0011 — Route refs err toward "might touch": ties fan out, imports narrow to what they reach

**Date:** 2026-09-28 · **Status:** accepted · **Origin:** CAS-65, from two findings in Cascade's CAS-64 review of the `react-router` extractor. **Supersedes, in part:** [0001](0001-composed-extractors.md) (route ties broken by id) and [0009](0009-unclaimed-records-warn-never-fail.md) (a data module attributed whole to every screen importing it).

## Context

A screen's refs are what someone reads to judge what a change could touch.
Cascade showed both ways they could mislead. `` api.post(`/users/${userId}/${action}`) ``
reads as `/users/*/*`, fits `deactivate`, `reactivate` and
`resend-invitation` equally, and resolved to `deactivate` alone, because a
tie broke by id. Meanwhile the Activity screen, importing only
`useAuditTrail` from the admin data module, was credited with every route
that module calls. The first case hides real dependencies; the second
invents false ones, and Codex's reviewer read them as exactly that.

## Decision

1. **A route ref ranks, then keeps every route tied for best.** The ranking
   is, in order: more literal segments matched; fewer `*`s standing on a
   literal route segment (a value the scan could not see: a guess), where a
   `*` on a parameter is the natural fit; and a single-segment parameter
   over a catch-all. Every route tied at the top is kept, and a diagnostic
   names the fan-out. Character order no longer decides anything, so
   `/things/*` picks `{id}` and `[id]` alike over a literal `mine`.
2. **A screen is credited with what its imports reach.** Its own file is
   scanned whole. For a local module it imports by name, only these count:
   - the statements declaring the imported names;
   - the top-level declarations those bodies mention, followed to a fixed
     point;
   - the module's top-level code, which runs on import whatever is
     imported.

   The module is still attributed whole, with a diagnostic, when narrowing
   cannot be done honestly: a default or namespace import, a dynamic
   `import()`, a name the module does not declare, or one it re-exports from
   another module (still one hop: the barrel's target is not followed).
3. **The call scanner sees any receiver:** `client().get("/x")` is a call,
   just as `api.get("/x")` is.

## Why / rejected alternatives

- **Keep one route and emit a diagnostic.** This is today's behaviour, made
  visible only under `--verbose`, and it still hides two of three
  dependencies from everyone else. Rejected.
- **Drop an ambiguous ref entirely.** It adds no false edges, but loses the
  three real ones too, which is the worse miss for an impact question.
  Rejected.
- **Keep whole-module attribution and document it with a `dataModules`
  fact.** It's cheap, and it explains the edges, but it leaves them false.
  Rejected in favour of narrowing, with the whole-module fallback kept
  wherever narrowing would have to guess.
- **Follow the barrel's re-export to its target.** That would be two hops,
  a second trust boundary for a pattern Cascade does not use yet. It stays
  whole-with-a-diagnostic until an adopter needs it.

## Consequences

- A `?route:` can resolve to several ids. The deriver's contract (a record's
  refs are a sorted, deduped id list) is unchanged; only how many come back
  from one unresolved ref changes.
- A fan-out can add a route a screen never calls: a text scan cannot see
  that `` `/things/${id}/${verb}` `` only ever passes `"a"`. That is the
  side this decision chooses. The diagnostic makes it findable.
- The narrowing reads statements line by line at bracket depth 0. A line
  starts one at column 0, or when indented if its first word is a
  declaration keyword (which can't continue the line before). One case
  still mis-cuts: two declarations on one line count as one statement, so
  importing either brings both. That errs toward including too much, and a
  formatter removes it anyway.
- React Router surface records' refs are now sorted in `derive`'s output, as
  every other extractor's already were after the merge.
- Adopters of `react-router` see refs drop on screens that import part of a
  data module, on the pin bump that brings 1.3.0: a `derive --check` diff,
  regenerated like any engine bump.
