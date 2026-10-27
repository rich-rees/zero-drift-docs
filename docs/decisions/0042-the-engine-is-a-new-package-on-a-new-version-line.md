# 0042 — The engine is a new package on a new version line; the config's `release` pin says which line a repo is on, and the command line is the engine's only contract

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3 slice 6, questions 1, 3 and 5 of its design interview (Rich's calls), carrying out the relaunch decided in ZDD-4 (ZDD v0.9 published as `@rich-rees/zdd`, 1.0 at the video). **Extends** [0035](0035-a-lint-failure-the-same-releases-upgrade-clears-or-names-is-a-minor.md): the crossing is an upgrade, not a reinstall.

## Context

The core and adapter split (0036–0041) ships as ZDD 0.9.0, and 1.0.0
follows with the video. npm never lets a version number be reused, and
`@rich-rees/zdd-engine` already published 0.2.0 to 2.5.0, so a fresh 0.9.0
needs a new package name: `@rich-rees/zdd`. The numbers go down, from 2.5.0
to 0.9.0, and from 1.0.0 they collide (1.0.0 to 2.5.0 exist on both lines).

Everything that compared versions read one number with no package name: the
skew check (2.5.0 against plugin 0.9.0 said "ahead — update the plugin"),
the upgrade's "never backwards" guard (it refused the move outright), the
notes it shows (none newer than 2.5.0), the rules its text pass re-reads,
the lock tag, and the release check's "newest tag". A repo's config pinned
`"engine": "2.5.0"`, and that is the one pin every repo has: the CI workflow
and the pre-push hook name the package, but a repo can switch both off.

Separately, slice 2b declined three findings about deep imports that a
moved file broke (CR-062 to CR-064), on the grounds that deep imports are
not a contract and the exports map is where one would be made.

## Decision

1. **The package is `@rich-rees/zdd`.** The folder `packages/zdd-engine` and
   the `zdd-engine` command keep their names; `npx -y @rich-rees/zdd@0.9.0
   derive` runs the package's one bin. Every pin ZDD owns names the new
   package, and the upgrade rewrites a pin of either name.
2. **The config's key says the line.** The new line pins `"release":
   "0.9.0"` (the ZDD release: plugin and engine share its number); the old
   line pinned `engine`. A config with `release` is the new line, one with
   `engine` (or neither) the old line, forever, with no guessing. The
   upgrade moves `engine` to `release` where it sat; a config holding both
   is refused by name, before any write.
3. **Every old-line release comes before every new-line release**, whatever
   the numbers. In the strings the plugin compares, an old-line release
   carries the old package's name (`zdd-engine@2.5.0`): the old notes and
   the instruction rules' `since` are keyed so, and a pin of
   `@rich-rees/zdd-engine` is always "behind", never "ahead". A lock tag is
   the old line's when it is one of the 18 tags the old repository carried
   (`OLD_LINE_TAGS`); the release check's newest tag skips them, and `--to`
   refuses one.
4. **The exports map opens `./package.json` and nothing else.** The command
   line is the whole public surface; importing a source file fails with
   Node's own error, where before it worked until a release moved the file.
   When the adapters become a package of their own, a helper API is opened
   on purpose then.

## Consequences

- An old-line repo's upgrade reads as one: pins move, the 0.9 notes are
  shown, and the team's own instruction text is re-read only against rules
  changed after its old pin.
- An old-line plugin never offers 0.9.0 (it looks for a higher number), so
  each adopter moves its lock to `v0.9.0` by hand once (README,
  "Upgrading"); from there "upgrade ZDD" is the guided flow.
- `OLD_LINE_TAGS` is wrong from 1.0.0, where a new-line `v1.0.0` would read
  as the old line's: a test fails a 1.x plugin that still lists them, and
  the relaunched repository (ZDD-4) carries none of those tags.
- npm trusted publishing is set up again for the new name before the first
  tag (ZDD-4).
- A local extractor's test scaffolded before 0.9 runs
  `@rich-rees/zdd-engine@<engine>`; the retired-name list names it, and a
  fresh scaffold reads whichever pin the config holds.
- Anything that imported an engine file breaks at 0.9. Nothing ZDD ships
  does: the plugin runs the command, and a local adapter cannot import the
  engine (decision 0010).

## Rejected

- **Keep `@rich-rees/zdd-engine` for 0.9; rename in ZDD-4.** Least work now,
  but 0.9.0 published under a name that already has 2.5.0 makes npm's
  "latest" go backwards, and ZDD-4 redoes every pin and check.
- **Rename the folder and the command too.** Everything matches, at the
  cost of a far larger diff (every test path, both workflows) inside the
  same review as the real change; the folder can move at the scrub.
- **Keep `engine` and work the line out from evidence** (the CI pin's
  package, or the number being one of the old line's). No config change,
  but a guess: a repo with no CI or hook on old 1.3.1 reads as new 1.3.1.
- **Special-case only the 0.9 crossing, and have 1.0 refuse any old-line
  config.** Smallest code, but a two-hop upgrade, and the ambiguity returns
  for whoever skips 0.9.
- **Open a helper API in the exports map now** (`io`, the comment masker,
  record helpers). Ready for contributors, but each becomes a promise and
  nothing uses them yet. **A wildcard over `src/`** keeps every deep import
  working and makes no contract at all.
