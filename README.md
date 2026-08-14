# Zero-Drift Docs (ZDD)

A documentation architecture for repos built by **human + agent pairs**. ZDD keeps
seven documentation artifacts *at most one PR behind the code* — and makes drift in
the machine-generated ones **un-mergeable**.

> **Status: v0.2, engine extracted and published.** The plugin installs, the
> SessionStart hook works, and `packages/zdd-engine` holds the real
> deriver/renderer/checks with a green test suite —
> [published to npm](https://www.npmjs.com/package/@rich-rees/zdd-engine) as
> `@rich-rees/zdd-engine`, so the skills' and CI template's `npx` invocations
> resolve for real. Remaining before 1.0: the graph/viewers refactor and
> `spec.md`.

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

It ships the **machine that makes `zdd/` folders** — never anyone's docs. It carries
no glossary terms, no map, and **none of ZDD's own ADRs**: the rationale for *why*
ZDD is designed this way is baked into the mechanism, not shipped as decisions. An
adopter consumes it as a finished tool.

`/zdd:bootstrap` scaffolds a fresh `zdd/` in your repo — empty curated artifacts,
plus one seeded **ADR-0001** recording *your* decision to adopt ZDD. That's the
corpus's first entry *and* a worked example of the format (self-demonstrating: the
first thing you document with ZDD is the choice to use ZDD). Opt out if you'd
rather start from real work.

Contents: three skills (`bootstrap`, `orient`, `update`), a SessionStart hook, the
engine + `nextjs-supabase` adapter (`packages/zdd-engine`, also the npm package
`@rich-rees/zdd-engine`), and templates (CLAUDE.md snippet, CI workflow, config
schema + example, and the seed ADR-0001).

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
  templates/
    claude-md-snippet.md
    zdd.yml                             # CI check (the with-CI path)
    config.schema.json  config.example.json
    adr-0001-adopt-zero-drift-docs.md   # seeded as the adopter's first ADR
packages/zdd-engine/                # deriver / renderer / checks + adapters + viewer
  bin/zdd-engine.mjs                # the CLI (derive / render / lint / freshness)
  src/  test/fixture/               # engine source + the miniature proving repo
LICENSE   CONTRIBUTING.md   README.md
```

## Roadmap

- [x] Extract the engine (`derive` / `render` / checks + `nextjs-supabase` adapter)
      from the PressPlay proving instance into `packages/zdd-engine` *(v0.2)*.
- [x] Decide engine distribution: **npm package** — `@rich-rees/zdd-engine` is the
      single source both CI (npx, no Claude Code) and the skills call *(v0.2)*.
- [x] Wire the skills' `TODO(engine)` steps to the real invocations *(v0.2)*.
- [x] Publish `@rich-rees/zdd-engine` to npm — live at 0.2.0, verified end-to-end
      via `npx` against the fixture *(2026-08-14)*.
- [ ] Expose the graph as a first-class data-model artifact (nodes + edges JSON),
      then make **viewers pluggable** via a registry — so contributed visualizations
      ship as selectable options (the output-end counterpart to adapters).
- [ ] Conceptual reference doc (`spec.md`) for readers/contributors — repo-only,
      never installed into an adopter repo.

## Versioning

Semver, tracked in `plugins/zdd/plugin.json` and the marketplace entry (kept in
sync), and marked with a matching git tag (`vX.Y.Z`).

- **`0.x` — private, pre-release.** Building and proving against the PressPlay
  instance. The API (skill names, config shape, engine CLI) may change freely.
  `0.1.0` was the scaffold; **`0.2.0`** adds the extracted engine.
- **`1.0.0` — first public release.** Cut when a clean repo can adopt ZDD
  end-to-end (engine is on npm as of 0.2.0). From here, breaking changes bump
  the major.

## Contributing

Forks and pull requests welcome — the architecture is built for it, with a plug-in
point at **both ends**: **adapters** feed data in (a new stack — FastAPI, Rails,
Go…), and **viewers** render it out (a new visualization of the human index). The
engine and the graph data model sit stable in the middle. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE).
