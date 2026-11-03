# Zero-Drift Docs — working in this repo

This is the **plugin repo** for Zero-Drift Docs: a Claude Code / Codex plugin
(`plugins/zdd`) and the engine it calls (`packages/zdd-engine`, npm
`@rich-rees/zdd` from 0.9.0 — a new version line; the old one was
`@rich-rees/zdd-engine`, 0.2.0 to 2.5.0, decision 0042). Small on purpose — read it whole. The architecture has
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
- **Tests are the contract.** Engine (the core alone): `cd packages/zdd-engine && node --test "test/*.test.mjs"`.
  Starter library (every golden, the core with the starters, and each
  starter's own tests as an app runs them, decision 0048):
  `cd packages/zdd-starter-adapters && node --test "test/*.test.mjs" && node ../zdd-engine/bin/zdd-engine.mjs test --adapters=adapters`.
  Plugin (the runbook and hooks at the file/process seam):
  `node --test "plugins/zdd/test/*.test.mjs"`. The human index, clicked
  (`test/browser/`, its own Playwright, outside the published package —
  decision 0044): `cd test/browser && npm ci && npx playwright install
  chromium && node --test "*.test.mjs"` (`install --with-deps chromium` on a
  clean Linux machine); CI runs it on ubuntu. Same source bytes in ⇒ byte-identical artifacts out — no timestamps, no
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
- **Two version lines** (decision 0042). 0.9.0 starts the new one
  (`@rich-rees/zdd`, the config's `release` pin); every release of the old
  one (`@rich-rees/zdd-engine`, the config's `engine` pin, 0.2.0 to 2.5.0)
  comes before it. Before 1.0 the adapter contract stays at 1 and may
  change without an upgrade interview; 1.0.0, with the video, freezes it
  and must retire `OLD_LINE_TAGS` in `bootstrap.mjs` — the numbers collide
  from there, and a test fails a 1.x plugin that still lists them.

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
- [ ] Every suite green on CI (ubuntu + windows × Node 20/22), and
      `browser-smoke` green: the tag workflows and `pre-tag` run the
      engine, starter library and plugin suites but not the browser's, so
      this line is the browser's release gate (decision 0044).

**Once, for 0.9.0** (the new line's first release; ZDD-4 does the rest)

- [ ] The tag is pushed from the relaunched repo, which carries none of the
      old line's `vX.Y.Z` tags.
- [ ] npm trusted publishing is set up for `@rich-rees/zdd` before the tag.
- [ ] Each adopter's lock moves to `v0.9.0` by hand (README, "Upgrading"):
      an old-line release's check never offers a lower number.

**Once, for 0.14.0** (the starter library's first release, decision 0048).
After step 2 below and before step 3, in this order, within one sitting:

- [ ] `@rich-rees/zdd-starter-adapters@0.1.0` (the baseline) is published by
      hand from a fresh stage of the merge commit (`node
      packages/zdd-starter-adapters/scripts/stage.mjs 0.1.0 <empty dir>`, then
      `npm publish --access public` in it): npm's trusted publishing needs
      the package to exist, and a new package's first publish is staged by
      npm (a `0.0.0-stage` placeholder; check the registry, not the website).
      Then `npm view @rich-rees/zdd-starter-adapters@0.1.0 dist.integrity`
      equals `npm pack --dry-run --json`'s `integrity` in that stage dir.
- [ ] Its trusted publisher (GitHub Actions, `rich-rees/zero-drift-docs`,
      `release-starter-adapters.yml`) is created on npmjs.com, then 0.2.0 is
      published through it by its tag (step 3) the same day: a pending
      publisher expires after about two days unless a publish through it
      succeeds.

**Release order** (since 2.3.0 the tag does the publishing —
`.github/workflows/release.yml`; before it, the engine was published by hand
first, which that workflow now refuses). Two version lines: the ZDD release
`vX.Y.Z` (engine and plugin), and the starter library's own `A.B.C`.

1. Merge the PR (merge commit).
2. On `main` at the merge commit, `node scripts/pre-tag.mjs vX.Y.Z [adopter
   checkouts…]`, **before anything is published**: the pins, the engine,
   starter library and plugin suites, the starters' own tests, and a dry run
   of the upgrade on each real adopter given (a throwaway copy; never
   pushed). It runs this checkout's engine and the library beside it, so it
   needs neither on npm.
3. **The starter library, when the plugin's pin moved**
   (`plugins/zdd/starter-adapters.json`; decision 0048). An installed plugin
   fetches the library version it pins from npm (bootstrap, the upgrade,
   preflight), so that version is on npm **before** the ZDD tag. Tag the
   merge commit `starter-adapters-vA.B.C` and push it:
   `.github/workflows/release-starter-adapters.yml` refuses a tag not on
   `main`, runs the engine and starter library suites and the staged
   version's own tests in a read-only job, then stages it fresh, publishes it
   by trusted publishing, waits until it is fetchable and makes a GitHub
   release never marked Latest. Check `npm view
   @rich-rees/zdd-starter-adapters@A.B.C version` from outside the repo
   before step 4. A library-only fix (a starter changed, the plugin's pin
   not) is this step alone, after the library's own suites, with no ZDD
   release.
4. Tag the merge commit `vX.Y.Z` and push the tag. The workflow refuses a tag
   that is not on `main`, proves the pins, runs the engine, starter library
   and plugin suites, publishes the engine (no secret: npm trusts this
   workflow by name, set up once on the package's npmjs.com settings —
   `@rich-rees/zdd` needs it set up before its first tag, decision 0042; the
   library's trusted publisher names `release-starter-adapters.yml`), waits
   until the version is fetchable, and creates the GitHub release marked
   **Latest** with the Versioning entry as its notes. A failed run after the
   publish is rerun as it is: a version already on npm from this commit is
   resumed, not refused. The tag is fetchable before the engine is: adopters
   take a release only by moving their lock, after this step and step 5.
5. Check from **outside** this repo: `npx -y @rich-rees/zdd@X.Y.Z`
   prints the engine's usage, and `npm view @rich-rees/zdd version`
   names X.Y.Z (inside the repo, npm finds the workspace copy and installs
   nothing).
6. Move this machine's install: the route the release check prints.

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
