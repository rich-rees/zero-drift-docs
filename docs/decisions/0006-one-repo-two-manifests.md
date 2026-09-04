# 0006 — One repo, two manifests: Claude Code and Codex share the skills and the hooks

**Date:** 2026-09-03 · **Status:** accepted; point 3's block signal superseded by [0007](0007-fence-blocks-with-the-json-deny-reply.md) (exit 2 fails open in Codex — the fence now replies with the JSON deny shape); point 1 amended in practice: the Claude manifest carries no `hooks` key because Claude Code auto-loads `hooks/hooks.json` and refuses a manifest that names it again, while Codex needs the explicit entry — one file, two ways of reaching it (DIO-312 smoke test) · **Origin:** DIO-307 grilling, built under DIO-311.

## Context

v0.3.1 was Claude-Code-only: a `.claude-plugin/plugin.json`, skills under `skills/`, and a `hooks/hooks.json` whose scripts are reached via `${CLAUDE_PLUGIN_ROOT}`. The spec asks for the same plugin to install in Codex with two commands, from one repo, so ZDD is "two verbs any coding agent can run" rather than a Claude feature. Codex's plugin loader reads a `.codex-plugin/plugin.json`, reads a `.claude-plugin/marketplace.json` as a legacy-compatible marketplace, and sets `CLAUDE_PLUGIN_ROOT` for hooks — in source it also falls back to the Claude manifest, but that is observed behaviour, not a promise.

## Decision

1. **One repo, two manifests, one body.** `plugins/zdd/.claude-plugin/plugin.json` and `plugins/zdd/.codex-plugin/plugin.json` sit side by side and point at the *same* `./skills` and `./hooks/hooks.json`. Nothing is duplicated below the manifests: a skill is one `SKILL.md`, a hook is one script. Both manifests and the marketplace entry carry the same version, and a test pins all three together.
2. **`hooks.json` reaches its scripts through `${CLAUDE_PLUGIN_ROOT}` only** — no absolute paths, no home-relative paths, nothing host-specific. Both hosts set that variable, so the one file serves both; a test refuses any other path shape.
3. **The hook scripts are host-neutral Node with no engine dependency.** They read stdin JSON, the adopter's `zdd/config.json`, and files; they signal a block by exit code 2 and a reason on stderr — the one convention every host honours — and never depend on a host-specific JSON reply. The pre-push hook is `#!/bin/sh` calling `npx`, because it runs under git, not under either agent.
4. **The instruction block is tool-neutral and goes into both `CLAUDE.md` and `AGENTS.md`.** It leads with the spoken verbs and names skills by bare name (`load`, `update`), never by a host's slash syntax. `AGENTS.md` is written only when the adopter says they use Codex — an unread file in a Claude-only repo is noise.
5. **The Codex-side assumptions are recorded, not hidden.** If Codex stops setting `CLAUDE_PLUGIN_ROOT` or stops reading the Claude marketplace file, this decision is superseded by per-host hook and marketplace files; the skills and scripts do not change.

## Consequences

- Adding a skill or a hook is one change, live in both hosts. Adding a host-specific behaviour means a second file, and should be resisted until a host actually diverges.
- `grill`'s self-check looks in Codex's skill location too (`~/.codex/skills/`), so the "installed anywhere" rule holds across hosts even though the Pocock skills are Claude-marketplace-only today (decision 0004).
- The live smoke test before 1.0 (DIO-312) runs the plugin in both hosts against `rich-rees/zdd-smoke-test`; this decision is only proven when both pass.

## Rejected

- **Two plugins, one per host** — two version lines, two copies of every skill, and the drift ZDD exists to prevent, inside the tool itself.
- **Ship only the Claude manifest and rely on Codex's fallback** — a fallback observed in source is one refactor from gone; the second manifest costs one file.
- **Host-specific hook reply formats** (the JSON `permissionDecision` shape) — richer, but not portable; exit 2 + stderr blocks everywhere.
