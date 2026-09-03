---
name: grill
description: A relentless design interview that drives out the decisions behind a feature AND writes them down — glossary terms and ADRs — into this repo's zdd/ folder. Wraps Matt Pocock's grilling + domain-modeling skills; requires the mattpocock-skills plugin (self-checks and degrades gracefully if it's absent). Use before building, when you want to sharpen and record a design.
---

# zdd:grill — drive out decisions, land them in zdd/

A design interview that produces the curated half of ZDD as it goes. This skill is
a thin **adapter**: the interview technique is Matt Pocock's, and ZDD carries none
of it. All this wrapper does is (1) check that technique is installed and (2)
redirect where it writes — into `zdd/`, not the upstream defaults.

## Step 0 — precondition check (do this first, always)

This skill runs `mattpocock-skills:grilling` + `mattpocock-skills:domain-modeling`.
Confirm they're installed before anything else. Claude Code loads skills from more
than one place, so **check all of them — a hit in any one is enough** (the
`domain-modeling` skill is the one that must be present; it's the writer):

```
# 1. Plugin install (the usual route). Cached in your HOME dir regardless of
#    whether the plugin is enabled globally or per-project — so global-vs-local
#    enablement doesn't change this path.
~/.claude/plugins/cache/*/mattpocock-skills/*/skills/*/domain-modeling/SKILL.md

# 2. User-scoped skill (pre-plugin / manual install).
~/.claude/skills/domain-modeling/SKILL.md

# 3. Project-scoped skill (vendored into this repo — note this one is
#    whatever the repo's last commit put there; say so when it is the hit).
<repo>/.claude/skills/domain-modeling/SKILL.md

# 4. Codex user skill.
~/.codex/skills/domain-modeling/SKILL.md
```

- **Found in any location** → continue to Step 1.
- **Found nowhere** → stop and tell the user, then do nothing else:
  > `zdd:grill` needs the **mattpocock-skills** plugin, which isn't installed.
  > Two ways forward: install it (`/plugin marketplace add …` then
  > `/plugin install mattpocock-skills@…`) and re-run me — or skip grilling
  > entirely: work the decisions out in plan mode, then "update ZDD". ZDD
  > works fine without grilling; `update` carries the same authoring
  > discipline (see [authoring.md](../authoring.md)).

  **Never improvise a substitute interview** — a hand-rolled grilling breaks the
  point of wrapping the real one.

## Step 1 — load before the first question

Run `load` ("load ZDD") first (or at minimum read `zdd/glossary.md` whole and the ADRs
cited by the agent-index sections you're about to touch). Grilling on top of an
unread glossary produces questions the stores already answer.

## Step 2 — grill, with the paths pinned to zdd/

Run `mattpocock-skills:grilling` using `mattpocock-skills:domain-modeling`, with
these overrides — Pocock defaults to a root `CONTEXT.md` + `docs/adr/`, and ZDD's
homes are different:

- The glossary is **`zdd/glossary.md`** — never a root `CONTEXT.md`. If a
  `CONTEXT.md` appears, its content belongs in `zdd/glossary.md`.
- ADRs live in **`zdd/adr/`** — never `docs/adr/`. Number them `NNNN-*.md`,
  continuing the existing sequence.
- Supersession is linted (`zdd-engine lint`): a new ADR that supersedes another
  must stamp the old one `Superseded [in part] by ADR-NNNN`, both directions.

The authoring discipline — when a decision is ADR-worthy, and the glossary/ADR
formats — is in [authoring.md](../authoring.md), the *same* reference `update`
uses, so grilled docs and PR-finish docs come out identical.

## After

The decisions now live in `zdd/`. Build the feature, then "update ZDD" at
the finish to capture anything else and regenerate the indexes.
