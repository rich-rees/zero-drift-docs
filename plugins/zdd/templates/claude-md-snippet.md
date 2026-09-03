<!-- zdd:begin — managed by Zero-Drift Docs; `zdd:bootstrap --upgrade` rewrites this block -->
## Documentation — Zero-Drift Docs (ZDD)

This repo uses ZDD: seven documentation artifacts kept at most one unit of work
behind the code — six in `zdd/`, plus code comments in the source. Two spoken
verbs carry it, and both work with any coding agent:

- **"load ZDD"** — before designing or building in an area. Read
  `zdd/glossary.md` whole, `zdd/adr-index.md` whole, and the ADRs your task
  cites; say what you loaded; then read the code fresh. Never trust the docs
  over the code. (Skill: `load`.)
- **"update ZDD"** — before finishing a unit of work. Curate the artifacts the
  change touched (glossary / ADRs / comments / map), regenerate the generated
  ones, and commit them with the code so docs and code merge together.
  (Skill: `update`.)

Never hand-edit the generated artifacts — `zdd/metadata/`, `zdd/graph.json`,
`zdd/agent-index.md`, `zdd/adr-index.md`, `zdd/human-index.html`. Regenerate
them with "update ZDD"; the drift check fails otherwise.

Optional: `grill` runs a design interview that writes glossary terms and ADRs
into `zdd/` as they crystallize (needs the `mattpocock-skills` plugin; without
it, work decisions out in plan mode and let "update ZDD" capture them).
<!-- zdd:end -->
