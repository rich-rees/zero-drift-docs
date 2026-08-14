# Zero-Drift Docs (ZDD)

A documentation architecture for repos built by **human + agent pairs**. ZDD keeps
seven documentation artifacts *at most one PR behind the code* — and makes drift in
the machine-generated ones **un-mergeable**.

> **Status: v0.1, scaffold.** The plugin skeleton installs and the SessionStart
> hook works. The deriver/renderer **engine** is not yet extracted into this repo
> (the skills mark those steps `TODO(engine)`). Not production-ready yet.

## The idea in one screen

Documentation has two consumers with different failure modes: the **agent** (orients
by grep-and-read, re-pays the cost every session) and the **human** (can't hold the
system shape in their head; hand-maintained mechanism prose rots fastest). ZDD gives
each what it needs, off **seven artifacts** — the design test for every fact:

> **Document only what grep cannot find and code cannot say.**

Four are **curated** (they can rot, so a per-PR ritual + CI watch them) and three are
**generated** (rot-proof by construction, never hand-edited):

| # | Artifact | Kind | Home |
|---|----------|------|------|
| 1 | Glossary — the ubiquitous language | Curated | `zdd/glossary.md` |
| 2 | ADRs — decisions + rejected alternatives | Curated | `zdd/adr/` |
| 3 | Code comments — constraints at the site | Curated | the source |
| 4 | Semantic map — groupings + non-textual edges | Curated | `zdd/map/` |
| 5 | Codebase metadata — mechanical inventory | Generated | `zdd/metadata/` |
| 6 | Agent index — feature-first orientation | Generated | `zdd/agent-index.md` |
| 7 | Human index — hosted graph view | Generated | `zdd/human-index.html` |

Two lifecycle moments carry it: **orient before you work** (`/zdd:orient`, plus an
auto-injected index) and **update before you finish** (`/zdd:update`).

## What the plugin is (and is not)

It ships the **machine that makes `zdd/` folders** — never anyone's docs. No glossary
terms, no ADRs, no map, no rationale for *why* ZDD is designed this way. An adopter
consumes it as a finished tool; the "why" is not needed to use it and is not shipped.
`/zdd:bootstrap` scaffolds a fresh, empty `zdd/` in your repo.

Contents: three skills (`bootstrap`, `orient`, `update`), a SessionStart hook, the
engine + stack adapters *(coming)*, and templates (CI workflow, CLAUDE.md snippet,
config schema).

## Install

```
/plugin marketplace add rich-rees/zero-drift-docs
/plugin install zdd@zero-drift-docs
```

(Works from a private repo — install uses your git credentials.) Then:

1. Paste `plugins/zdd/templates/claude-md-snippet.md` into your repo's CLAUDE.md.
2. Run `/zdd:bootstrap` — scaffolds `zdd/`, picks an adapter, runs the first derive.

### …with CI — the real guarantee

3. Copy `plugins/zdd/templates/zdd.yml` into your `.github/workflows/`.
4. In branch protection: require the **zdd** check to pass, and require branches to
   be up to date before merging.

Now stale generated artifacts **cannot merge**. Note the split this enforces: CI
makes *drift in the generated artifacts* un-mergeable — the curated artifacts stay
one-PR-behind on the ritual (no script can judge "should this have been an ADR?").

### …without CI — ritual only

CI is a strong recommendation, not a hard dependency. Skip steps 3–4 and ZDD still
runs: the agent orients and updates each PR. You lose *enforcement* — ZDD drops from
a provable guarantee to a good habit. A middle option is a local git pre-push hook
running the engine's `--check`, which makes a forgotten update **loud** without a
merge gate.

## Repo layout

```
.claude-plugin/marketplace.json     # this repo is a plugin marketplace
plugins/zdd/
  .claude-plugin/plugin.json
  hooks/hooks.json                  # SessionStart → inject the agent index
  scripts/inject-agent-index.mjs
  skills/{bootstrap,orient,update}/SKILL.md
  templates/{claude-md-snippet.md, zdd.yml, config.schema.json}
packages/zdd-engine/                # deriver / renderer / checks + adapters (coming)
```

## Roadmap

- [ ] Extract the engine (`derive` / `render` / checks + `nextjs-supabase` adapter)
      from the PressPlay proving instance into `packages/zdd-engine`.
- [ ] Decide engine distribution: npm package (single source for CI + skills) vs
      bundled scripts.
- [ ] Wire the skills' `TODO(engine)` steps to the real invocations.
- [ ] Conceptual reference doc (`spec.md`) for readers/contributors — repo-only,
      never installed into an adopter repo.

## Versioning

Semver, tracked in `plugins/zdd/plugin.json` and the marketplace entry (kept in
sync), and marked with a matching git tag (`vX.Y.Z`).

- **`0.x` — private, pre-release.** Building and proving against the PressPlay
  instance. The API (skill names, config shape, engine CLI) may change freely.
  This scaffold is **`0.1.0`**.
- **`1.0.0` — first public release.** Cut when the engine is extracted, the
  `TODO(engine)` steps are wired, and a clean repo can adopt ZDD end-to-end.
  From here, breaking changes bump the major.

## Licence

MIT.
