---
name: bootstrap
description: Adopt Zero-Drift Docs in a repo — the install runbook. Detects the stack of an existing codebase (or grills for the intended stack on a greenfield repo), proposes the extractors with evidence, offers the opt-ins (auto-load hook, generated-artifact fence, CI workflow, pre-push hook) as yes/no with defaults on, and WRITES them plus the instruction snippet and a seeded ADR-0001. Idempotent — a second run repairs missing pieces and never overwrites curated content. With --upgrade, migrates a repo bootstrapped by an older plugin (adapter → extractors, engine pins, snippet), narrating every file it changes. Run once when adopting; run --upgrade after updating the plugin.
---

# zdd:bootstrap — day one in a repo (and `--upgrade` later)

You are the conversation; **`scripts/bootstrap.mjs` is the only thing that
reads the stack and writes into the adopter's repo.** Never hand-write a file
this script writes, and never ask a question the detection already answered —
show the evidence and ask for confirmation instead.

**Where the script is.** It lives in this plugin at `scripts/bootstrap.mjs` —
two directories up from this SKILL.md (`<plugin>/skills/bootstrap/SKILL.md` →
`<plugin>/scripts/bootstrap.mjs`). Resolve `<plugin>` from the path you read
this file from; the commands below write it as `$PLUGIN`. In a POSIX shell
`$CLAUDE_PLUGIN_ROOT` holds the same directory when the host sets it; in
PowerShell that is `$env:CLAUDE_PLUGIN_ROOT`, and the hosts do not promise the
variable to skill-driven shells, so the SKILL.md path is the reliable source.
Run from the adopter's repo root, or pass `--root=<dir>`.

