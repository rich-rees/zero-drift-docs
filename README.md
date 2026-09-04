# Zero-Drift Docs (ZDD)

A documentation architecture for repos built by **human + agent pairs**. ZDD keeps
seven documentation artifacts *at most one unit of work behind the code* — and, with
CI, makes drift in the machine-generated ones **un-mergeable**.

> **Status: 1.0.0 — first public release.** The plugin installs in Claude Code
> and in Codex from this one repo; `bootstrap` detects your stack (or grills
> for it on a greenfield repo), proposes extractors with evidence, and *writes*
> the opt-ins; the engine (`packages/zdd-engine`, npm `@rich-rees/zdd-engine`)
> carries composed extractors and the graph artifact + viewer registry. Two
> plug-in points are open for contributors: extractors in, viewers out.

## What ZDD does, in two lines

ZDD does two things: **load** and **update**. You can do both by hand with any
coding agent — read the glossary and decisions before you build, curate and
regenerate the docs before you finish. It is only truly *zero*-drift on the
runbook's defaults, which include a CI check that refuses to merge stale
generated artifacts. Everything else in this repo exists to make those two
things cheap and the defaults the easy path.

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

Two spoken verbs carry it, and both work with any coding agent: **"load ZDD"**
before you work (the `load` skill, plus an auto-injected index) and **"update
ZDD"** before you finish (the `update` skill). With the CI check in place the unit
of work is the PR and stale generated artifacts cannot merge; without it, ZDD is
the two verbs and the guarantee is a habit.

## What the plugin is (and is not)

It ships the **machine that makes `zdd/` folders** — never anyone's docs. It carries
no glossary terms, no map, and **none of ZDD's own ADRs**: the rationale for *why*
ZDD is designed this way is baked into the mechanism, not shipped as decisions. An
adopter consumes it as a finished tool.

`bootstrap` is the install runbook. On an existing codebase it scans for each
extractor's convention and shows you the evidence ("SQL migrations under
`supabase/migrations`", "`APIRouter` under `api/routes`") to confirm rather than
describe; on a greenfield repo it asks for the intended stack and configures the
extractors ahead of the code. Then it offers the opt-ins as yes/no with defaults
on and **writes** them — the session-start auto-load, the generated-artifact
fence, the CI workflow (or, if you decline CI, a pre-push hook), the instruction
block in `CLAUDE.md` (and `AGENTS.md` for Codex) — plus an empty `zdd/` and one
seeded **ADR-0001** recording *your* decision to adopt ZDD: the corpus's first
entry *and* a worked example of the format. Branch protection is the one step it
prints instead of doing. Idempotent; and `bootstrap --upgrade` is the only thing
that writes into your repo later, narrating every file it changes.

Contents: four skills (`bootstrap`, `load`, `update`, `grill`), a shared authoring
guide, two hooks (auto-load, fence), the runbook script, the engine + composed
extractors + viewers (`packages/zdd-engine`, also the npm package
`@rich-rees/zdd-engine`), and templates (instruction block, CI workflow, pre-push
hook, config schema + example, and the seed ADR-0001).

### Producing decisions — ZDD stands alone, grilling makes it sharper

ZDD *captures* decisions; how you *produce* them is your choice. The `update` and
`bootstrap` skills carry their own compact authoring discipline
([`skills/authoring.md`](plugins/zdd/skills/authoring.md) — the ADR-worthiness test,
the glossary/ADR formats, capture-at-crystallization), so ZDD writes decent
glossary entries and ADRs on its own, from plan-mode work or plain thinking.

