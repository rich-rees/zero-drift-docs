---
name: update
description: The Zero-Drift Docs PR-finish ritual. Curate the changed artifacts (glossary, ADRs, code comments, semantic map), regenerate the codebase metadata and both indexes, and commit everything in the PR so docs and code merge atomically. Use before finishing any PR in a repo that uses ZDD.
---

# zdd:update — the PR-finish ritual

> **Scaffold (v0.1).** Steps 1 and 4 are final. Steps 2–3 call the ZDD engine,
> which is not yet extracted into this plugin — see the TODO. Until then, in a
> repo still carrying the scripts in-tree, run `node zdd/scripts/derive.mjs` and
> `node zdd/scripts/render.mjs` directly.

Run this as the definition of done for every PR, in the session that did the
work — it holds maximal context, and capturing at that moment is the whole trick.

## Steps

1. **Diff → curated artifacts.** Walk the diff and update, at the site:
   - **Glossary** — new or sharpened vocabulary.
   - **ADRs** — decisions crystallised (written when decided, not after merge);
     supersession points both ways.
   - **Code comments** — new non-obvious constraints, at the code site. A gotcha
     spanning multiple sites becomes an ADR instead.
   - **Semantic map** — feature / edge / blessing changes.
2. **Run the deriver.** Regenerates the codebase metadata from source.
   `TODO(engine): invoke the bundled engine, e.g. npx @rich-rees/zdd-engine derive`
3. **Run the renderer.** Rebuilds the agent index + human index.
   `TODO(engine): npx @rich-rees/zdd-engine render`
4. **Commit all of it in the PR.** Code and docs merge atomically; the doc delta
   is reviewed alongside the code delta.

## Notes

- The ritual is **diff-anchored, not memory-anchored** — a fresh session can run
  it from the PR diff, the touched code, and the artifacts checkpointed en route.
- **Never hand-edit the generated artifacts** (`zdd/metadata/`, both indexes) —
  regenerate. The CI check (if wired) will fail otherwise.
- Read back any working file (`TEMPSTATE.md`) and delete it before merge —
  durable residue moves to an artifact first.