If invoked with **`--upgrade`**, skip to [Upgrade](#upgrade).

## Step 1 — detect

```
node "$PLUGIN/scripts/bootstrap.mjs" detect
```

It prints one of two modes, plus whether the `mattpocock-skills` plugin is
installed (used in step 4):

- **EXISTING codebase** — a proposed extractor set, and for each one the
  **evidence** it found ("SQL migrations under `supabase/migrations`",
  "`APIRouter` under `api/routes`") and the options that evidence implies.
  Show the user exactly that, then ask two questions, in order:
  1. **"Is this all correct?"** — they confirm or correct names, paths, the
     repo's display name, `repoBase` and `baseBranch`.
  2. **"Anything else planned for the stack?"** — a part with no code yet is
     configured *ahead* of the code (an extractor at its future path, or an
     Application concept in the map when no extractor exists yet — React and
     Expo routers are map-only today).
- **GREENFIELD** — no source to read. Grill for the intended stack: what
  serves the API, what holds the data, what the apps are (web, mobile), and
  where each will live. Every part maps to an extractor at its stated future
  path, or to an Application in the map skeleton. Nothing is guessed silently;
  a path the user didn't state gets the convention's default and is said aloud.

If `zdd/` already exists the script reports **repair** mode: it will fill only
what is missing, and an opt-in you do not answer keeps its current state —
only an explicit answer changes it. Say so, and skip the stack questions
unless config is absent.

## Step 2 — the opt-ins (yes/no, defaults **on**)

Ask each as one line, default yes; a "no" is a visible choice, never a silent
omission:

1. **Auto-load hook** — inject `zdd/agent-index.md` at session start.
2. **Generated-artifact fence** — refuse hand edits to the generated artifacts
   (metadata, graph, both indexes, human index) with a reason that names
   `update`.
3. **CI workflow** — `.github/workflows/zdd.yml`, the blocking drift check.
4. **Pre-push hook** — *offered only when CI is declined*: the same checks,
   run locally before a push. Weaker than CI (it makes a forgotten update
   loud; it gates nothing).

Then: **"Do you use Codex as well as Claude Code?"** (writes `AGENTS.md`), and
**"Seed ADR-0001 'Adopt Zero-Drift Docs'?"** (default yes — the corpus's first
entry and a worked example of the format, *their* decision, not ZDD's history).

## Step 3 — write

Put the answers in a JSON file and apply. The shape (every key optional —
omitted keys take the detection / the defaults):

```json
{
  "name": "My App", "repoBase": "https://github.com/org/repo/tree/main/", "baseBranch": "main",
  "extractors": ["supabase", "fastapi"], "extractorOptions": { "fastapi": { "roots": ["api"] } },
  "stack": ["FastAPI", { "name": "Supabase", "path": "db/migrations" }, "React web", "Expo"],
  "apps": ["Web (React)", "Mobile (Expo)"],
  "optIns": { "autoLoad": true, "fence": true, "ci": true, "prePush": true },
  "codex": false, "seedAdr": true
}
```

```
node "$PLUGIN/scripts/bootstrap.mjs" apply --answers=<file>
```

It validates the whole answer set first and stops before writing anything if
a value is malformed; it also stops if a `zdd/config.json` exists but cannot
be read (it never replaces a config it cannot parse — fix or remove it by
hand). Then it narrates every file as **wrote / kept / skipped** and writes:

- `zdd/config.json` (extractors + options, `engine` pin, `hooks` opt-ins),
  `zdd/glossary.md` (a header, no terms), `zdd/map/{features,apps,services}/`
  (empty, plus one Application per declared app), `zdd/adr/0001-…` (dated
  today), `zdd/metadata/` (empty until derive).
- `.github/workflows/zdd.yml` **or** `.githooks/pre-push` (+ `git config
  core.hooksPath .githooks` — run for you when `.git` exists and the setting
  is free; an existing hook manager's path is left alone and the composition
  step printed). Both files carry a "Managed by Zero-Drift Docs" header: only
  files with that header are ever rewritten later, and a same-named file
  without it is kept and called out.
- The instruction block into `CLAUDE.md` and, for Codex users, `AGENTS.md` —
  one tool-neutral block between `<!-- zdd:begin -->` / `<!-- zdd:end -->`
  markers, leading with the two spoken verbs. Existing content is kept.
- Hook registrations: the plugin's own `hooks.json` carries both hooks and
  reads the opt-ins from `zdd/config.json`, so nothing is written into the
  host's settings.

Relay the narration to the user verbatim — the point of the ledger is that
nothing lands unannounced.

## Step 4 — the engine, the mapping session, and the recommendation

1. **Derive** — `npx -y @rich-rees/zdd-engine@0.4.0 derive`. On a greenfield
   repo this writes nothing and passes; that is correct.
2. **Mapping session** (the only LLM-heavy step, paid once; skip on greenfield
   beyond the declared apps) — scan the code with the glossary + ADRs loaded,
   propose feature groupings, and **ask** wherever evidence is thin. Answers
   route by kind, per [authoring.md](../authoring.md): verdicts → ADRs,
   vocabulary → glossary, pure connective fact → the map.
3. **Render** — `npx -y @rich-rees/zdd-engine@0.4.0 render`. Commit the
   generated artifacts (`zdd/graph.json`, both indexes, the human index);
   never edit them.
4. **The Pocock recommendation** — the script already printed it. If
   `mattpocock-skills` is absent, say in plain words: the curated artifacts
   will only be as good as the design sessions that fill them; `grill` needs
   that plugin (`/plugin marketplace add mattpocock/skills`, then
   `/plugin install mattpocock-skills@skills`); without it, plan mode +
   "update ZDD" works. **Recommended, never required** — continue either way.
   Offer to seed the glossary now with `grill` if it is installed.

## Step 5 — close

- **With CI:** the one step no tool can do — in branch protection, require
  the **zdd** check and require branches to be up to date before merging.
  Now stale generated artifacts cannot merge.
- **Without CI:** say plainly that the guarantee is weaker — ZDD runs on the
  two verbs (and the pre-push hook, if taken); drift is a habit kept, not a
  check that blocks a merge.

## Upgrade

`bootstrap --upgrade` is the **only** writer into an adopter's repo after
adoption. Updating the plugin never touches the repo by itself; this does, and
narrates every file:

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade
```

- `zdd/config.json`: the pre-1.0 `adapter` → `extractors` + `extractorOptions`
  (the same split the engine applies at derive time, now made permanent),
  `viewer.nonAreaTags` → top-level `nonAreaTags`, `engine` pin → this plugin.
- `.github/workflows/zdd.yml` and `.githooks/pre-push`: engine pin rewritten
  (a managed pre-push is rewritten from the template).
- `CLAUDE.md` / `AGENTS.md`: the marked block refreshed (exactly one
  well-formed `<!-- zdd:begin -->` / `<!-- zdd:end -->` pair; anything else is
  refused and named); a pre-0.4 unmarked snippet is replaced only when it is
  recognisably ours — a customised section under that heading is left alone
  and a fresh block appended.
- A config holding both `adapter` and `extractors` is refused — keep one by
  hand first, as the engine demands.
- **Never** the glossary, ADRs, map, or metadata.

If the engine pin moved, run `render` and commit the regenerated artifacts in
the same PR — a pin bump that lands without them fails the next CI run.

## Boundary reminder

The plugin scaffolds the *machine*, not a copy of anyone's docs. Every artifact
it writes is an empty template, a plugin-owned file, or the adopter's own first
decision.
