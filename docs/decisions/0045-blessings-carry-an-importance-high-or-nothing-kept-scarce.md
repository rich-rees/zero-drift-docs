# 0045 — Blessings carry an importance: `high` or nothing, kept scarce

**Date:** 2026-10-28 · **Status:** accepted · **Origin:** ZDD-7, the design session on 2026-10-28 (Rich's calls, questions 1–9). Widens the blessing store's header (0031) and the viewer's `docs.blessings` entry (0043). **Supersedes, in part:** [0043](0043-viewers-get-the-blessing-store-ready-read.md) point 1's order and point 3's "by trigger question", and [0031](0031-blessings-live-in-a-store-of-their-own-one-file-each-with-a-where-and-a-kind.md) point 4's index order (the rest of both stands).

## Context

Some blessings matter far more than others. A details page uses a side
peek, never a centred modal: the side peek is needed on almost every new
screen, and a team that builds its own modal has drifted in a way that is
expensive to undo. The store had no way to say so. The blessing index and
the human index's Blessings peek listed every blessing alike, by trigger
question, so the side peek sat between "Adding a cron job?" and "Adding a
table?".

Importance here is a mixture: a blessing is important when it is **often
needed and costly to reinvent**. Neither alone is enough — a rare pattern
that is costly to reinvent is found by its question when it comes up, and a
common one that is cheap to redo does no harm when someone redoes it.

## Decision

1. **Emphasis with one duty, not "always read".** A high blessing is listed
   first and marked. A session still opens it when its question matches
   the work (house rules stay the only blessings read whatever the work);
   a plan that departs from a high blessing says why its code cannot serve.
2. **One value: `importance: high`.** No line is normal. There is no
   `low`, no third level and no rank number: the test is a threshold, and a
   single value keeps it rare. A new value could be added later without
   breaking a reader.
3. **Lint fails any other value**, case-exact (`High` fails, as
   `kind: Copy` does), with the fix in the message.
4. **Scarcity is a warning.** Lint warns when more blessings are high than
   the larger of 1 and a fifth of the store (3 blessings allow 1, 10 allow
   2, 60 allow 12), naming them. A pin on half the store pins nothing; but
   adding an ordinary blessing should never turn CI red, so it never fails.
   There is no config dial: one rule that means the same in every repo.
5. **The blessing index** lists a high blessing first within its own
   section — its app's house rules, or "Every other blessing" — its line
   opening with a bold `**high**`, and its header says what the marker
   means. House-rule sections stay whole.
6. **The Blessings peek** pins high blessings first with a "high" chip, no
   headings (0043's chips-not-headings rule); a filter keeps them on top,
   and the filter finds them by "high". The blessing's own page shows the
   chip.
7. **The viewer contract**: each `docs.blessings` entry gains
   `importance`, `"high"` or null (normal; a value lint fails is null, as
   the store does not say high). The array is ordered **high first, then by
   trigger question, then id** — restating 0043 point 1's order — so a
   viewer that draws the list in order pins without sorting.
8. **A session proposes, the developer confirms.** "choose patterns" may
   propose `high` for a candidate blessing, with its reason against the
   test, and may suggest it for an existing blessing it sees being
   reinvented; "update ZDD" writes the line only on the developer's yes.
   "upgrade ZDD" never sets it: judgement is never guessed (0032 point 3).
9. **ZDD's instructions** gain one clause in the "choose patterns" line —
   a blessing marked high is one not to reinvent: follow it, or say in the
   plan why not. The full rules live in `authoring.md`, `patterns` and
   `update`, read when they apply.

## Consequences

- On the bump to 0.11.0 every adopter's `human-index.html` changes with the
  reference viewer (each entry gains `importance`), and ZDD's instructions
  file and Codex's `AGENTS.md` copy change on "upgrade ZDD".
  `blessing-index.md` moves only in a repo that marks a blessing high; no
  graph or metadata byte moves. Nothing to answer on the upgrade.
- A third-party viewer that ignores the field still lists high blessings
  first, because the order carries the pin.
- The importance of a blessing is reviewed like its kind: in the update
  commit, by a person.

## Rejected

- **Always read high blessings** (a repo-wide house rule). Costs about 95
  tokens per high blessing on every run, and blurs the line with house
  rules and ADRs; anything that must be read on every run is one of those.
- **Three levels (`high`/`normal`/`low`) or a rank number.** Levels drift to
  everything high; ranks are argued over and renumbered. Neither fixes
  "half the store is high" — scarcity does.
- **Fail when too many are high.** Adding an ordinary blessing could turn
  CI red for a ratio, not for anything wrong with it.
- **A separate "High importance" section at the top of the index.** Takes
  a high house rule out of the app section a session is told to read in
  full.
- **Headings in the peek, or a star icon.** Headings break under the filter
  and overweight one fact (0043); a star is a symbol to learn and reads
  worse to a screen reader than a word.
- **Each viewer sorts.** Every viewer would repeat, and could get wrong,
  an order the engine already owns.
- **The upgrade proposes high from usage counts.** "Most users" is not the
  test (it misses "costly to reinvent"), and a judgement field is never
  guessed.
