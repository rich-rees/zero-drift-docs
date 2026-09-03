# Zero-Drift Docs — working in this repo

This is the **plugin repo** for Zero-Drift Docs: a Claude Code / Codex plugin
(`plugins/zdd`) and the engine it calls (`packages/zdd-engine`, npm
`@rich-rees/zdd-engine`). Small on purpose — read it whole. The architecture has
a plug-in point at both ends: **extractors** feed data in (one per convention),
**viewers** render it out (one per visualization), and a stable graph artifact
sits between them. Contracts for both: `CONTRIBUTING.md`.

## This repo does not use ZDD

Deliberately. It is small enough to read whole, and knowing when *not* to use
the tool is part of knowing the tool. So there is no `zdd/` here, no glossary,
no agent index, and no `update` ritual. Decisions live in **`docs/decisions/`**
as plain ADR-format markdown, numbered `NNNN-kebab-title.md` — write one when a
decision is hard to reverse, surprising without context, and a real trade-off
(the same three-way test the plugin teaches in `plugins/zdd/skills/authoring.md`).
Supersession points both ways; never edit an accepted decision into a new truth.

## How to work

- **Branch off `main`**, never commit on it. Conventional commits (`feat:`,
  `fix:`, `docs:`, `test:`, `chore:`), one logical change each. One PR per change,
  merged with a merge commit.
- **Tests are the contract.** `cd packages/zdd-engine && node --test "test/*.test.mjs"`.
  Same source bytes in ⇒ byte-identical artifacts out — no timestamps, no
  environment-dependent values, no LLM anywhere in the engine. A change that
  alters bytes shows up as a golden diff (`test/golden/`); regenerate a golden
  only as a deliberate, narrated step, never to make a red test pass.
- **Write the failing test first** for a bug; for a feature, alongside the code.
  A test goes green by changing the code, never by weakening the test.
- **The engine version is pinned in more than one place** — the CI workflow
  template and every skill's `npx` line. Bump them together in one PR, run
  `render`, and commit the result. A new mandatory generated file is a breaking
  change for adopters' CI (decision 0002).
- **Semver on the engine:** config-schema or metadata-contract break = major.
  Plugin version lives in `plugins/zdd/.claude-plugin/plugin.json` and the
  marketplace entry, kept in sync, tagged `vX.Y.Z`.

## Skills

The plugin's skills (`plugins/zdd/skills/*/SKILL.md`) are the product. When a
skill wraps an upstream one (`grill` wraps Matt Pocock's grilling +
domain-modeling), it self-checks and degrades with a clear message — **never
improvise a substitute** for the wrapped skill. Skills are executed by reading
the SKILL.md from disk and following it; a name that refuses to invoke is a
routing problem, not a missing capability.

## What not to add

- Docs content or rationale for any specific project — the plugin ships the
  machine that makes `zdd/` folders, never anyone's glossary, ADRs, or map.
- Workflow or process opinion tied to a tracker, host, or CI vendor. Keep the
  plugin stack- and tool-neutral; team-specific process lives in the adopting
  repo's own instructions.
- Secrets, ever. Nothing here reads one.

Machine- or team-specific notes go in `CLAUDE.local.md` (gitignored).
