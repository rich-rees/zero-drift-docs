# 0043 — Viewers get the blessing store ready-read; every peek has a filter and a back history

**Date:** 2026-10-28 · **Status:** accepted; point 1's order (by trigger question, then id) and point 3's "flat, by trigger question" superseded in part by [0045](0045-blessings-carry-an-importance-high-or-nothing-kept-scarce.md) (2026-10-28: high blessings first, then by question, then id, still flat, marked with a chip; each entry gains `importance`); where `usedBy` comes from superseded in part by [0046](0046-an-extend-blessings-users-are-read-from-the-sources-imports-at-render.md) (2026-10-28: the files importing the exemplar, read from the source; a `shown` entry for a file no record holds has `node: null`) · **Origin:** ZDD-2 part 2, the design session on 2026-10-28 (Rich's calls, questions 1–9). Builds on 0031 (the blessing store and its one reader).

## Context

The human index opens the glossary and the ADRs in a side peek, with
drill-in. Blessings had no equivalent, though the store (0031) gives each
one its own file with its exemplar and kind in a header. A viewer is handed
`docs` = `{ glossary, adrs }`: the store text, which it renders. Blessings
need more than text to be useful to a reader — the exemplar as a link, the
app and slice they name, who uses an `extend` exemplar — and some of that
(the users) comes from the metadata, not from the file.

The peek also had no filter, and its back button always went to the ADR
list, even from an ADR reached through the glossary.

## Decision

1. **`docs` grows a third key, `blessings`**: the store as the blessing
   index reads it, one entry per blessing in the index's order (by trigger
   question, then id). Each entry is `{ id, file, question, opening, kind,
   where: { path, symbol }, appliesTo, firstBuiltIn, adrs, body }`, plus
   `usedBy: { count, shown }` (at most five shown, as in the index) on an
   `extend` blessing with a `where`. `appliesTo` and `firstBuiltIn` are
   `{ path, node, title }`; a `node` is a graph node id, and null where the
   map has no such page. A fact the store does not give is null, never
   guessed; `usedBy: null` means unknown to ZDD. An empty store is `[]`.
2. **The engine reads the store once** (`lib/blessings.mjs`, then
   `viewerBlessings` beside the blessing index). No viewer parses a
   blessing file, so the store keeps one reader (0031).
3. **The reference viewer lists blessings flat, by trigger question.** Kind
   and app are chips, not headings: kind is advice on how to use the
   exemplar, not a way to sort the store.
4. **One filter box serves every list in the peek** (glossary terms, ADRs,
   blessings), and **the peek keeps a back history** that names where back
   goes. A node opened from a blessing (its app, a user, its first slice)
   gets a back button to that blessing.

## Consequences

- With the reference (`cytoscape`) viewer, every adopter's
  `human-index.html` changes on the bump to 0.10.0 — `render --check` is red
  until they re-render; with `minimal` or a viewer that ignores the key,
  nothing may move. No graph, metadata or index byte moves.
- A third-party viewer can show blessings without knowing the store's file
  format, and is free to ignore the key.
- The entry's shape is part of the viewer contract: renaming or dropping a
  field later breaks viewers, so it changes by a new decision.
- Importance (some blessings matter more) is not in the store yet; it is
  its own task, and would arrive as a new field here.

## Rejected

- **Embed the raw blessing files and parse them in the page.** A smaller
  engine change, but a second, browser-side reader of the store that drifts
  from the first.
- **Group the list under Copy and Extend headings.** Overweights the kind.
- **A filter on the Blessings list only.** Three peeks that behave
  differently.
- **A fixed back per kind** (an ADR's back always to "All ADRs"). Loses the
  reader's place when a blessing cites an ADR.
