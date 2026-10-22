# 0035 — A new lint failure that the same release's upgrade clears, or names item by item, is a minor

**Date:** 2026-10-22 · **Status:** accepted · **Origin:** ZDD-1 (ZDD 2.5), decision 13 of the design session on 2026-10-22 (Rich's call). **Supersedes, in part:** [0015](0015-choose-patterns-blessings-are-read-before-building.md), the consequence "so is a new hard lint failure" (a major).

## Context

The repo's semver rule names a config-schema or metadata-contract break as
a major, and 0002 adds a new mandatory generated file. 0015 added a third
by precedent: a new hard lint failure, because an adopter goes red on the
first lint after upgrading. ZDD 2.5 adds four such failures (a blessing left
in the map, a blessing with no `where:` or one naming no file, one with no
`kind:` or a wrong one, an `applies-to:` naming no app or package page) and
none of the others.

Since [0021](0021-bootstrap-locks-the-release-by-default.md) an adopter
takes a new engine only through "upgrade ZDD", the same step that runs the
release's migration, and every pin is an exact version. Nobody goes red by
surprise; the bump and the fix land in one PR.

## Decision

1. **A new lint failure is a minor** when the same release's upgrade
   clears it mechanically, or names every item it could not clear so the
   team can fix them in the upgrade PR.
2. **It is a major** when the upgrade can neither clear it nor name each
   item: when a team would find out only by running lint.
3. The two other rules stand: a config-schema or metadata-contract break,
   and a new mandatory generated file, are majors.

## Consequences

- ZDD-1 ships as 2.5.0.
- The upgrade, not the version number, carries the warning: its
  `UPGRADE_NOTES` entry and the skill's "Upgrading to 2.5" section name the
  new failures and what clears them.

## Rejected

- **3.0.0 by the 0015 precedent.** Defensible: "your blessings live
  somewhere else now" is what a major announces. Declined because the
  number is a signal to people, never a gate on a machine, and the upgrade
  says it louder.
- **Warnings in 2.5, failures in 3.0.** Two parsers for blessings through
  2.x, the cost 0032 refuses.
