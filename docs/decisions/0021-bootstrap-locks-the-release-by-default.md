# 0021 — Bootstrap locks the repo to one ZDD release by default

**Date:** 2026-10-08 · **Status:** accepted; supersedes in part [0003](0003-kernel-and-opt-ins.md) point 4's "never writes into `.claude/settings.json`" (with 0014) · **Origin:** CAS-101, from CAS-99. The session-start release check (2.1.0, CAS-97) compares this machine's catalogue and installs against a lock — `.claude/settings.json` → `extraKnownMarketplaces["zero-drift-docs"].source.ref` — that nothing in the plugin wrote. Cascade and PressPlay had it only because it was typed in by hand (CAS-92, DIO-326), so for every other adopter the check was silent forever, and teammates could run different releases without anyone knowing.

## Decision

`bootstrap` writes the lock, and `--upgrade` keeps it:

1. **Adoption writes it by default.** Beside the `enabledPlugins` lines (the
   same key-level merge into the adopter's `.claude/settings.json`: every
   other key and its order kept), bootstrap declares the marketplace pinned
   to this release's tag with auto-update off:
   `"zero-drift-docs": { "source": { "source": "github", "repo": "rich-rees/zero-drift-docs", "ref": "vX.Y.Z" }, "autoUpdate": false }`.
2. **A lock is ours when its source is this marketplace's repository.** An
   upgrade moves an ours lock's ref to the running release and says so. A
   declaration pointing anywhere else (a fork, a local path, a mirror) is the
   adopter's: named, never rewritten.
3. **An upgrade on a repo with no lock** names the gap and writes the lock
   only on the user's word (`--lock`), never silently: an existing team may
   be relying on floating installs.

Moving to a new release is therefore a deliberate PR that changes one ref,
and the release check announces it to every other developer at their next
session start.

## Why / rejected alternatives

- **No lock (float).** Each machine takes what it last fetched; teammates
  silently run different releases and the generated artifacts can differ
  between machines. Cascade's history (CAS-92, CAS-98) is this failure, and
  the release check has nothing to compare against.
- **Ask during bootstrap, defaulting to lock.** One more question for every
  adopter, about a choice few can judge on day one, for an outcome the
  release check, the guided upgrade and the joiner path all depend on.

## Consequences

- Fixes never arrive by themselves: an adopter takes them by an upgrade
  ("upgrade ZDD"), which is why the upgrade is a guided flow
  ([0022](0022-the-pin-move-route-removes-a-stray-declaration-first.md)
  settles the route each developer runs after it merges).
- A test binds the writer to the reader: a freshly bootstrapped repo's lock
  is the one `check-release` reads — silent at a matching install, loud at a
  stale one.
- The lock is Claude Code's settings; Codex ignores it, and its install is
  moved by hand as before.
