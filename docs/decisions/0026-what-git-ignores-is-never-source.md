# 0026 — What git ignores is never source: the ignore set comes from the repository's `.gitignore` rules, and derive stops when git cannot list it

**Date:** 2026-10-09 · **Status:** accepted · **Origin:** CAS-103 (ZDD 2.3) pick 1, from DIO-335 finding 15 and CAS-102; the slice 1 and slice 2 reviews (CR-307, CR-308, CR-309, CR-403, CR-406).

## Context

The services extractor's default roots read the `.claude/worktrees/`
folder the Claude desktop app creates — a full second checkout of the same
repo — into DiO's and Cascade's records. Local `derive --check` passed; CI,
which has no worktrees, failed. The engine's contract is that the same
source bytes give byte-identical artifacts; a folder that exists only on one
machine is exactly what breaks it.

## Decision

1. **Every walk and every read the engine makes vetoes what git ignores.**
   Asked once per derive with `git ls-files --others --ignored --directory
   --exclude-per-directory=.gitignore`, shared by every extractor's `io`;
   `io.walk` never hands out an ignored path, `io.read` refuses one with the
   code `ignored` (to be treated as absent), and `io.isIgnored` serves the
   extractors that walk on their own.
2. **Only the repository's own rules count** — the `.gitignore` files every
   clone shares. Neither the user's global excludes file nor
   `.git/info/exclude` is read: both are machine state, and a rule on one
   machine must not change what derive sees of the same bytes on another.
3. **`.claude/worktrees/` is vetoed by name, everywhere**, because the one
   machine-local folder that matters is excluded through `info/exclude`, and
   a worktree is never source.
4. **A repository whose ignore set git cannot list stops derive** (no git on
   the PATH, a corrupt index, a timeout) with the reason. Reading on would
   take ignored, possibly secret-bearing files as source while CI stayed
   green. A folder that is no repository at all is simply walked, with the
   worktree veto alone.

## Consequences

- A dirty checkout and a clean clone derive the same artifacts; untracked
  files that are not ignored are still source (a new file on the branch).
- An adopter whose records named an ignored file sees them change on the
  bump; the upgrade note says so.
- `derive` needs git where there is a `.git`; CI runners have it, and the
  preflight checks it at install and upgrade.

## Rejected

- **Parse `.gitignore` in the engine.** A second implementation of git's
  matcher, wrong in the corners (negation, anchors, `**`), to avoid one
  process call per derive.
- **Honour `info/exclude` for the worktree case.** It is machine state;
  the name veto covers the case without it.
- **Warn and carry on when git fails.** Fail-open: the very divergence this
  exists to remove, and a confidentiality risk.
