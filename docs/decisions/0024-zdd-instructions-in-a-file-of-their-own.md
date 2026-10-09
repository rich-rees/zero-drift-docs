# 0024 — ZDD's instructions live in a file of their own, loaded by one line

**Date:** 2026-10-09 · **Status:** accepted · **Origin:** CAS-103 (ZDD 2.3), Rich's proposal C10 from the Cascade upgrade run (CAS-102), decisions 3 and 4 of the 2.3 design session. **Supersedes, in part:** [0003](0003-kernel-and-opt-ins.md) (the marked instruction block in `CLAUDE.md`), [0006](0006-one-repo-two-manifests.md) ("the same block into both hosts"), and [0015](0015-choose-patterns-blessings-are-read-before-building.md) (where the verb is stated).

## Context

Since 0003 ZDD rewrote a marked block inside the adopter's own `CLAUDE.md`
(and `AGENTS.md`) on every upgrade. Two moves of real adopters (DIO-335,
CAS-102) showed the cost: the block's ownership was never obvious to a
plain reader; the upgrade's duplicate finder flagged fifteen of the
adopter's sections that merely mentioned ZDD and missed the two that
contradicted it; and every upgrade edited a file the adopter thinks of as
theirs.

Claude Code inlines `@path/to/file.md` at session start, so a file ZDD owns
can be always-loaded, never a link the AI may skip. Codex has no such
directive: its `AGENTS.md` loader concatenates plain Markdown (checked
against the Codex source and the agents.md spec on 2026-10-09; the combined
instruction text is capped at 32 KiB).

## Decision

1. **ZDD owns `<bundleDir>/instructions.md`** (`zdd/instructions.md` by
   default). Bootstrap writes it at install and "upgrade ZDD" rewrites it
   whole on every release; it carries ZDD's ownership header, the fence
   refuses a hand edit to it with its own reason, and a file of the adopter's
   found at that name is never overwritten.
2. **`CLAUDE.md` carries one line, `@zdd/instructions.md`.** Bootstrap adds
   it (with a one-line comment saying what it does); an upgrade replaces a
   pre-2.3 block with it once, and never edits `CLAUDE.md` again. Everything
   else in `CLAUDE.md` is the adopter's by definition.
3. **`AGENTS.md` keeps a managed block** between the markers, a copy of the
   same text, rewritten on upgrade — because Codex cannot import a file.
4. **The text is rendered with the adopter's configured paths**, so a repo
   that moved its glossary is told where its glossary is.
5. **The adopter's own text is still read against ZDD's rules** at every
   upgrade — per paragraph or bullet, with what ZDD now says beside it —
   because a person can still write a ZDD rule of their own; it is removed
   only on their word.

## Consequences

- One sentence explains ownership: "that file is ZDD's; this file is
  yours."
- Every adopter migrates once, in the 2.3 upgrade; the plan shows the
  before and after.
- No context is saved: the text is still loaded every session. The budget
  on its size stays, and a test holds it.
- A host with no import directive gets a block; if Codex gains one, the
  block goes the way `CLAUDE.md`'s did.

## Rejected

- **Keep the block, fix the wording.** Ownership stays implicit and every
  upgrade keeps editing the adopter's file.
- **A link to the file ("read `zdd/instructions.md` first").** A link the
  AI may skip is not an instruction; the import is the mechanism that makes
  it always-loaded.
- **Generate the file from `render`.** The engine would then carry
  instruction text (it carries none, by the repo's rule), and a text-only
  change would be a mandatory generated-file move for every adopter's CI
  (decision 0002).