For a sharper way to drive decisions out, install
[Matt Pocock's skills](https://github.com/mattpocock/skills) (`mattpocock-skills`)
and use **`grill`** — a relentless design interview that writes the glossary
and ADRs as it goes, redirected into your `zdd/` folder. It self-checks: with the
plugin absent it points you at the install or at plan-mode + "update ZDD", and ZDD
keeps working. `bootstrap` says the same in plain words. **Recommended, never
required.**

## Install

**Claude Code** — inside a session:

```
/plugin marketplace add rich-rees/zero-drift-docs
/plugin install zdd@zero-drift-docs
```

**Codex** — from a terminal:

```
codex plugin marketplace add rich-rees/zero-drift-docs
codex plugin add zdd@zero-drift-docs
```

Both hosts read the same marketplace file and the same plugin body — two
manifests (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) pointing at
one set of skills and one `hooks.json`. After install the four skills are
`bootstrap`, `load`, `update` and `grill` (Claude Code lists them as
`/zdd:load` etc.); the SessionStart auto-load fires on the next session start
in a repo that opted in. Install works from a private fork too — it uses your
git credentials.

Then run **`bootstrap`** in your repo and answer its questions. It detects the
stack, writes `zdd/`, the config, the opt-ins and the instruction block, runs
the first derive and render, and leaves you one step:

### …with CI — the real guarantee

In branch protection: require the **zdd** check to pass, and require branches to
be up to date before merging. Now stale generated artifacts **cannot merge**. Note
the split this enforces: CI makes *drift in the generated artifacts* un-mergeable —
the curated artifacts stay one unit of work behind on the ritual (no script can
judge "should this have been an ADR?").

### …without CI — the two verbs

CI is a strong recommendation, not a hard dependency. Decline it and ZDD still
runs: the agent loads before it works and updates before it finishes. You lose
*enforcement* — ZDD drops from a provable guarantee to a good habit, and
`bootstrap` says so. The middle option it offers is a local git pre-push hook
running the engine's `--check`, which makes a forgotten update **loud** without a
merge gate.

### Upgrading

Updating the plugin never touches your repo. `load` warns when your pinned engine
falls behind the plugin; run **`bootstrap --upgrade`** to migrate config
(`adapter` → `extractors`), rewrite the engine pins, the hook and the instruction
block — every changed file named, curated artifacts untouched.

## Repo layout

```
.claude-plugin/marketplace.json     # this repo is a plugin marketplace (Claude Code + Codex)
plugins/zdd/
  .claude-plugin/plugin.json        # two manifests, one body
  .codex-plugin/plugin.json
  hooks/hooks.json                  # SessionStart auto-load + PreToolUse fence (opt-ins read from zdd/config.json)
  scripts/
    bootstrap.mjs                   # the runbook's writer: detect / apply / upgrade
    inject-agent-index.mjs  fence.mjs  check-skew.mjs
  skills/{bootstrap,load,update,grill}/SKILL.md
  skills/authoring.md               # shared curated-docs authoring discipline
  templates/
    claude-md-snippet.md            # the instruction block (CLAUDE.md / AGENTS.md)
    zdd.yml  pre-push               # CI check / local hook
    config.schema.json  config.example.json
    adr-0001-adopt-zero-drift-docs.md   # seeded as the adopter's first ADR
  test/                             # seam 2: the runbook and hooks observed as files + processes
packages/zdd-engine/                # deriver / renderer / checks + extractors + viewers
  bin/zdd-engine.mjs                # the CLI (derive / render / lint / freshness)
  src/extractors/{supabase,nextjs,fastapi,generic}/   # input end: one per convention
  src/viewers/{cytoscape,minimal}/  # output end: human-index viewers over graph.json
  test/fixture*/                    # the miniature proving repos
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
- [x] **Composed extractors** — the `nextjs-supabase` adapter split into `supabase`
      + `nextjs` (byte-identical output), plus `fastapi` and `generic`; a declared
      repo-local extractor directory; greenfield repos derive clean *(engine 0.3.0,
      DIO-309; [decision 0001](docs/decisions/0001-composed-extractors.md))*.
- [x] **Graph artifact + pluggable viewers** — `render` writes the map+metadata
      join as `zdd/graph.json` (schema `zdd-graph/1`) and renders the human index
      through a viewer selected by config from a registry; the Cytoscape viewer
      is viewer #1, isolated under its Apache-2.0 notice, and `minimal` is the
      worked example *(engine 0.4.0, DIO-310;
      [decision 0002](docs/decisions/0002-graph-artifact-and-viewers.md))*.
- [x] **Bootstrap runbook, Codex, upgrade** — detect / greenfield modes with
      evidence, opt-ins written (auto-load, fence, CI or pre-push), `orient` →
      `load` with an engine-skew warning, `bootstrap --upgrade`, a Codex manifest
      beside the Claude one *(plugin 0.4.0, DIO-311; decisions
      [0003](docs/decisions/0003-kernel-and-opt-ins.md),
      [0004](docs/decisions/0004-pocock-skills-recommended-not-required.md),
      [0005](docs/decisions/0005-no-zdd-in-the-plugin-repo.md),
      [0006](docs/decisions/0006-one-repo-two-manifests.md))*.
- [x] **1.0.0** — live smoke test in both hosts against `rich-rees/zdd-smoke-test`,
      one review campaign over the whole 0.3.1 → 1.0 diff, tag `v1.0.0`,
      engine 1.0.0 on npm, repo public (DIO-312).
- [ ] Next: `react-router` and `expo-router` extractors on their first real
      adoption; a second viewer.

## Versioning

Semver, tracked in both plugin manifests and the marketplace entry (kept in
sync — a test pins them together), and marked with a matching git tag
(`vX.Y.Z`). The plugin and the engine share a version line so `load`'s skew
warning can say "behind".

- **`0.x` — private, pre-release.** Building and proving against the PressPlay
  instance. The API (skill names, config shape, engine CLI) may change freely.
  `0.1.0` was the scaffold; `0.2.0` added the extracted + published engine;
  `0.3.0` made the curated half self-sufficient and added the optional `grill`
  companion; `0.4.0` was the runbook, `load`, the opt-in hooks and Codex.
- **`1.0.0` — first public release.** A clean repo adopts ZDD end-to-end in
  either host; engine and plugin both at 1.0.0. From here, breaking changes
  bump the major: on the engine, a config-schema or metadata-contract break,
  or a new *mandatory* generated file (it breaks adopters' CI —
  [decision 0002](docs/decisions/0002-graph-artifact-and-viewers.md)).

## Contributing

Forks and pull requests welcome — the architecture is built for it, with a plug-in
point at **both ends**: **extractors** feed data in (a new convention — Rails,
Go, a router…), and **viewers** render it out (a new visualization of the human index). The
engine and the graph data model sit stable in the middle. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE).
