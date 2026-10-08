# 0012 — Strict claims are an opt-in; a double claim fails only there

**Date:** 2026-09-28 · **Status:** accepted · **Origin:** CAS-65, from Cascade's CAS-64 review campaign. Cascade's rule is "every record belongs to exactly one feature slice, except the plumbing routes", and lint could enforce neither half. **Extended by [0017](0017-strict-claims-never-widen-on-an-extractor-opt-in.md)** (2026-10-08): the kinds strict covers are opt-in too, through `claims.strictKinds`. Nothing here is superseded. **Supersedes, in part:** [0009](0009-unclaimed-records-warn-never-fail.md) ("nothing … fails, blocks or gates on an unclaimed record" — true now only while `claims.strict` is off).

## Decision

`zdd/config.json` gains `"claims": { "strict": true, "allowUnclaimed": [ids] }`.
With `strict` on, `lint` **fails** on:

- a claimable record (route, table, function, surface) that no feature slice
  links, unless its id is in `allowUnclaimed`;
- an `allowUnclaimed` id that names no claimable record, because an
  exemption that outlived its record is drift in the config itself;
- a record claimed by two or more feature slices.

With `strict` off, which is the default, both unclaimed and double-claimed
records are **warnings**, listed on stderr, and lint exits 0.
`allowUnclaimed` is read only under strict. `bootstrap --upgrade` names the
setting while a config has no `claims` block, and never writes it.

## Why / rejected alternatives

- **A double claim fails in every mode** (the review's ask). It forces
  "exactly one owner" on every adopter. 0009's own reasoning says a table
  three features read is honestly claimed by all three in many designs, and
  this pin bump would turn such a repo red for a map that is correct.
  Rejected. The rule is Cascade's to choose, so it is Cascade's to switch on.
- **A separate switch for double claims** (`singleOwner`). It's more
  flexible, but a second setting for a combination no adopter has asked
  for. Rejected; strict means both.
- **Report a stale allow-list entry as a warning.** A strict mode whose
  exemptions can rot unnoticed is not strict. Rejected.

## Consequences

- 0009's adoption story holds for every repo that does not opt in: a fresh
  bootstrap starts with everything unclaimed, and nothing goes red.
- A repo that turns strict on goes red until its map is complete. That is
  the point, and the allow-list is where plumbing is named deliberately.
- The viewers' unclaimed count is unchanged; double claims are a lint
  concern, not a graph fact.
