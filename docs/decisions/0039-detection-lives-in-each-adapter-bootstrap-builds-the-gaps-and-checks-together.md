# 0039 — Detection lives in each adapter; bootstrap builds the gaps and checks the map together

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, questions 4–6 of the design session on 2026-10-27 (Rich's calls).

## Context

Detection was one probe per extractor inside `bootstrap.mjs`, so the plugin
named every stack and a new adapter meant editing bootstrap. Bootstrap also
could not say which part of a repo nothing covered, and the check after
bootstrap was the developer looking at the human index. Missing edges are
what eyes miss: one adopter's routes looked complete for weeks while none
of them linked to a table.

## Decision

1. **Each adapter carries its own detection.** It answers "do I fit this
   repo?" with plain-words evidence ("14 `@router.get` decorators in
   `app/routes/`"), the options it would use, and the **job** it covers,
   from a stack-free list the core owns: routes, screens, components,
   database access, background tasks, external services. Detection reads through `io`,
   under the same caps.
2. **Bootstrap matches part by part.** It asks every catalogue adapter,
   collects the answers, and names what is covered and what is not.
   The ready-made list it reads out comes from the catalogue, never from
   text in the core. Its voice:
   - a missing part: "Your routes are FastAPI, and I have an adapter for
     that. Your database layer is Prisma, and I don't yet, so I'll build a
     `prisma` adapter with you. That takes a bit longer, and we'll test it
     together."
   - an adapter that almost fits: "I'll copy the `fastapi` adapter and
     change it to understand your decorator" (0036 point 5).
   Uncovered parts are built through the `extractor` skill, with fixtures
   and tests.
3. **Brownfield: check together.** After adapters are attached or built:
   1. an automated coverage report, with counts per job and the unlinked
      items named ("42 routes; 31 link to tables; 11 link to nothing:
      `/health`, …"); the developer says which gaps are fine and which are
      wrong;
   2. then the human index opened with "does this all look right, and is
      any link missing?".
   Every "that's wrong" becomes a fixture test in the adapter before it is
   fixed.
4. **Greenfield: a preview now, the check when code appears.** Bootstrap
   renders the chosen adapters' own fixtures into a temporary human index
   outside the adopter's repo, to show what a map will look like. The first
   time derive finds real routes, screens, tables or background tasks, the next session runs
   the brownfield check once. `zdd/` remembers that it is owed until it is
   done.
5. **ZDD never writes throwaway code into the adopter's repo** to test
   itself.
6. **A greenfield repo with no stack chosen** is offered the neutral list of
   stacks that have catalogue adapters, with no vendor recommendation.

## Consequences

- Adding a stack is adding one folder; bootstrap is not edited.
- About 300 lines of probe code move from `bootstrap.mjs` into the
  adapters, and bootstrap's detection tests move with them.
- Bootstrap takes longer on a brownfield repo (a coverage pass and a few
  questions). That is the price of naming gaps instead of hoping someone
  spots them.

## Rejected

- **Detection stays in bootstrap, as one table of probes.** Less work now,
  but the plugin names every stack forever.
- **Open the human index and ask "does it look right?" only.** Catches wrong
  boxes, rarely missing arrows.
- **A warn-only coverage line on every CI derive.** It flags a new gap on
  its branch, but routes that legitimately touch no table would need marking
  somewhere, or the warning becomes noise.
- **A temporary CRUD page for greenfield**, written, checked and deleted at
  bootstrap. It tests ZDD's code instead of the adopter's, and writes into
  their repo.
