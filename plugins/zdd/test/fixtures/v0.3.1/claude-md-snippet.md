## Documentation — Zero-Drift Docs (ZDD)

This repo uses ZDD: seven documentation artifacts kept at most one PR behind the
code — six in `zdd/`, plus code comments in the source. The SessionStart hook
injects the agent index automatically each session.

- **Before building or designing in an area:** run `/zdd:orient` — load the
  glossary, the ADR index, and the ADRs your task cites, then read the code
  fresh. Never trust the docs over the code.
- **To drive out and record a design (optional):** run `/zdd:grill` — a design
  interview that writes glossary terms and ADRs into `zdd/` as they crystallize.
  Needs the `mattpocock-skills` plugin; without it, work decisions out in plan
  mode and let `/zdd:update` capture them.
- **Before finishing any PR:** run `/zdd:update` — curate the changed artifacts
  (glossary / ADRs / comments / map), regenerate the metadata and both indexes,
  and commit them in the PR. Docs and code merge together.
- **Never hand-edit generated artifacts** (`zdd/metadata/`, `zdd/agent-index.md`,
  `zdd/human-index.html`) — regenerate via `/zdd:update`. CI will fail otherwise.
