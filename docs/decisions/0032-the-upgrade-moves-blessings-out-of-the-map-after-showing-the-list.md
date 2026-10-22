# 0032 — The upgrade moves blessings out of the map, after showing the list

**Date:** 2026-10-22 · **Status:** accepted · **Origin:** ZDD-1 (ZDD 2.5), decision 7 of the design session on 2026-10-22 (Rich's call). Follows [0031](0031-blessings-live-in-a-store-of-their-own-one-file-each-with-a-where-and-a-kind.md).

## Context

0031 moves blessings into `zdd/blessings/`. Cascade has about 60 on its map
pages, and PressPlay and Sadie's Sandwiches have their own. Until now the
upgrade script wrote only the files bootstrap owns (config, skeleton,
opt-ins, ZDD's instructions and the line that loads them, decisions 0003
and 0024). It never edited a curated store.

## Decision

1. **"upgrade ZDD" moves them, in two steps.** `bootstrap.mjs upgrade`
   lists every blessing still in the map with what it would write: the file
   name (from the trigger question), `where:` (the first link or code span
   in the text that names a repo file), `applies-to:` (the app or package
   when the blessing sat on an `Application` / `Package` page),
   `first-built-in:` (the page it sat on), and a proposed `kind:`. The
   skill shows the list; on the developer's yes, the script runs again with
   the confirmed list and writes.
2. **The write creates each file exclusively and removes the blessing from
   its map page;** a `# Blessings` heading left with no items goes too.
   Every other byte of the page is kept.
3. **Nothing is guessed.** A blessing with no trigger question, or with no
   repo file to take `where:` from, is left where it is and named, for the
   team to fix by hand. `kind:` is the one field that is judgment; the
   proposal is shown, and the developer confirms or changes each one.
4. **Lint then fails on any blessing still in the map** (0031 point 2).

## Consequences

- The upgrade script gains a new power: editing curated map pages. It is
  bounded to the `# Blessings` sections it lists, it never runs without the
  confirmed list, and tests hold both.
- A repo upgrading with blessings it cannot move stays red until those are
  fixed by hand; the upgrade names every one
  ([0035](0035-a-lint-failure-the-same-releases-upgrade-clears-or-names-is-a-minor.md)).
- The move is a working-tree change like any other upgrade write: the team
  reviews it in the upgrade PR.

## Rejected

- **Moving by hand while the engine reads both places through 2.x.** Two
  parsers for the life of a major, an afternoon of copying per adopter, and
  two answers to "where do blessings live?".
- **Moving without showing the list.** A file name and a `kind` are read
  by people for years; the team sees them before they exist.
- **Inventing a missing trigger question or exemplar.** The same reason as
  0015: a question is judgment, and a guessed one makes a blessing findable
  by the wrong question.
