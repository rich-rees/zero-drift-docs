# Beyond local — the registry and the fork

Read from [SKILL.md](SKILL.md) when the user asks for tier 2 or 3. The
design interview (Steps 1–2) and the hardening checklist (Step 5) apply
unchanged; what differs is where the code lives and what else must ship
with it.

## Tier 2 — a registry contribution

The extractor moves into the engine and ships to every adopter in the next
**minor** release (a new extractor is backward-compatible). The work happens
in a fork of `rich-rees/zero-drift-docs`, on a branch (`extractor/<name>`),
opened as a PR; the maintainer reviews, merges and publishes. There is no
scaffold script for this tier — the checklist below is the scaffold.

Promoting a proven local extractor is mostly a move: the module keeps its
`derive({ repoRoot, options, io })` shape, its fixture becomes the engine's,
and its tests move from the pinned engine to the checkout.

A PR is complete when it holds every item:

- [ ] **The module** — `packages/zdd-engine/src/extractors/<name>/index.mjs`,
      options documented in its leading comment, reads through `io`.
- [ ] **The registry line** — `EXTRACTORS` in `packages/zdd-engine/src/derive.mjs`,
      and the same name in `BUILT_INS` in `plugins/zdd/scripts/scaffold-extractor.mjs`
      (a test holds the two together, and a local extractor of that name now
      refuses to load — say so in the PR).
- [ ] **A fixture repo** — `packages/zdd-engine/test/fixture-<name>/` with a
      `zdd/config.json` selecting the extractor, and the Step 4 cases.
- [ ] **Tests** — `packages/zdd-engine/test/<name>.test.mjs`: the expected
      records, missing source, oversized source, the POSIX-only symlink cases
      (`{ skip: process.platform === "win32" && … }`), and each mask edge the
      dialect has; plus the fixture added to the determinism matrix in
      `test/extractors.test.mjs` (two fresh copies, a second run, `--check`).
- [ ] **A detection probe** — in `plugins/zdd/scripts/bootstrap.mjs` `detect()`:
      the evidence it looks for, the options it implies, bounded reads. Proven
      at the file seam in `plugins/zdd/test/bootstrap.test.mjs` (scripted
      answers against a fixture, files on disk asserted).
- [ ] **The schema block** — `extractorOptions.<name>` in
      `plugins/zdd/templates/config.schema.json`.
- [ ] **The README rows** — the extractor list and its options in
      `packages/zdd-engine/README.md`'s config table, and the stack table in
      the root `README.md` where one applies.
- [ ] **The release note** — one line in the root `README.md` release list.
- [ ] **Both suites green** —
      `cd packages/zdd-engine && node --test "test/*.test.mjs"` and
      `node --test "plugins/zdd/test/*.test.mjs"`; CI runs them on Ubuntu and
      Windows × Node 20/22.

The version bump itself is the maintainer's: engine and plugin move
together, with every pin (CONTRIBUTING.md, "The prize: writing an
extractor").

## Tier 3 — a fork

For a convention upstream declines, or a team that wants its own release
cadence. The user publishes the engine under their own npm scope and points
the plugin at it:

- [ ] Rename the package in `packages/zdd-engine/package.json`
      (`@<scope>/zdd-engine`) and publish it.
- [ ] Repin `ENGINE_PACKAGE` in `plugins/zdd/scripts/lib/repo.mjs`.
- [ ] Repin the CI template (`plugins/zdd/templates/zdd.yml`), the pre-push
      template (`plugins/zdd/templates/pre-push`) and every skill's `npx` line.
- [ ] Install the forked plugin in place of the upstream one, and run
      `zdd:bootstrap --upgrade` in each adopting repo to rewrite its pins.

A fork owns every future engine fix by hand. Before recommending it, offer
tier 1: a local extractor needs no fork at all.
