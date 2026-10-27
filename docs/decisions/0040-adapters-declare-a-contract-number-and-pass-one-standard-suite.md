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

## Rejected

- **The adapter records the ZDD version it was written for.** No extra
  number, but every release looks like a possible change, and the adapter
  gets a meaningless edit on every upgrade.
- **The suite only at bootstrap and upgrade, never in CI.** Nothing new in
  CI, but a hand edit that breaks a rule is found months later, after its
  output is committed.
