---
name: update
description: "\"update ZDD\" — the Zero-Drift Docs finish ritual. Curate the changed artifacts (glossary, ADRs, code comments, semantic map), reconcile the branch's pattern plan (mint the blessings that survived, record the rest in the commit message, delete the plan), regenerate the codebase metadata and the indexes, and commit everything in the PR so docs and code merge atomically. Use before finishing any unit of work (a PR is one instantiation) in a repo that uses ZDD; triggers on \"update ZDD\"."
---

# zdd:update — the finish ritual

Run this as the definition of done for every unit of work — the spoken form is
**"update ZDD"**; a PR is the usual unit — in the session that did the work — it holds maximal context, and capturing at that moment is the whole trick.

## Steps

1. **Diff → curated artifacts.** Walk the diff and update, at the site — follow
   the discipline in [authoring.md](../authoring.md) (glossary/ADR formats, the
   ADR-worthiness three-test, supersession both ways):
   - **Glossary** — new or sharpened vocabulary.
   - **ADRs** — decisions crystallised (written when decided, not after merge);
     offer them only when hard-to-reverse *and* surprising *and* a real trade-off.
   - **Code comments** — new non-obvious constraints, at the code site. A gotcha
     spanning multiple sites becomes an ADR instead.
   - **Semantic map** — feature / edge / blessing changes. **A unit of work
     that adds or changes user-facing behaviour adds a feature slice or
     extends one** (`zdd/map/features/<feature>.md`): the slice claims the
     routes, tables, functions and surfaces it owns by linking them. The
     lint's *unclaimed* list (step 4) is the checklist — every record on it
     is one no slice has placed yet. A blessing names the exemplar to copy
     and cites its ADR; if a decision was fully superseded in this unit of
     work, re-bless or drop every blessing that cited it (the lint fails
     otherwise; a partial supersession only warns). Blessings this unit of
     work proposed are decided in step 2.
