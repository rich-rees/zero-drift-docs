# 0004 — Matt Pocock's skills are recommended, never required

**Date:** 2026-09-03 · **Status:** accepted · **Origin:** DIO-307 grilling, recorded under DIO-311 (the `grill` wrapper itself dates from v0.3).

## Context

ZDD *captures* decisions; it does not produce them. The curated half — glossary, ADRs — is only as good as the design sessions that fill it, and the sharpest way we know to drive decisions out is Matt Pocock's `grilling` + `domain-modeling` skills (`mattpocock-skills`, a Claude Code marketplace plugin). Those skills default to a root `CONTEXT.md` and `docs/adr/`, which are not ZDD's homes. Two questions followed: should ZDD depend on them, and should ZDD carry its own copy of the technique?

## Decision

1. **ZDD stands alone.** The skills carry a compact authoring discipline of their own (`skills/authoring.md`: the ADR three-way test, the glossary and ADR formats, capture-at-crystallization), so `update` and `bootstrap` write decent artifacts from plan-mode work or plain thinking with nothing else installed.
2. **`grill` is a thin adapter over the real thing, and it self-checks.** It runs `mattpocock-skills:grilling` with `domain-modeling`, redirecting the output to `zdd/glossary.md` and `zdd/adr/`. Before anything else it looks for `domain-modeling/SKILL.md` in every install location (plugin cache, user skills, project skills, Codex skills) and, if it is absent, stops with a message that names the plugin, the install route, and the alternative (plan mode + "update ZDD"). **It never improvises a substitute interview** — a hand-rolled grilling would be a worse copy of the technique wearing its name.
3. **`bootstrap` recommends in plain words and continues.** The runbook's recommendation step says: your artifacts will be as good as the sessions that fill them; `grill` needs this plugin; here is how to install it; without it ZDD works. Then it carries on. Recommended, visible, never a block.

## Consequences

- The plugin ships none of Pocock's text. `authoring.md` is a distillation credited to him, small enough to stand alone, and it is the same reference `update`, `bootstrap` and `grill` all read — so grilled docs and finish-ritual docs come out in one format.
- The recommendation is Claude-Code-shaped today (the install route is a Claude Code marketplace command) because the skills are Claude-Code-marketplace-only. If they gain a Codex route, the recommendation names it; nothing else changes.
- A future where `grill` degrades silently (says nothing, does nothing) would be a regression: the self-check's message *is* the feature.

## Rejected

- **Hard dependency on `mattpocock-skills`** — a documentation tool that refuses to run without a design-interview plugin is a design-interview plugin with extra steps; and it would exclude Codex adopters outright.
- **Vendor the grilling technique into ZDD** — a fork that drifts from upstream, carrying someone else's work under a different name, for the sake of removing an install step.
- **Ship no authoring guidance at all and point at Pocock** — then ZDD without the plugin writes bad ADRs, and "recommended" becomes "required" in practice.
