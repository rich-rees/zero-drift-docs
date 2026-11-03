# Beyond local — the starter library and the fork

Read from [SKILL.md](SKILL.md) when the user asks for tier 2 or 3. The
design interview (Steps 1–2) and the hardening checklist (Step 5) apply
unchanged; what differs is where the code lives and what else must ship
with it.

## Tier 2 — a starter contribution

The adapter becomes a starter in the starter library
(`packages/zdd-starter-adapters`, npm `@rich-rees/zdd-starter-adapters`,
decision 0048): later repos can copy it in, and own their copy from then on.
The engine never changes: it ships no adapter. The work happens in a fork of
`rich-rees/zero-drift-docs`, on a branch (`extractor/<name>`), opened as a
PR; the maintainer reviews, merges and releases the library. There is no
scaffold script for this tier — the checklist below is the scaffold.

Promoting a proven local adapter is mostly a move: the module keeps its
`derive({ repoRoot, options, io })` shape, and its folder, its fixture and
its tests travel together, as they will into the next app.

A PR is complete when it holds every item:

- [ ] **The starter** — `packages/zdd-starter-adapters/adapters/<name>/index.mjs`,
      options documented in its leading comment, reads through `io`, imports
      nothing of the engine. Code it shares with other starters goes in
      `adapters/_shared/`, by a static relative import; nothing else outside
      its folder.
- [ ] **The name** — the folder name is the name config selects; add it to
      `BUILT_INS` in `plugins/zdd/scripts/scaffold-extractor.mjs`, the
      starters a scaffold can be shaped like (a test holds the two together).
- [ ] **Its suite fixture** — `adapters/<name>/fixture/`, a miniature repo in
      its convention with the Step 4 cases, and `export const SUITE = { options }`
      (with `companions` the starters it links run beside it). The library's
      `test/standard-suite.test.mjs` runs it exactly as an app's suite will.
- [ ] **Its own tests** — `adapters/<name>/test/<name>.test.mjs`: the
      expected records, missing source, oversized source, the POSIX-only
      symlink cases (`{ skip: process.platform === "win32" && … }`), and each
      mask edge the dialect has. They import ZDD only through the kit
      (`import { ioFor, scanFor, trialRead } from "@rich-rees/zdd"`), so they
      run in an app with `npx -y @rich-rees/zdd@<release> test`.
- [ ] **Its detection** — `DETECTION` and `detect({ scan, proposed })` in the
      adapter's own folder (decision 0039; the contract is in CONTRIBUTING):
      the evidence it looks for in plain words, the options it implies, the
      parts it covers, its option shape. Never a probe in bootstrap. Proven in
      `packages/zdd-starter-adapters/test/detect.test.mjs`, and an
      `example/` folder for the greenfield preview.
- [ ] **The note** — a new version in `packages/zdd-starter-adapters/notes.json`
      (oldest first; the stager checks its shape) and the matching `version`
      in its `package.json`. A new starter changes no copy, so its entry
      names no starter; a fix to an existing starter says `what` changed,
      `who` it affects and how ids `moves`.
- [ ] **The schema block** — `extractorOptions.<name>` in
      `plugins/zdd/templates/config.schema.json`.
- [ ] **The README rows** — the starter and its options in
      `packages/zdd-starter-adapters/README.md`, and the stack table in the
      root `README.md` where one applies.
- [ ] **Every suite green** —
      `cd packages/zdd-engine && node --test "test/*.test.mjs"`,
      `cd packages/zdd-starter-adapters && node --test "test/*.test.mjs" && node ../zdd-engine/bin/zdd-engine.mjs test --adapters=adapters`,
      and `node --test "plugins/zdd/test/*.test.mjs"`; CI runs them on Ubuntu
      and Windows × Node 20/22.

The release itself is the maintainer's: a tag `starter-adapters-vX.Y.Z` on
`main` publishes the library on its own version line, and no engine or
plugin pin moves.

## Tier 3 — a fork

For a convention upstream declines, or a team that wants its own release
cadence. The user publishes the engine under their own npm scope and points
the plugin at it:

- [ ] Rename the package in `packages/zdd-engine/package.json`
      (`@<scope>/zdd`) and publish it.
- [ ] Repin `ENGINE_PACKAGE` in `plugins/zdd/scripts/lib/repo.mjs`.
- [ ] Repin the CI template (`plugins/zdd/templates/zdd.yml`), the pre-push
      template (`plugins/zdd/templates/pre-push`) and every skill's `npx` line.
- [ ] Install the forked plugin in place of the upstream one, and run
      "upgrade ZDD" in each adopting repo to rewrite its pins.

A fork owns every future engine fix by hand. Before recommending it, offer
tier 1: a local extractor needs no fork at all.
