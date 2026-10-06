# 0014 — A ZDD release pins and brings in one Pocock release

**Date:** 2026-10-06 · **Status:** accepted · **Origin:** CAS-93, from CAS-92 (pinning Cascade's plugins). mattpocock/skills v1.3.0 renamed the root `CONTEXT.md` to `GLOSSARY.md`; six of its skills read that root file by name; ZDD's glossary lives at `zdd/glossary.md`. A plain ZDD adopter who updated Pocock lost the glossary silently: nothing failed, the skills just stopped reading it, and two of them would create a stray root `GLOSSARY.md`.

**Supersedes in part [ADR-0004](0004-pocock-skills-recommended-not-required.md):** the technique stays Matt's and uncopied, and `grill` still self-checks and degrades; what changes is that ZDD now names and installs the release it was tested with, instead of leaving the version to whatever marketplace the adopter happens to have.

## Decision

Three layers, each locking only the one below it:

1. **Pocock stays Matt's plugin**, `mattpocock-skills`, from his repository
   (`mattpocock/skills`), never copied into ZDD.
2. **ZDD names and brings in the exact Pocock release it was tested with.**
   ZDD's own marketplace lists `mattpocock-skills` with a source pinned by
   tag *and* commit (`plugins/zdd/pocock.json` is the record; a test pins it
   to the marketplace entry and the manifest), and the `zdd` plugin declares
   it as a dependency in the same marketplace. Installing `zdd@zero-drift-docs`
   installs `mattpocock-skills@zero-drift-docs` beside it.
3. **A harness repo (Cascade, DiO) locks only ZDD** and keeps calling
   `mattpocock-skills:<skill>` by the same names.

Taking a Pocock release means a ZDD release, tested against it; skipping one
means doing nothing.

Because Claude Code loads two enabled plugins of one name as **one**, silently,
and the experiment showed the *other* copy winning (the user-scope
official-marketplace copy loaded; the dependency's did not), `bootstrap` and
`--upgrade` switch the other known copies off in the repo's committed
`.claude/settings.json` (`mattpocock-skills@mattpocock` and
`mattpocock-skills@claude-plugins-official` set `false`; ZDD's pair set `true`),
never a user or local file, never an uninstall. `load`'s step 0 and the
session-start hook warn when any other copy is still switched on for the repo,
naming both versions, where it is switched on, and the one-line fix.

## What the experiment established (2026-10-06, Claude Code 2.1.289)

- Two enabled marketplace copies of `mattpocock-skills`: the skills of one
  copy load, the other's are dropped with no message anywhere but the debug
  log. In the trial the user-scope copy won over the project-scope one.
- A dependency named in `plugin.json` is resolved in the declaring plugin's
  own marketplace; an installed, enabled copy from another marketplace does
  not satisfy it, so a second copy is installed.
- A dependency set `false` in `enabledPlugins` stops the dependent plugin
  loading, loudly: `claude plugin list` shows the error and the Skill tool
  names the unmet dependency.
- A `github` plugin source clones over SSH on this machine and failed; the
  `url` form over https (the official marketplace's own form) works, with
  `sha` honoured.

## Why / rejected alternatives

- **Keep recommending, let adopters pick the version** (ADR-0004 as it was).
  That is what broke: the breaking change arrived as a silent no-op, in the
  one half of ZDD no check can see. Rejected.
- **A version range on the dependency.** Ranges resolve only against tags
  named `<plugin>--v<version>`; Matt tags `vX.Y.Z`. Rejected until upstream
  tags that way, and even then a range re-opens the door this closes.
- **Depend on `mattpocock-skills@mattpocock` or `@claude-plugins-official`.**
  Cross-marketplace dependencies need an allowlist and still track whatever
  that marketplace serves. Rejected.
- **Vendor the skills.** Still rejected, for ADR-0004's reasons.
- **Uninstall the other copies.** They work in the adopter's other repos;
  per-repo settings are the right scope, and they are reversible. Rejected.

## Consequences

- ZDD's release checklist gains one line: the Pocock tag, commit and version
  in `pocock.json` and the marketplace entry move together, after the suite
  and the smoke run against that release.
- An adopter's `.claude/settings.json` becomes a bootstrap-written file (a
  key-level merge; every other key is kept). It is Claude Code's file; Codex
  ignores it, and Codex has no dependency mechanism, so a Codex adopter
  installs Pocock by hand as before.
- A project-settings `true` never installs anything on a collaborator's
  machine; they still run the one install. The `false` lines, however, apply
  to everyone who clones.
- `docs/agents/domain.md` (written by bootstrap when absent) is what makes the
  pinned release read `zdd/glossary.md` at all; the pin makes sure the release
  that reads it is the one ZDD tested.
