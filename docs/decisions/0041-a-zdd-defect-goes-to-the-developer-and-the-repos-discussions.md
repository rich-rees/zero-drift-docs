# 0041 — A ZDD defect goes to the developer in plain words, and to the repo's Discussions; Issues are off

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, question 9 of the design session on 2026-10-27 (Rich's call). **Supersedes** the findings home set in the 2.3 process scope: ZDD defects filed as GitHub Issues labelled `finding` / `blocker`, counted at this repo's session start.

## Context

ZDD's instructions told an adopter's agent to file a ZDD defect on this
repo's Issues, labelled `finding`, and this repo's session start counted
them. ZDD's own work is tracked in a task database outside GitHub, so
Issues had become a second thing that looked like a backlog. But an
adopter outside that database still needs a public way to report a defect.

## Decision

1. **The agent tells its developer, in plain words,** what ZDD got wrong
   (as opposed to what is wrong in their repo), and offers a ready-written
   report.
2. **The report goes to the repo's GitHub Discussions,** in a "Bug reports"
   category: a public inbox, not a tracker. The maintainer turns real
   reports into tasks in ZDD's own tracker.
3. **Issues are switched off** on the repo.
4. ZDD's instructions template, the bootstrap and upgrade skills, and the
   rule the upgrade's text pass checks adopter instructions against all say
   this. The session-start findings count and its script are removed.

## Consequences

- Nothing on GitHub looks like ZDD's backlog.
- Discussions has no labels or open/closed state; tracking happens in the
  task database, at the cost of one manual copy per real report.
- The upgrade's text pass flags an adopter's own instruction that still
  sends ZDD defects to Issues (the 0030 rule).

## Rejected

- **Tell the developer only, no public channel.** Nothing to watch, but an
  outside adopter has no way to report.
- **Keep Issues as a public inbox, never as the tracker.** No text change
  and Issues has labels, but two places that look like a backlog.
