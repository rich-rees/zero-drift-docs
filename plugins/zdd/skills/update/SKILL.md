---
name: update
description: "update ZDD" — the Zero-Drift Docs finish ritual. Curate the changed artifacts (glossary, ADRs, code comments, semantic map), regenerate the codebase metadata and both indexes, and commit everything in the PR so docs and code merge atomically. Use before finishing any unit of work (a PR is one instantiation) in a repo that uses ZDD; triggers on "update ZDD".
---

# zdd:update — the finish ritual

Run this as the definition of done for every unit of work — the spoken form is
**"update ZDD"**; a PR is the usual unit — in the session that did the work — it holds maximal context, and capturing at that moment is the whole trick.

## Steps

1. **Diff → curated artifacts.** Walk the diff and update, at the site — follow
   the discipline in [authoring.md](../authoring.md) (glossary/ADR formats, the
   ADR-worthiness three-test, supersession both ways):
   - **Glossary** — new or sharpened vocabulary.
   - **ADRs** — decisions crystallised (written when decided, not after merge);
     offer them only when hard-to-reverse *and* surprising *and* a real trade-off.
   - **Code comments** — new non-obvious constraints, at the code site. A gotcha
     spanning multiple sites becomes an ADR instead.
   - **Semantic map** — feature / edge / blessing changes.
2. **Run the deriver.** Regenerates the codebase metadata from source:
   ```
   npx -y @rich-rees/zdd-engine@0.4.0 derive
   ```
3. **Run the renderer.** Rebuilds the graph artifact (`zdd/graph.json`), the
   agent index, the ADR index, and the human index:
   ```
   npx -y @rich-rees/zdd-engine@0.4.0 render
   ```
4. **Commit all of it in the PR.** Code and docs merge atomically; the doc delta
   is reviewed alongside the code delta.

## Notes

- The ritual is **diff-anchored, not memory-anchored** — a fresh session can run
  it from the PR diff, the touched code, and the artifacts checkpointed en route.
- **Never hand-edit the generated artifacts** (`zdd/metadata/`, `zdd/graph.json`,
  both indexes, the human index) — regenerate. The fence hook (if opted in)
  refuses the edit; the CI check (if wired) fails otherwise.
- Read back any working file (`TEMPSTATE.md`) and delete it before merge —
  durable residue moves to an artifact first.
- The curated half is judgment CI can't gate — [authoring.md](../authoring.md) is
  the discipline that stands in for a gate. Prefer to have driven the decisions out
  with `grill` (if the mattpocock-skills plugin is installed) or plan mode;
  by PR-finish this step is capture, not fresh design.
