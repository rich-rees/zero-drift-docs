# 0007 — The fence blocks with the JSON deny reply, not exit 2

**Date:** 2026-09-04 · **Status:** accepted · **Origin:** DIO-312 live smoke test in Codex. **Supersedes, in part:** [0006](0006-one-repo-two-manifests.md) point 3 (the block signal only — the rest of 0006 stands).

## Context

Decision 0006 chose "exit code 2 and a reason on stderr" as the fence's block signal, on the grounds that it was the one convention every host honours, and rejected the JSON `permissionDecision` reply as host-specific. The first live run of the plugin in Codex (0.145.0, Windows) showed otherwise: an `apply_patch` against `zdd/agent-index.md` ran the fence, Codex marked the hook **Failed**, and the edit was applied. A controlled probe in the same session — one throwaway project hook exiting 2 with a stderr reason, one returning the JSON deny reply — reproduced it: exit 2 → "Failed", file modified; JSON deny → "Blocked", file untouched, reason relayed to the model verbatim. Codex's own hook documentation lists exit 2 as accepted; the observed behaviour is what the plugin has to live with. Claude Code documents both signals and honours the JSON reply on exit 0.

## Decision

1. **The fence signals a block with the PreToolUse JSON deny reply on stdout and exit 0:** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`. That shape is documented by both hosts and is the one that blocked in both when tried.
2. **The reason is mirrored on stderr** so it appears in either host's hook log, but nothing depends on it.
3. **A non-block stays silent with exit 0** — no stdout, no stderr — exactly as before, so the fence still never fails a session.
4. **The plugin tests assert the reply shape**, not an exit code: a block is exit 0 plus a parseable deny object whose reason names the generated artifact and the `update` ritual.

## Consequences

- A host that honoured only exit 2 would now see the fence as advisory. No such host is known; if one appears, the fence can emit both signals only if that host ignores stdout on a non-zero exit — to be verified live, never assumed (this decision exists because the reverse assumption was wrong).
- The SessionStart hook is unaffected: it prints plain text, which both hosts inject as context.
- The general lesson is recorded here rather than in the code: **a hook contract is proven per host by a live probe, not by reading two docs pages that agree.** The DIO-312 checklist on DIO-307 carries the probe.

## Rejected

- **Emit both (JSON deny on stdout *and* exit 2).** In Codex the non-zero exit is what marks the hook failed; stdout would not rescue it. Untested in Claude Code whether stdout is read on exit 2; not worth the ambiguity.
- **Keep exit 2 and document the Codex gap.** A fence that fails open in one of the two supported hosts is not a fence; the smoke test's acceptance criterion is explicit that the hand edit is blocked in both.
