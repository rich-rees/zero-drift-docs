---
name: load
description: "load ZDD" — the declared load. Read the glossary whole, the ADR index whole, the ADRs your task cites, and the agent-index sections for the feature, say what you loaded, then read the code fresh. First checks the adopter's engine pin against the plugin and warns on skew. Use before designing or building in a repo that uses Zero-Drift Docs; triggers on "load ZDD".
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

## Steps

1. **Read `zdd/glossary.md` whole.** A grep is never orientation — the whole
   vocabulary is small and cheap, and the point is to start with the right words.
2. **Read `zdd/adr-index.md` whole.** One line per decision; this is the map of
   what has been decided and what supersedes what.
3. **Drill into the ADR bodies your task cites** — plus the glossary entries for
   the prompt's terms, and the agent-index sections for the feature you're
   touching.
4. **Declare your selection aloud.** State what you loaded and why, e.g.
   *"Loading ZDD: glossary + ADR index + ADR-0007/0009 — cited by the task."* A
   wrong selection is then visible immediately.
5. **Read the code fresh.** The artifacts orient you; they never replace reading
   the source. Where prose and code disagree, the code wins — and the prose is a
   ritual finding to fix (see `update`).

## Why this is a skill, not just the hook

The hook keeps every session lightly oriented (the ~2k-token index). The full
load — whole glossary, whole ADR index, cited ADR bodies — is heavier and
task-shaped, so it runs on demand here rather than being forced into every
session's context. Both work with any coding agent: the skill is a convenience,
the reading is the contract.
