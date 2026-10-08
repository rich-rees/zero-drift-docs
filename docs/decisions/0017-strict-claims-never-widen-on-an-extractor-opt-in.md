# 0017 — Strict claims never widen on an extractor opt-in: new kinds are strict only when `claims.strictKinds` names them

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-97 (ZDD 2.1), from the grill on 2026-10-08. **Extends** [0012](0012-strict-claims-are-opt-in.md): strict stays opt-in, and now the set of kinds it covers is too.

## Context

`claims.strict: true` makes every route, table, function, bucket and
surface belong to exactly one feature slice or lint fails. 2.1 adds three
claimable kinds (`component`, `job`, `service`), each from an extractor an
adopter switches on by name. Cascade runs strict. The day it switches on
the component extractor, forty shared components appear; if strict applied
to them at once, a green lint would turn red because a feature was enabled,
not because a rule was tightened.

## Decision

1. **`claims.strict: true` keeps meaning the five original kinds.**
2. **`claims.strictKinds`** (array of kind names, default empty) extends
   strict to the kinds it lists. A kind under strict behaves exactly as the
   original five: unclaimed fails, double-claimed fails, `allowUnclaimed`
   applies. An unlisted new kind is a warning under strict, never a failure.
3. **A name in `strictKinds` that is not a claimable kind is refused**, as a
   misspelt `strict` is today: enforcement must never be silently off.
4. The original five are not listable: `strict` governs them, and listing
   one is the same refusal.

## Why / rejected alternatives

- **Strict applies to every claimable kind.** One rule, and it couples two
  decisions (enable an extractor, tighten the rules) that belong to
  different moments. Rejected.
- **New kinds never strict.** Throws away strict on jobs and services, the
  records a feature should most clearly own. Rejected.

## Consequences

- Cascade can enable everything, list `job` and `service` from day one,
  and bring `component` under strict once its slices have caught up.
- The config schema and `lint` gain one key; bootstrap writes nothing for
  it unasked.
