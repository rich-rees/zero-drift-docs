# 0031 — Blessings live in a store of their own, one file each, with a `where` and a `kind`

**Date:** 2026-10-22 · **Status:** accepted · **Origin:** ZDD-1 (ZDD 2.5), finding [#30](https://github.com/rich-rees/zero-drift-docs/issues/30), decisions 2–6b of the design session on 2026-10-22 (Rich's calls). **Supersedes, in part:** [0015](0015-choose-patterns-blessings-are-read-before-building.md) point 5 (the index grouped by slice, app-level slices first) and point 8 (a blessing is a list item in a map concept; a missing exemplar only warns).

## Context

A blessing is the shout across the table: "need X? here is the code, and
here is why". Until 2.5 a blessing was a bullet under `# Blessings` on a
semantic-map page, and the blessing index printed its question and its ADR.
So the index said *why* and never *where*: the route to the exemplar was
an instruction in the `patterns` skill ("open in full, in its slice"), and
the author missed it on a real adopter. Which slice held a blessing was an
accident of where it was first built: a file-upload pattern "belonged" to
job templates.

Blessings are as important as the glossary and the ADRs, and they were the
only curated artifact without a home of their own.

## Decision

1. **Blessings are a curated store of their own,** `zdd/blessings/`
   (`paths.blessingsDir`), one Markdown file per blessing. The file name is
   the blessing's stable name (`adding-an-upload.md`), which the pattern
   plan, the ZDD record and lint use in place of `<slice>: <question>`.
2. **The semantic map keeps its name** and now holds the groupings and the
   non-textual edges. A `# Blessings` section in a map page is a lint
   **failure** that names the upgrade's move ([0032](0032-the-upgrade-moves-blessings-out-of-the-map-after-showing-the-list.md)).
3. **A blessing file is a small header and the blessing's text.** The text
   is what it was: the trigger question first, the exemplar, the one trap
   it refuses, the reason. The header:
   - `where:` **required**: a repo path, optionally followed by a symbol in
     brackets, `apps/api/app/fixed_routes/decisions.py (RouteRefusal)`.
     Lint **fails** when it is missing or the file does not exist. Lint
     checks the file, never the symbol.
   - `kind:` **required**: `copy` (imitate this method; the exemplar is not
     touched) or `extend` (reuse this shared code, and extend it if you
     must). Lint fails on any other value.
   - `applies-to:` optional: an app or package id from the map. Such a
     blessing is a house rule for that app, read in full whenever the work
     touches it. Lint fails when it names no app or package.
   - `first-built-in:` optional: the map page the pattern was first built
     for, so the link to the originating feature is kept. Lint **warns**
     when it names no map page.
   - `adr:` optional: the ADR that blessed it (`ADR-0047`, or several,
     comma-separated). A citation in the text counts as well; the reason is
     still an ADR or a "because …", and the rules of 0015 point 8 for the
     question, the reason and the length budget are unchanged.
4. **Every index line carries two pointers,** where and why:
   `- A refusal that has to name things? — copy: apps/api/app/fixed_routes/decisions.py (RouteRefusal) · why: ADR-0047`.
   The index lists the `applies-to` blessings under their app first, then
   every other blessing in one list sorted by question.
5. **An `extend` blessing shows who uses the code, worked out on every
   render.** The metadata already records `uses` / `usedBy` edges
   ([0016](0016-typed-edges-are-additive.md)); the index line says
   `used by 3` for the records that use the record whose source file is the
   blessing's `where`. When no record has that file, the line says
   `users unknown to ZDD`, never zero. The `patterns` plan lists the users
   as the things to retest, and "update ZDD" checks the plan says they were
   retested, or why not.

## Consequences

- The blessing index's bytes change for every adopter with blessings, and
  two lint failures are new. 2.5 is still a minor:
  [0035](0035-a-lint-failure-the-same-releases-upgrade-clears-or-names-is-a-minor.md).
- A list of users is never written by hand: it would go stale, which is
  the drift ZDD exists to stop. The count is only as wide as the metadata.
  A repo with the components extractor off sees `users unknown to ZDD` on a
  component blessing, and the `patterns` step greps instead.
- Two branches that each add a blessing never conflict in git, and a
  blessing's history is its own file's history.
- Reading a slice page no longer shows its blessings. The blessing index is
  the one place to look; `first-built-in` points back, nothing points
  forward.

## Rejected

- **The pointer alone, blessings left on their slices.** Cheap, and it
  leaves the "which slice?" accident, which is half of the finding.
- **One `zdd/blessings.md` file.** No stable name per blessing, every new
  blessing conflicts with every other, and the header has to be squeezed
  into prose.
- **The exemplar found in the prose, as before.** The index would print a
  guess, and an exemplar moved or deleted would leave the blessing pointing
  nowhere with nothing red.
- **A hand-written list of users.** Stale the first time someone adds one.
- **Renaming the semantic map ("feature map").** Considered and declined:
  the name stays, its scope narrows.
