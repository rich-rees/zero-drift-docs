# Adopt Zero-Drift Docs

Decided on adoption of ZDD in this repository (<DATE>). This is the first entry
in the decision record — and, fittingly, it is the decision to keep a decision
record at all.

We will document this codebase with **Zero-Drift Docs**: seven artifacts kept at
most one PR behind the code. Four are **curated** and can rot, so a per-PR ritual
and CI watch them — the glossary (our ubiquitous language), these ADRs (decisions
and the alternatives we rejected), comments at non-obvious sites in the code, and
a semantic map of how things connect. Three are **generated** from source and
never hand-edited — the codebase metadata, the agent index, and the human index.
The test for whether a fact belongs in the docs at all: *document only what grep
cannot find and code cannot say.*

Every PR updates the curated artifacts it touches and regenerates the rest, so the
docs merge atomically with the code and become true on merge. Where we use CI, a
blocking check makes drift in the *generated* artifacts un-mergeable; the curated
ones stay one PR behind on the ritual, because no script can judge whether a
decision was worth recording.

## Rejected alternatives

- **A separate wiki (Notion / Confluence / a `docs/` tree of prose).** The classic
  home for documentation, and the classic source of drift: it lives away from the
  code, nothing forces it to change when the code does, and hand-maintained
  mechanism prose is the fastest-rotting documentation of all.
- **A README and ad-hoc notes.** Fine for a small project, but there is no
  orientation contract for an agent session and no gate that keeps anything
  current — freshness depends entirely on whoever remembers.
- **No docs; rely on the code plus agents re-reading it each session.** The code is
  always true, so this never *lies* — but it cannot say what things are called, why
  a path was chosen, or what was rejected and why. Those are exactly the facts ZDD
  keeps, and the only ones worth keeping.

## Consequences

- Every PR runs the update ritual as part of its definition of done.
- The generated artifacts are never edited by hand — they are regenerated.
- If this repo uses CI, the ZDD check is required to merge; branches must be up to
  date first.

<!-- This file was seeded by `/zdd:bootstrap` as the corpus's first entry and a
     worked example of the ADR format. Edit it freely, or delete it once real
     decisions accumulate. Later ADRs supersede rather than overwrite: a superseding
     ADR cites the one it replaces, and the old one gains a forward-pointing stamp. -->
