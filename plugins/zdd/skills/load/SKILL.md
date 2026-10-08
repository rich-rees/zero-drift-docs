---
name: load
description: "\"load ZDD\" — the declared load. Read the glossary whole, the ADR index whole, the ADRs your task cites, and the agent-index sections for the feature, say what you loaded, then read the code fresh, and point at the next step (choose patterns). First checks the adopter's engine pin against the plugin and warns on skew. Use before designing or building in a repo that uses Zero-Drift Docs; triggers on \"load ZDD\"."
---

# zdd:load — the declared load

Run this before building or designing in an area — the spoken form is
**"load ZDD"**. The SessionStart hook has already injected `zdd/agent-index.md`
(if the repo opted in); this skill does the deeper, task-scoped read the index
can't.

## Step 0 — engine skew (always first)

```
node "$PLUGIN/scripts/check-skew.mjs"
```

`$PLUGIN` is this plugin's root — two directories up from this SKILL.md. Set
it from the directory you read this file from, `<skill-dir>`:
POSIX `PLUGIN="$(cd "<skill-dir>/../.." && pwd)"`, PowerShell
`$PLUGIN = (Resolve-Path "<skill-dir>\..\..").Path`. (`$CLAUDE_PLUGIN_ROOT` /
`$env:CLAUDE_PLUGIN_ROOT` holds the same directory when the host sets it.)

It compares the plugin's version with every engine pin in the repo
(`zdd/config.json` `engine`, the CI workflow, the pre-push hook). If a pin is
behind, **its one line is the first line of your reply** — it names
`bootstrap --upgrade`, which rewrites every pin. Silent when they match; do not
mention it then.

Then, the same way:

```
node "$PLUGIN/scripts/check-pocock.mjs"
```

ZDD brings in one pinned release of Matt Pocock's skills
(`mattpocock-skills@zero-drift-docs`), and Claude Code loads two enabled copies
of that plugin name as **one**, silently — the other copy can win. This prints
one line when another copy is switched on for this repo (a user or local
settings file, a marketplace bootstrap did not know), naming both versions,
where it is switched on, and the one-line fix (set it `false` in this repo's
`.claude/settings.json`; never uninstall). **Relay it verbatim as the next line
of your reply.** Silent when only ZDD's copy is on; do not mention it then.

Then, the same way:

```
node "$PLUGIN/scripts/check-release.mjs"
```

A repo locks one ZDD release (`.claude/settings.json` →
`extraKnownMarketplaces.zero-drift-docs.source.ref`), and nothing updates
itself: when a PR moves the lock, this machine keeps running the old release
until the catalogue and the install are refreshed. This prints one line when
the catalogue, `zdd@zero-drift-docs` or `mattpocock-skills@zero-drift-docs`
installed for this project differs from the lock, naming expected and found
and the route that moves the machine: restart Claude Code, `claude plugin
update`, restart again. **Relay it verbatim as the
next line of your reply.** Silent when they match or the repo locks nothing;
do not mention it then. (The session-start hook prints the same line.)

## Steps

The paths below are the defaults. The repo's `zdd/config.json` may move any of
them under `paths.*` — `paths.glossary`, `paths.adrIndex`, `paths.adrDir`,
`paths.agentIndex` — so read that block first when it exists and use what it
names; the `zdd/…` names apply only where a key is absent.

1. **Read the glossary whole** (`paths.glossary`, default `zdd/glossary.md`). A
   grep is never orientation — the whole vocabulary is small and cheap, and the
   point is to start with the right words.
2. **Read the ADR index whole** (`paths.adrIndex`, default `zdd/adr-index.md`).
   One line per decision; this is the map of what has been decided and what
   supersedes what.
3. **Drill into the ADR bodies your task cites** — plus the glossary entries for
   the prompt's terms, and the agent-index sections for the feature you're
   touching.
4. **Declare your selection aloud.** State what you loaded and why, e.g.
   *"Loading ZDD: glossary + ADR index + ADR-0007/0009 — cited by the task."* A
   wrong selection is then visible immediately.
5. **Read the code fresh.** The artifacts orient you; they never replace reading
   the source. Where prose and code disagree, the code wins — and the prose is a
   ritual finding to fix (see `update`).
6. **End with the next step, in one line:** *"Next: once the design is settled,
   and before any code, choose patterns."* That is the `patterns` skill — it
   reads the blessing index (`paths.blessingIndex`, default
   `zdd/blessing-index.md`) against the design and commits a pattern plan.
   Do not run it now unless the design is already settled.

## Why this is a skill, not just the hook

The hook keeps every session lightly oriented (the ~2k-token index). The full
load — whole glossary, whole ADR index, cited ADR bodies — is heavier and
task-shaped, so it runs on demand here rather than being forced into every
session's context. Both work with any coding agent: the skill is a convenience,
the reading is the contract.
