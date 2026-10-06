<!-- Written once by Zero-Drift Docs (zdd) bootstrap, for Matt Pocock's skills. Yours to edit; bootstrap never rewrites it. -->
# Domain Docs

How the engineering skills (Matt Pocock's `mattpocock-skills`) should consume
this repo's domain documentation when exploring the codebase. This repo keeps
its domain docs with Zero-Drift Docs (ZDD), so they are **not** at the repo
root: there is no root `GLOSSARY.md`, `GLOSSARY-MAP.md` or `docs/adr/`, and
none should be created.

## Before exploring, read these

- **`<GLOSSARY>`**: the glossary, the project's ubiquitous language. Read it
  whole. It is this repo's `GLOSSARY.md`; single context, no `GLOSSARY-MAP.md`.
- **`<ADR_INDEX>`**: one generated line per ADR (number, title, first
  sentence, supersession stamps). Read it whole, then drill into the ADRs that
  touch the area you're about to work in.
- **`<ADR_DIR>/`**: the ADRs themselves, `NNNN-kebab-title.md`. This is this
  repo's `docs/adr/`.

If any of these files don't exist, proceed silently.

## Where new terms and decisions go

- A new or sharpened term goes in `<GLOSSARY>`, never in a root `GLOSSARY.md`
  or `CONTEXT.md`.
- A new decision goes in `<ADR_DIR>/`, continuing the existing numbering,
  never in `docs/adr/`. An ADR that supersedes another stamps the old one
  `Superseded [in part] by ADR-NNNN`; ZDD's lint checks both directions.
- Capture them as they crystallise, in the formats ZDD's `update` skill uses
  ("update ZDD" regenerates the index afterwards).

## File structure

```
/
├── <GLOSSARY>
├── <ADR_INDEX>          ← generated; never hand-edit
├── <ADR_DIR>/
│   ├── 0001-adopt-zero-drift-docs.md
│   └── 0002-….md
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in
`<GLOSSARY>`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (add it to `<GLOSSARY>` when it is resolved).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
