# 0034 — Splitting an ADR set is an opt-in step that proposes, and moves on a yes

**Date:** 2026-10-22 · **Status:** accepted · **Origin:** ZDD-1 (ZDD 2.5), decision 11 of the design session on 2026-10-22 (Rich's call). Follows [0033](0033-a-harness-adr-set-beside-the-application-set-on-one-number-line.md).

## Context

An adopter that turns on the harness set has a mixed `zdd/adr/` to split.
Numbers do not change (0033), so `ADR-0019` survives any move; what breaks
is a link by path into the old folder. Sadie's Sandwiches tags each ADR
with `Scope: harness` or `Scope: product`; PressPlay's 125 ADRs carry no
tag, and two of them open a paragraph with bold prose that starts
"**Scope: …**", which is an argument, not a tag.

## Decision

1. **Upgrading to 2.5 splits nothing.** Turning on the harness set is a
   bootstrap opt-in, run whenever the team is ready.
2. **The step proposes a set for every ADR.** A tag line, a line that is
   exactly `Scope: harness` or `Scope: product` (bold or not), decides.
   Anything else, including prose that happens to start with "Scope:", is
   proposed by the AI from the ADR's content, and the developer confirms or
   changes each proposal.
3. **On the confirmed list, the script moves the files** (numbers
   unchanged), writes the two config keys, and rewrites the path links
   *inside `zdd/`* that pointed at a moved file: ADR to ADR, the semantic
   map, blessings. Links outside `zdd/` are listed for a hand edit, because
   ZDD writes nothing outside its folder save the one line that loads its
   instructions.

## Consequences

- Like [0032](0032-the-upgrade-moves-blessings-out-of-the-map-after-showing-the-list.md),
  the script gains a write into curated stores, bounded to the confirmed
  list and held by tests.
- The judgment — which set a borderline ADR belongs in — stays with the
  team. The script never decides an untagged ADR.

## Rejected

- **A split by hand, lint reporting the broken links.** The first adopters
  pay the most, and a 60-ADR split by hand is an afternoon of link fixing.
- **Splitting as part of the upgrade.** A team that does not want a
  harness set would be asked about every ADR on every upgrade.
- **Taking any line that starts "Scope:" as a tag.** PressPlay's ADR-0049
  would be filed by a sentence about blocking a bank address.
