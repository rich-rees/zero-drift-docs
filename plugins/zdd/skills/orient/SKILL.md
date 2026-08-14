---
name: orient
description: Load the ZDD artifacts for the area you are about to work in — read the glossary whole, the ADR index whole, the ADRs your task cites, and the agent-index sections for the feature, then read the code fresh. Use before designing or building in a repo that uses Zero-Drift Docs.
---

# zdd:orient — the declared load

> **Scaffold (v0.1).** The procedure below is final; it uses only file reads, so
> it works today without the engine. Nothing here is a stub.

Run this before building or designing in an area. The SessionStart hook has
already injected `zdd/agent-index.md`; this skill does the deeper, task-scoped
read the index can't.

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
   ritual finding to fix (see `/zdd:update`).

## Why this is a skill, not just the hook

The hook keeps every session lightly oriented (the ~2k-token index). The full
load — whole glossary, whole ADR index, cited ADR bodies — is heavier and
task-shaped, so it runs on demand here rather than being forced into every
session's context.