2. **Reconcile the pattern plan** — see [below](#reconciling-the-pattern-plan).
   The plan file (`paths.patternsPlan`, default `zdd/patterns-plan.md`) was
   written by "choose patterns" before the build. Judge it against the code
   *as it will merge*, mint the blessings that survived, and write the
   **pattern record** you will put in the commit message (step 6); then
   `git rm` the plan, so lint in step 5 runs without it. No plan
   on the branch: say so in one line, and still read the diff for a new
   pattern or a copied precedent worth a blessing.
3. **Run the deriver.** Regenerates the codebase metadata from source:
   ```
   npx -y @rich-rees/zdd-engine@2.2.0 derive
   ```
4. **Run the renderer.** Rebuilds the graph artifact (`zdd/graph.json`), the
   agent index, the ADR index, the blessing index, and the human index:
   ```
   npx -y @rich-rees/zdd-engine@2.2.0 render
   ```
5. **Lint the stores.** Supersession symmetry, blessing citations and every
   blessing's trigger question (blocking); a blessing with no reason or over
   the length budget (warnings — shorten it, the detail belongs in the ADR);
   and the **claims**: every route, table, function and surface no feature
   slice links, and any record two slices claim. Read the list against the
   diff — a record this unit of work added or changed belongs in exactly one
   slice now. Three more lines can appear (ZDD 2.1), all warnings: **API
   calls lint could not place** (a `${variable}` segment matches only a
   route parameter — type the variable as a union of literals, or the edge
   stays missing); **jobs with no stated mode** (commit a Railway file or
   set `extractorOptions.jobs.modes`); and, from `derive`, **an environment
   name no declared service covers** (add the service to
   `extractorOptions.services.services`, or its prefix to `ignore`). Each
   names the file; fix it in this unit of work where the diff caused it.
   - `claims.strict` off (the default): the lists are warnings, and the rest
     is the backlog a repo carries from adoption.
   - `claims.strict` on (check `zdd/config.json`): each is a **failure**,
     along with a stale `allowUnclaimed` entry and any claim file lint could
     not read. The unit of work is not finished until lint is green: link the
     record from one slice, move a double claim to one owner, or allow-list
     genuine plumbing. A component, job or service is a failure only when
     `claims.strictKinds` names its kind; otherwise it is a warning, so that
     switching an extractor on never turns a green lint red by itself.
   ```
   npx -y @rich-rees/zdd-engine@2.2.0 lint
   ```
6. **Commit all of it in the PR.** Code and docs merge atomically; the doc delta
   is reviewed alongside the code delta. **This commit carries the plan file's
   deletion** (staged in step 2) **and the pattern record in its message.**
   CI's `lint --merge` fails while the plan exists.

## Reconciling the pattern plan

The plan proposed; update decides, against the final diff — the campaign can
kill a pattern, change it, or create one the plan never saw.

1. **Read the plan and the diff** (against the base branch). For each piece:
   - **follow** — confirm the code does follow the blessing. If it does not,
     it is a departure: ask why, or record the reason the build found.
   - **depart from** — confirm the reason still holds. If the departure shows
     the blessing itself is wrong or stale, re-bless or drop it now (with an
     ADR if the change passes the three-part test).
   - **new pattern, candidate blessing** — did it survive, and is its
     exemplar in the diff? Then **mint it**: one list item under
     `# Blessings` in the slice it belongs to (an app's concept when it is
     cross-cutting), in the shape [authoring.md](../authoring.md) gives —
     trigger question first, exemplar linked, refusal named, reason given (an
     ADR, or "because …"). Otherwise **drop it**, and record why.
   - **no blessing applies** — nothing to do, unless the build ended up
     copying something; then treat that as precedent.
2. **Offer unblessed precedent.** Every precedent the plan declared, and any
   the diff shows the build copied without declaring, is offered to the
   developer as a candidate blessing. **Mint it only on their word** — a
   precedent the session merely copied is not yet a decision.
3. **Write the record** into the update commit's message, under a
   `Pattern record:` heading, one line per piece:

   ```
   Pattern record:
   - followed: <slice>: <trigger question> — <piece>
   - departed: <slice>: <trigger question> — <piece> — because …
   - minted: <slice>: <trigger question> — exemplar <path>
   - dropped candidate: <question> — because …
   - precedent: <path> — minted as <slice>: <question> | declined — because …
   - no blessing applied: <piece>
   ```

4. **Delete the plan file** (`git rm <plan path>`), so the deletion lands in
   the update commit with the record. Never leave it for the merge: a merge
   runs no code, and a plan that reached the base branch would describe work
   that is already done.

**A later update on the same branch** (a fix after update ran): read the plan
and the first record from git history — the plan is in the parent of the
commit that deleted it (`git log --diff-filter=D -1 --format=%H -- <plan path>`,
then `git show <that>^:<plan path>` and `git log -1 --format=%B <that>`).
Reconcile the new diff against them and write an **amended record**
(`Pattern record (amended):`, only what changed) into the new update commit.

A host harness may carry the plan and the record further — a build manifest
that states the plan, a build summary that reports followed, departed and
minted. The record in the commit message is the one ZDD relies on.

## Notes

- The ritual is **diff-anchored, not memory-anchored** — a fresh session can run
  it from the PR diff, the touched code, and the artifacts checkpointed en route.
- **Never hand-edit the generated artifacts** (`zdd/metadata/`, `zdd/graph.json`,
  the agent, ADR and blessing indexes, the human index) — regenerate. The fence hook (if opted in)
  refuses the edit; the CI check (if wired) fails otherwise.
- Read back any working file (`TEMPSTATE.md`) and delete it before merge —
  durable residue moves to an artifact first. The pattern plan is one such
  file, with its own step (2) above.
- The curated half is judgment CI can't gate — [authoring.md](../authoring.md) is
  the discipline that stands in for a gate. The Stop hook (if opted in) asks
  once per session when code changed and nothing in `zdd/` moved: run this
  ritual, or say plainly that nothing met the three-part test. Either answer,
  said out loud, is the point. Prefer to have driven the decisions out
  with `grill` (if the mattpocock-skills plugin is installed) or plan mode;
  by PR-finish this step is capture, not fresh design.
