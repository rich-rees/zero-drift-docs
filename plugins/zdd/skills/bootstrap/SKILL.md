---
name: bootstrap
description: Adopt Zero-Drift Docs in a repo. Scaffold an empty zdd/ folder and config, run the deriver to produce the first codebase metadata, run a mapping session to seed the semantic map, render the indexes, and print the CI + branch-protection setup steps. Idempotent — detects an existing setup and offers repair rather than clobbering. Run once, when adopting.
---

# zdd:bootstrap — day one in a repo

> **Scaffold (v0.1).** The shape below is final. The deriver/renderer steps call
> the ZDD engine, which is not yet extracted into this plugin — see the TODOs.

Run once when a repo adopts ZDD. **Idempotent:** if `zdd/` already exists, detect
what's present and offer to repair the missing pieces — never overwrite curated
content.

## What it creates (all EMPTY templates — no content is shipped)

Nothing is copied from any other repo. The adopter's artifacts start empty and
fill up through normal work (the ritual). Scaffold:

1. **`zdd/glossary.md`** — a header and no terms. (Offer to seed it via a
   glossary/grilling session — the one genuinely content-producing step.)
2. **`zdd/adr/0001-adopt-zero-drift-docs.md`** — copied from
   `templates/adr-0001-adopt-zero-drift-docs.md` (fill in `<DATE>`). This is the
   corpus's first entry *and* a worked example of the ADR format — self-
   demonstrating: the first thing documented with ZDD is the decision to use ZDD.
   It's the adopter's *own* decision, not ZDD's design history (the plugin ships no
   ADRs of its own). Default on; opt out if you'd rather start from real work.
3. **`zdd/map/`** — empty feature/service directories.
4. **`zdd/config.json`** — from `templates/config.schema.json`; pick the adapter
   (e.g. `nextjs-supabase`) and set the source paths for this repo.

## Then

5. **Run the deriver** — produces `zdd/metadata/` from source.
   `TODO(engine): npx @rich-rees/zdd-engine derive`
6. **Mapping session** (the only LLM-heavy step, paid once) — scan the code with
   the glossary + ADRs loaded, propose feature groupings, and **ask** wherever
   evidence is thin. Answers route by kind: verdicts → ADRs, vocabulary →
   glossary, pure connective fact → the map.
7. **Render** — `zdd/agent-index.md` + `zdd/human-index.html`.
   `TODO(engine): npx @rich-rees/zdd-engine render`
8. **Print the setup steps the adopter must do themselves** (no tool can):
   - Paste `templates/claude-md-snippet.md` into their CLAUDE.md.
   - (With CI) copy `templates/zdd.yml` into `.github/workflows/` and set branch
     protection to require the ZDD check + branches up to date before merge.
   - (Without CI) optionally enable the local drift hook. ZDD then runs as a
     habit, not a gate.

## Boundary reminder

The plugin scaffolds the *machine*, not a copy of anyone's docs. Every artifact
it writes is an empty template or the adopter's own first decision.
