# 0050 — The catalogue is one per machine: the route re-points it

**Date:** 2026-11-04 · **Status:** accepted · **Origin:** 0.14.1, from a
repo's move from 0.11.0 to 0.14.0. Supersedes the restart in
[0022](0022-the-pin-move-route-removes-a-stray-declaration-first.md)'s route;
its stray-declaration step stands.

## What happened

The release check's route was 0022's: remove a stray declaration, restart
(the catalogue follows the repo's lock), `claude plugin update` each
plugin, restart again. On one machine, twice, a restart did **not** move
the catalogue: another repo on the machine had set it at `v0.13.0`, the
moving repo locked `v0.14.0`, and after the restart
`~/.claude/plugins/known_marketplaces.json` still named `v0.13.0`, the
clone never fetched the new tag, and `plugin update` said "already at the
latest version". What worked was `claude plugin marketplace add
"rich-rees/zero-drift-docs#v0.14.0" --scope project`, the two updates, one
restart — but that add rewrote `.claude/settings.json` and dropped
`"autoUpdate": false` from the lock.

Checked on Claude Code 2.1.312 (a throwaway folder, the tag the catalogue
already held, so nothing moved): `#<tag>` and `@<tag>` both name the ref;
`--scope project` writes the project's declaration and nothing at user
scope; the rewritten declaration has no `autoUpdate`. 0022's profile D
shows a restart *can* move the catalogue (one repo moving its own lock), so
the observed rule is narrower than "never": a catalogue another repo set at
a different tag stays where it is.

## Decision

1. **The catalogue is one per machine, shared by every repo on it**, and
   the release check says so whenever it is not at the lock. A teammate
   with two repos on different ZDD releases moves it each time they switch.
2. **Whenever the catalogue is not at the lock, the route re-points it**:
   (remove a stray declaration by its scope, 0022) → `claude plugin
   marketplace add "rich-rees/zero-drift-docs#<lock>" --scope project` →
   `node "<this plugin>/scripts/bootstrap.mjs" relock` → `claude plugin
   update` (or `install`) each plugin `--scope project` → one restart.
   The same route on a machine that never fetched the catalogue.
3. **`bootstrap.mjs relock`** puts the lock back as ZDD writes it:
   `"autoUpdate": false`, the ref and every other key as they are, CRLF
   kept. It never locks a repo, moves a ref, or touches a declaration that
   is not ours or a file it cannot read. It runs right after the add, from
   the bootstrap beside the running check, which the updates leave in
   place until the restart.
4. **The upgrade's `next:` note names the route itself** for the tag it
   moved to, in a plan too, instead of "restart and run what the next
   session's first line names, then restart again"; `release-status` says
   the same. Under Codex the note still says restart.

## Why / rejected alternatives

- **Detect only "another repo set it" and keep the restart otherwise.** The
  machine records no owner for its catalogue, so the case cannot be told
  apart from 0022's profile D; the add works in both, and saves a restart.
- **`marketplace remove`, then a restart.** Removing the marketplace
  uninstalls its plugins for every repo on the machine.
- **The session-start hook restores `autoUpdate` itself.** The check is
  read-only by design (CR-354); bootstrap is the writer of adopter-owned
  files (0003, 0024), so the route names a bootstrap command.
- **Leave `autoUpdate` dropped.** A lock is only a lock with auto-update off
  (CR-006): a release moves only by a PR.

## Consequences

- One restart in the route instead of two; the line is one step longer.
- The add rewrites the tracked `.claude/settings.json`; `relock` returns
  it to ZDD's bytes when the add kept everything else (2.1.312 does).
- A new subcommand, no config-schema or metadata-contract change: a patch.
