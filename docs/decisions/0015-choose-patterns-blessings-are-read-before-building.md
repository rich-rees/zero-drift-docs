# 0015 — "Choose patterns": blessings are read before building, proposed in a plan, minted at update

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-96, from a design discussion on 2026-10-08. Verified against plugin 1.3.1: ZDD wrote and linted blessings carefully on every update (Cascade had 37 and re-blessed on nearly every task), but nothing read them before a build. `load` read the glossary, the ADR index, the cited ADRs and the agent-index sections; the agent index rendered no blessings, and its reading path went from task to feature section to pointers to code, past the map page. A session found a blessing by luck. **Supersedes, in part:** [0003](0003-kernel-and-opt-ins.md) point 1 ("the kernel is two spoken verbs"). The kernel is now three verbs; the rest of point 1 stands.

## Context

A blessing names the exemplar to copy and the pattern to refuse, so that the
map outranks "copy the nearest example". The most common pattern in a codebase
is often the deprecated one. A blessing does this only if it is read *before*
the code is written, at a point where the design is known. The write side
existed (`update` curates blessings, lint fails one citing a superseded ADR,
the Stop hook asks about them). The read side did not, and a session left to
find a blessing by itself duplicated logic it never knew existed.

## Decision

1. **The fix is in the plugin, not in an adopter's instructions.** ZDD is
   self-contained; an adopter gets the step by having the plugin.
2. **A third spoken verb, "choose patterns" (skill `patterns`),** listed in
   the managed `CLAUDE.md` / `AGENTS.md` block beside load and update.
   "Choose", not "seek": the output is a committed, reasoned choice, and "no
   blessing applies" is a choice too.
3. **When:** once the design is settled and before any code is written for a
   unit of work. It needs both inputs: ZDD loaded (what exists) and the design
   (what we want). On a path that splits work into tickets, it runs per ticket
   when that ticket's build starts; a spec may name likely blessings as a
   hint, and only the ticket's own step binds. `load` ends with one line
   pointing at it.
4. **The output is a pattern plan:** for each piece of planned work, exactly
   one of *follow \<blessing\> because …*, *depart from \<blessing\> because …*,
   *no blessing applies*, or *new pattern, candidate blessing because …*. It
   also names any **unblessed precedent** the session means to copy, and any
   existing function to **reuse**: blessings cover how to build X, and "this
   already exists" is the inventory's job, so the step consults the agent
   index and the metadata as well as the blessings.
5. **A generated blessing index**, `zdd/blessing-index.md`
   (`paths.blessingIndex`): one line per blessing, its trigger question and
   its reason, grouped by slice with app-level (Application / Package) slices
   first. It is written by `render`, fenced like the other generated
   artifacts, and checked by `render --check`. The step reads it whole and
   opens only matching blessings in full, and every app-level blessing for an
   app the work touches. Measured on Cascade: 37 blessings are about 3.5k
   tokens in full (about 95 each). An index line is about 15 tokens, so it
   stays loadable whole at about 1,000 blessings, where reading every
   blessing in full would not.
6. **The plan is a committed working file on the branch,**
   `zdd/patterns-plan.md` (`paths.patternsPlan`), so it crosses sessions and
   machines. A change of mind during the build is an edit to it, with its
   reason.
7. **Propose at plan, decide at update, against the code as it will merge.**
   The build can kill, change or create a pattern. `update` reconciles the
   plan against the final diff: it mints the blessings that survived (with
   the exemplar linked and a reason given), records dropped candidates with
   why, and offers unblessed precedent as candidates, which are minted only
   on the developer's word. It writes the reconciled record into the update
   commit's message and deletes the plan file in that commit. The plan is
   never deleted at merge, because a merge runs no code and would land the
   file on the base branch. `lint --merge`, the CI step, **fails while the
   file exists**. A later update on the same branch reads the plan and the
   first record from git history and writes an amended record.
