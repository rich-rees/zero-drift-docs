# 0008 — A Stop hook prompts for the curated half, once per session

**Date:** 2026-09-08 · **Status:** accepted · **Origin:** an external review of the public repo from the model's side (Adam, 2026-09-08) and the DIO-313 discussion that followed; built under DIO-313 (plugin + engine 1.1.0).

## Context

ZDD's guarantee splits by artifact kind (decision 0003, point 2). The generated half — metadata, graph, both indexes — is protected by construction: `derive --check` and `render --check` make drift un-mergeable wherever the CI workflow is required. The curated half — glossary, ADRs, comments at the site, and the semantic map with its blessings — is protected by the finish ritual alone: "update ZDD" before declaring done. No script can judge whether a change met the three-part ADR test, so the ritual is the only enforcement the ADRs will ever get.

The review named the gap precisely, and from inside the harness: an agent's instruction-following on finish rituals degrades in long sessions — after compaction, after a run of tool calls, when the task feels done — and it does not announce that it has dropped the ritual. PressPlay's history shows the ritual has never been skipped there (four post-blessing tasks touched blessed video-pipeline code; all four left the blessings true), but from outside, a skipped judgment and a correct "nothing to change" are indistinguishable. The design knew this and had no mechanism for it.

Both hosts fire a `Stop` hook when the agent ends a turn, and both honour a `decision: "block"` JSON reply on exit 0 (the same shape lesson as decision 0007: Codex ignores exit 2 unless a continuation prompt is on stderr, and ignores a block with no reason). Both send `session_id` and `stop_hook_active` — `true` when the host is already continuing because a Stop hook blocked. Proven per host as 0007 demands: a live probe in Codex 0.145.0 (2026-09-08, a throwaway repo with the real `stop-check.mjs` as a project hook) showed `hook: Stop Blocked`, the reason relayed to the model, a one-sentence "nothing met the test" answer, and a silent second Stop carrying `stop_hook_active: true`. One Codex gotcha for the next probe: project `.codex/hooks.json` loads only in a project Codex has marked trusted, and says nothing otherwise.

## Decision

1. **A third hook, `Stop`, gives the curated half a prompt at the moment the ritual gets skipped.** When the agent ends a turn, the hook compares the working tree (untracked files included) against the merge-base with the base branch. If any path outside the ZDD bundle changed and no path inside it — the bundle dir or any configured artifact path — moved, it blocks with one line: run the ritual, or state explicitly that nothing met the three-part test and no term, comment, edge or blessing changed.
2. **It is a prompt, not a check.** It cannot verify the answer, and it does not try: a truthful "nothing to change" ends the matter. What it changes is that the judgment is now *made and said*, in the session that holds the context, rather than silently dropped. The CI check stays the only gate.
3. **It blocks once per session and never traps the agent.** Silent when the host says it is already continuing from a block (`stop_hook_active`), and silent after this hook has blocked once for a session id (a marker file under the OS temp dir, keyed by session id and adopter root). A Stop payload it cannot read — no JSON, no object — is silence, not a guess: without a session id there is nothing to key the marker on.
4. **It is an opt-in like the other two,** recorded as `hooks.stop` in the adopter's `zdd/config.json`, offered by `bootstrap` as a yes/no defaulting to yes, and off unless explicitly `true` — a repo bootstrapped before 1.1 has no key and stays silent. `bootstrap --upgrade` names the new question but never answers it; the skill asks, and a repair `apply` records the answer.
5. **The block reply is the JSON shape, exit 0**, mirrored on stderr for the hook log; any failure is silence with exit 0. Tested at the process seam against throwaway git repos.

## Consequences

- The ritual's enforcement moves from "the agent remembers" to "the agent is asked, once, at the right moment" — the cheapest mechanism that closes the largest gap the review found. It still relies on the agent answering honestly; a reviewer reading the PR sees either the curated diff or the stated judgment.
- A repo with the hook on and a long-lived branch gets one prompt per session, not per turn. A developer who declines the hook has the same ZDD as before 1.1.
- The hook shells out to git up to four times at every turn end; on a huge repo that costs a second. It never fetches — the merge-base is against whatever `origin/<baseBranch>` the checkout already has, falling back to the local branch, then to HEAD alone (uncommitted changes only).
- "Code changed" is deliberately coarse — any non-ZDD path, a README included. The alternative, guessing which paths are "code", is a per-stack opinion the plugin does not hold.
- The engine side of the same review lands with it (DIO-313): the blessing-citation lint is the map's first hard check, and the freshness nudge now watches the source behind every metadata link a concept makes, not just its `resource:` path.

## Rejected

- **A stronger Stop hook that checks the answer** — asking the model to judge its own diff for ADR-worthiness is the judgment the ritual already asks for; a hook cannot verify it either, and an LLM call from a hook breaks the "no LLM in the engine or hooks" line.
- **Block on every turn end until `zdd/` moves** — traps an agent whose honest answer is "nothing to change"; the once-per-session rule is what makes the prompt tolerable.
- **A CI check instead** — CI cannot see whether the ADR test was applied; it can only see that nothing in `zdd/` changed, which is the correct outcome most of the time. The prompt belongs where the context is: in the session, before the PR.
- **Default off** — inverts decision 0003 (defaults on, declining is a visible choice) for the one opt-in that guards the most valuable artifacts.
