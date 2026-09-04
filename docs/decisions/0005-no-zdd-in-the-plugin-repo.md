# 0005 — The plugin repo does not use ZDD

**Date:** 2026-09-03 · **Status:** accepted · **Origin:** DIO-307 grilling (PressPlay ADR-0113 records the same decision from the harness side), recorded under DIO-311.

## Context

The obvious move for a documentation tool is to document itself with itself: a `zdd/` folder here, a glossary, an agent index, the update ritual on every PR. It would demonstrate the tool and dogfood it. It would also add, to a repo of a few dozen files, a seven-artifact discipline designed for codebases an agent cannot hold in context.

## Decision

**No `zdd/` here.** The repo is small enough to read whole — the plugin's `CLAUDE.md` says so as its first instruction — and knowing when *not* to use the tool is part of knowing the tool. Decisions that pass the three-way test (hard to reverse, surprising without context, a real trade-off) live in **`docs/decisions/`** as plain ADR-format markdown, numbered `NNNN-kebab-title.md`, in exactly the format the plugin teaches in `skills/authoring.md`. Supersession points both ways. There is no glossary (the README's one-screen table is the vocabulary), no agent index, no `update` ritual, and no `spec.md` — `CONTRIBUTING.md` carries the extractor and viewer contracts, which is what a contributor actually needs.

## Consequences

- This is one of the two video lines: "the plugin repo itself does not use ZDD." A demo that contradicted it would cost more than it showed.
- Nothing in the plugin repo can be mistaken for shipped content: no project's glossary, ADRs or map leaks into the machine that makes them (the boundary `CONTRIBUTING.md` and the README both draw).
- If the repo ever grows past what one session reads whole — more extractors, more viewers, a second package — this decision is superseded by adopting ZDD here, with `docs/decisions/` becoming `zdd/adr/` unchanged in format. The format was chosen so that migration is a `git mv`.
- No mutation testing in the plugin repo for 1.0, either: the engine's determinism tests (byte-identical goldens) are the contract, and a mutation stage is DiO harness, not plugin.

## Rejected

- **Adopt ZDD here and dogfood** — a seven-artifact ritual on a repo you can `cat`; the ceremony would outweigh the code and teach the wrong lesson about when to reach for the tool.
- **A `spec.md` conceptual reference in the repo** — the README already says the idea in one screen, the contracts are in `CONTRIBUTING.md`, and a third prose document is the hand-maintained mechanism prose ZDD exists to retire.
- **ADRs in the PressPlay repo only** — the plugin has to be extensible by people who have never seen PressPlay; the *why* has to ship with the code it explains.