8. **Blessing shape and lint.**
   - A blessing must open with its **trigger question**: its first sentence
     ends in `?`, within 200 characters. Without one it **fails** lint: it
     cannot be indexed, so it is invisible.
   - A **reason** is an ADR citation or an inline "because …". A blessing
     with neither gets a **warning**.
   - An **ADR is encouraged, not required**. Cite one when the pattern passes
     the three-part test. House conventions often do not, and forcing an ADR
     breeds throwaway ones or loose citations.
   - **Length** over **300** visible characters (link text counts, link
     targets do not) is a **warning**. The authoring guide says the detail
     belongs in the ADR.

## Consequences

- **Engine and plugin 2.0.0.** After 1.0, a new mandatory generated artifact
  is a major ([0002](0002-graph-artifact-and-viewers.md)). So is a new hard
  lint failure: an adopter whose blessings do not open with a question goes
  red on the first lint after upgrading.
- **Two lint modes for the plan.** CI runs `lint --merge`, which fails while
  the plan exists. A plain `lint` (local runs, the pre-push hook) only warns,
  so the branch stays pushable while the build runs. The CI is red for the
  length of the build, by design, just like a TEMPSTATE rule.
- **`bootstrap --upgrade`** adds `--merge` to an owned workflow's bare lint
  step (it re-pins a workflow and never rewrites one). It names a workflow of
  any other shape for a hand edit, and tells the adopter to render the new
  index and run lint. Blessings without a question are **reported, never
  rewritten**: the engine's lint is the one parser, and the skill shows its
  list to the developer.
- **Measuring the length budget.** 300 was chosen against Cascade's map as of
  this decision: median 356, 27 of 37 over budget. It is a nudge to move
  detail into ADRs, not a gate. All 37 open with a question the parser
  accepts.
- **The trigger-question parser.** The question is the text up to the first
  `?` followed by whitespace or the end, with links reduced to their text, so
  a `?` inside a URL is not one. It is rejected when a period or `!` followed
  by a capital letter comes first (a first sentence that is not a question),
  or when it runs over 200 characters. A `;` or `:` inside the question is
  fine: Cascade writes "(an email now; Salesforce, Gladys or a carrier
  later)?".
- **The Stop hook** counts the blessing index as a ZDD change and does not
  count the plan. A branch whose only `zdd/` change is its plan has not run
  update.
- **The agent index's reading path** names the blessing index, so a session
  that only has the injected index still learns where the patterns are.
- A host harness may carry the plan and the record further, for example a
  build manifest that states the plan and a build summary that reports it.
  ZDD relies only on the plan file and the commit message.

## Rejected

- **Putting the step in an adopter's `CLAUDE.md`.** Each adopter would write
  its own version and drift from the others. The step belongs with the
  artifact it reads.
- **Rendering blessings into the agent index.** It is injected into every
  session under a ~2k-token budget, and blessings would crowd out the
  feature sections. Blessings are needed at one moment, not in every
  session.
- **Reading every blessing in full at the step.** That fits 37 blessings and
  not 1,000. The index keeps the step's cost flat, and app-level blessings,
  which always apply, are still read whole.
- **Minting blessings at plan time.** The plan is a guess made before the
  code exists. CAS-69's campaign created a pattern (job templates) that no
  plan foresaw, so update decides against the code that merges.
- **Deleting the plan at merge** (a host merge hook, a CI cleanup commit). A
  merge runs no code here, and a cleanup commit on the base branch is a write
  ZDD has no business making.
- **Failing the plan's presence in every lint.** It blocks the pre-push hook,
  so a branch with a plan cannot be pushed mid-build and the plan cannot
  cross machines, which is the reason it is committed at all.
- **Requiring an ADR for every blessing.** House conventions rarely pass the
  three-part test, and forcing an ADR breeds throwaway ADRs or loose
  citations of unrelated ones.
- **Auto-rewriting question-less blessings on upgrade.** A trigger question
  is judgment: it is the moment someone reaches for the pattern. A script
  that guesses it would make every blessing findable by the wrong question.
