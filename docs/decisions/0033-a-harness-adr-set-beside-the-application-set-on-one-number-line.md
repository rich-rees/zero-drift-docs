# 0033 — A harness ADR set beside the application set, on one number line

**Date:** 2026-10-22 · **Status:** accepted · **Origin:** ZDD-1 (ZDD 2.5), a filed finding, decisions 8–10 of the design session on 2026-10-22 (Rich's calls).

## Context

`zdd/adr/` held every decision in one set with one index. On real adopters
that set mixes product decisions with harness decisions (the review
campaign, the mutation nightly, fences, the ZDD plugin itself), so the
index a stakeholder reads is full of material that means nothing to them.
Both adopters already split their glossaries the same way: harness
words in `docs/agents/glossary.md`, the product's ubiquitous language in
`zdd/glossary.md`. Sadie's Sandwiches tags each ADR `Scope: harness` or
`Scope: product` while it waits for this.

## Decision

1. **Exactly two sets.** The application set is today's `zdd/adr/` and
   `zdd/adr-index.md`. A harness set is optional: `paths.harnessAdrDir` and
   `paths.harnessAdrIndex` (bootstrap's default `zdd/adr-harness/` and
   `zdd/adr-harness-index.md`). Without them there is one set and every
   output is byte-identical to 2.4.
2. **One number line across both.** `ADR-0017` is unique across the two
   folders, a new ADR takes the next free number in either, and the
   duplicate-number lint covers both. Nothing is renumbered and every
   citation keeps its `ADR-NNNN` form.
3. **Crossing sets is allowed.** A citation, a blessing's reason and a
   supersession resolve in either folder; the two-way supersession check is
   unchanged. An index marks an ADR from the other set,
   `_(superseded by ADR-0062, harness)_`, and links into its folder.
4. **Each set gets its own index,** generated and checked the same way. The
   application index can be handed to a stakeholder as it stands; each says
   once at the top that its numbers are shared with the other set.

## Consequences

- The config gains two optional keys. That is additive, not a config-schema
  break.
- An index has gaps where the other set's numbers fall.
- Everything that reads `adrDir` today (render, lint, the tally, the store
  changes, the Stop hook, the record, the fence) reads both folders when
  the harness set is configured.

## Rejected

- **A number line per set with a prefix (`HADR-0012`).** Splitting an
  existing set would renumber every harness ADR and break citations ZDD
  cannot rewrite: commit messages, closed PRs, the tracker.
- **A general list of named sets.** More than either finding or adopter
  asks for; "which set does this go in?" stops being a yes-or-no question,
  and `adrDir` would become a list entry, a config break.
- **Supersession only within a set.** Real decisions cross the line, and
  forcing a pair of ADRs to keep lint quiet breeds throwaway ones.
