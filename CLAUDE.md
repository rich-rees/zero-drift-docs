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
- **Tests are the contract.** Engine: `cd packages/zdd-engine && node --test "test/*.test.mjs"`.
  Plugin (the runbook and hooks at the file/process seam):
  `node --test "plugins/zdd/test/*.test.mjs"`. Same source bytes in ⇒ byte-identical artifacts out — no timestamps, no
  environment-dependent values, no LLM anywhere in the engine. A change that
  alters bytes shows up as a golden diff (`test/golden/`); regenerate a golden
  only as a deliberate, narrated step, never to make a red test pass.
- **Write the failing test first** for a bug; for a feature, alongside the code.
  A test goes green by changing the code, never by weakening the test.
- **The engine version is pinned in more than one place** — the CI workflow
  template, the pre-push template, and every skill's `npx` line — and the plugin
  shares the engine's version line (`load` compares them). Bump them together in
  one PR, run `render`, and commit the result. A new mandatory generated file is a breaking
  change for adopters' CI (decision 0002).
- **A ZDD release pins one Pocock release** (decision 0014): the tag, commit
  and version live in `plugins/zdd/pocock.json` and the marketplace entry for
  `mattpocock-skills`, and a test keeps them equal. Taking a new Pocock release
  is a ZDD release, tested against it; it never moves on its own.
- **Semver on the engine:** config-schema or metadata-contract break = major.
  Plugin version lives in both manifests (`plugins/zdd/.claude-plugin/plugin.json`,
  `plugins/zdd/.codex-plugin/plugin.json`) and the marketplace entry, kept in
  sync (a test pins them), tagged `vX.Y.Z`.

## Releasing

Every line is checked off in the release PR; *(test)* marks the ones a test
already holds, so a red suite names what was forgotten.

**Before the PR merges**

- [ ] The version pins move together and `render` runs (above). *(test)*
- [ ] Whatever a new feature **reads**, bootstrap **writes** — a test binds
      each writer to its reader (as the lock bootstrap writes is the one the
      release check reads). *(test, per feature)*
- [ ] `UPGRADE_NOTES` in `scripts/bootstrap.mjs` has an entry for this minor,
      and `skills/upgrade/SKILL.md` an "Upgrading to X.Y" section. *(test)*
- [ ] ZDD's instructions (`templates/instructions.md` — written to the
      adopter's `zdd/instructions.md`, loaded by one import line in
      `CLAUDE.md`, copied into `AGENTS.md` for Codex) reviewed against the
      skills that shipped; they name every skill. *(test)*
- [ ] README: status, roadmap entry, Versioning entry. *(test)* CONTRIBUTING
      status. *(test)*
- [ ] Adopter impact stated in the Versioning entry: what moves in their
      `derive --check` / `render --check` on the bump.
- [ ] Both suites green on CI (ubuntu + windows × Node 20/22).

**Release order** (held since 1.3.1)

1. Merge the PR (merge commit).
2. `npm whoami` prints the publisher — an expired token makes `npm publish`
   fail **404 with no OTP prompt**; `npm login` first.
3. Publish the engine from `main` (`packages/zdd-engine`).
4. Tag the merge commit `vX.Y.Z` and push the tag.
5. GitHub release for the tag, marked **Latest**, notes from the Versioning
   entry.
6. Check from **outside** this repo: `npx -y @rich-rees/zdd-engine@X.Y.Z`
   prints the engine's usage, and `npm view @rich-rees/zdd-engine version`
   names X.Y.Z (inside the repo, npm finds the workspace copy and installs
   nothing).
7. Move this machine's install: the route the release check prints.

**After**

- [ ] Open (or restart) each adopter's pin-move task, listing the generated
      files expected to move.

## Skills

The plugin's skills (`plugins/zdd/skills/*/SKILL.md`) are the product. The
kernel is the spoken verbs — "load ZDD" (`load`), "choose patterns"
(`patterns`), "update ZDD" (`update`), and "upgrade ZDD" (`upgrade`, which
drives `bootstrap.mjs upgrade`) — plus `bootstrap` (the runbook), the optional
`grill`, and `extractor` (scaffold a local extractor — decision 0010). The runbook's writer is
`plugins/zdd/scripts/bootstrap.mjs`: the skill asks, the script detects and
writes, and it is the only writer of *adopter-owned* files — config, skeleton,
opt-ins, ZDD's instructions file and the one line that loads it (decisions
0003 and 0024) — save one:
`scripts/scaffold-extractor.mjs`, which writes a local extractor's skeleton and
its config lines by bootstrap's rules (exclusive create, never overwrite,
the same `Ledger` report). The engine's `derive` /
`render` write the generated artifacts, and nothing else writes into an
adopter's repo. When a
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
