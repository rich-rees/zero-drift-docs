---
name: bootstrap
description: Adopt Zero-Drift Docs in a repo — the install runbook. Detects the stack of an existing codebase (or grills for the intended stack on a greenfield repo), proposes the extractors with evidence, offers the opt-ins (auto-load hook, generated-artifact fence, Stop prompt, CI workflow, pre-push hook) as yes/no with defaults on, and WRITES them plus the instruction snippet, the release lock and a seeded ADR-0001. Idempotent — a second run repairs missing pieces and never overwrites curated content. Run once when adopting; a repo that already uses ZDD moves to a newer release with the upgrade skill ("upgrade ZDD").
---

# zdd:bootstrap — day one in a repo (and `--upgrade` later)

You are the conversation; **`scripts/bootstrap.mjs` is the only thing that
reads the stack and writes into the adopter's repo.** Never hand-write a file
this script writes, and never ask a question the detection already answered —
show the evidence and ask for confirmation instead.

**Where the script is.** It lives in this plugin at `scripts/bootstrap.mjs` —
two directories up from this SKILL.md (`<plugin>/skills/bootstrap/SKILL.md` →
`<plugin>/scripts/bootstrap.mjs`). Resolve `<plugin>` from the path you read
this file from and set it once, then use the commands below as written:

```sh
# POSIX shell — <skill-dir> is the directory this SKILL.md was read from
PLUGIN="$(cd "<skill-dir>/../.." && pwd)"
```
```powershell
# PowerShell
$PLUGIN = (Resolve-Path "<skill-dir>\..\..").Path
```

(`$CLAUDE_PLUGIN_ROOT` / `$env:CLAUDE_PLUGIN_ROOT` holds the same directory
when the host sets it, but the hosts do not promise it to skill-driven shells,
so the SKILL.md path is the reliable source.) Run from the adopter's repo
root, or pass `--root=<dir>`.

If invoked with **`--upgrade`**, or on a repo that already has `zdd/`
because the user wants a newer release, follow the
[`upgrade` skill](../upgrade/SKILL.md) instead.

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
     Application concept in the map when no extractor exists yet — a React
     Router web app gets the `react-router` extractor at its routes file plus
     its Application; an Expo app gets `expo-router` at its `app/` folder —
     early, built against a fixture — or stays map-only until that folder
     exists). Four more proposals carry their own evidence (ZDD 2.1):
     `components` (the `.tsx`/`.jsx` roots), `expo-router` (an `app/` folder
     with a `_layout` file), `jobs` (package scripts, a Procfile or a Railway
     file that run a process) and `external-services` (environment names read
     in source — `RESEND_API_KEY` — grouped by prefix into one third-party
     system each, with any import whose package matches). **Services are
     guessed by name:**
     show each and ask the user to confirm or rename it, and to say which
     prefixes are not a service (they go in `ignore`). Never add a vendor
     the evidence did not show. Say the limit as the evidence does: a
     service's `usedBy` is the files carrying its marker, never those that
     reach the provider through a settings object.

  Then ask every **`ask:`** line detection printed, one at a time — today,
  when Supabase sits beside a web app, whether the app subscribes to
  Realtime through a wrapper of its own. Record a named wrapper's call names
  in the answer set under the key the line names (`subscribeCalls`).
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
   (metadata, graph, the agent, ADR and blessing indexes, human index) with a reason that names
   `update`.
3. **Stop prompt** — when the agent ends a turn with code changed on the
   branch and nothing in `zdd/` moved, block once per session with one line:
   run `update`, or say that nothing met the three-part ADR test. A prompt for
   the curated half, not a check (decision 0008).
4. **CI workflow** — `.github/workflows/zdd.yml`, the blocking drift check.
5. **Pre-push hook** — *offered only when CI is declined*: the same checks,
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
  "optIns": { "autoLoad": true, "fence": true, "stop": true, "ci": true, "prePush": true },
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
  `zdd/glossary.md` (a header, no terms), `zdd/map/{features,apps,external-services}/`
  (one Application per declared app, and **one example feature slice** —
  `features/example-feature.md`, drawn from the configured stack, showing
  how a slice claims records; the adopter renames it to a real feature or
  deletes it, and a folder that already holds a slice gets none),
  `zdd/adr/0001-…` (dated today), `zdd/metadata/` (empty until derive).
- `.github/workflows/zdd.yml` **or** `.githooks/pre-push` (+ `git config
  core.hooksPath .githooks` — run for you when `.git` exists and the setting
  is free; an existing hook manager's path is left alone and the composition
  step printed). Both files carry a "Managed by Zero-Drift Docs" header: only
  files with that header are ever rewritten later, and a same-named file
  without it is kept and called out.
- The instruction block into `CLAUDE.md` and, for Codex users, `AGENTS.md` —
  one tool-neutral block between `<!-- zdd:begin -->` / `<!-- zdd:end -->`
  markers, leading with the spoken verbs. Existing content is kept.
- Hook registrations: the plugin's own `hooks.json` carries all three hooks
  and reads the opt-ins from `zdd/config.json`, so nothing is written into the
  host's settings.
- `docs/agents/domain.md`, **only when absent**: the file Matt Pocock's
  skills (1.3+) read to learn where the glossary and ADRs live — they look
  for a root `GLOSSARY.md` and `docs/adr/` by name otherwise, and would skip
  `zdd/glossary.md` or create a stray root `GLOSSARY.md`. ZDD's version
  names `paths.glossary`, `paths.adrDir` and `paths.adrIndex`. It is the
  adopter's from the first byte: a hand-written one is kept, whatever it
  says, and `--upgrade` never rewrites it.
- `.claude/settings.json` (Claude Code's project settings, committed): four
  lines under `enabledPlugins` — `zdd@zero-drift-docs` and
  `mattpocock-skills@zero-drift-docs` on, `mattpocock-skills@mattpocock` and
  `mattpocock-skills@claude-plugins-official` off. Claude Code loads two
  enabled copies of one plugin name as **one**, and the other copy can win,
  so this is what makes the pinned release load here; the other copies still
  work in the adopter's other repos. Beside them, **the lock** (decision
  0021): `extraKnownMarketplaces["zero-drift-docs"]` pinned to this
  release's tag, auto-update off — every developer runs the same release,
  and moving to a new one is a deliberate PR the session-start release check
  announces. An existing declaration is kept (a fork's is never touched). A
  key-level merge: every other key in the file is kept. Never a user or
  local settings file, never an uninstall. Say it the way the script does —
  "switched off your other Pocock copies in this repo; they still work in
  your other repos".

Relay the narration to the user verbatim — the point of the ledger is that
nothing lands unannounced.

## Step 4 — the engine, the mapping session, and the recommendation

1. **Derive** — `npx -y @rich-rees/zdd-engine@2.2.1 derive`. On a greenfield
   repo this writes nothing and passes; that is correct.
2. **Mapping session** (the only LLM-heavy step, paid once; skip on greenfield
   beyond the declared apps) — scan the code with the glossary + ADRs loaded,
   propose feature groupings, and **ask** wherever evidence is thin. Answers
   route by kind, per [authoring.md](../authoring.md): verdicts → ADRs,
   vocabulary → glossary, pure connective fact → the map.
3. **Render** — `npx -y @rich-rees/zdd-engine@2.2.1 render`. Commit the
   generated artifacts (`zdd/graph.json`, the agent, ADR and blessing indexes, the human index);
   never edit them.
4. **Lint** — `npx -y @rich-rees/zdd-engine@2.2.1 lint`. The same blocking
   lint CI runs: ADR numbering, supersession symmetry, and every blessing's
   citation and trigger question. A failure here is fixed now, in the mapping session, not
   discovered on the first PR. It also prints the **unclaimed records** — on
   day one that is the whole inventory, and it is the mapping session's
   worklist: each feature slice written claims the records it links, and
   the count in the human index header falls as they are placed.
5. **The Pocock recommendation** — the script already printed it. ZDD pins
   one release of Matt Pocock's skills and brings it in: installing zdd
   (`/plugin install zdd@zero-drift-docs`) installs
   `mattpocock-skills@zero-drift-docs` beside it, the release this ZDD
   release is tested with (decision 0014). If the script says
   `mattpocock-skills` is absent, zdd was loaded some other way (a
   `--plugin-dir`, a copied folder): say so and name that install. Say in
   plain words why it matters: the curated artifacts will only be as good as
   the design sessions that fill them, and `grill` needs that plugin; without
   it, plan mode + "update ZDD" works. **Recommended, never required** —
   continue either way. Offer to seed the glossary now with `grill` if it is
   installed.

## Step 5 — close

- **With CI:** the one step no tool can do — in branch protection, require
  the **zdd** check and require branches to be up to date before merging.
  Now stale generated artifacts cannot merge.
- **Without CI:** say plainly that the guarantee is weaker — ZDD runs on the
  spoken verbs (and the pre-push hook, if taken); drift is a habit kept, not a
  check that blocks a merge.
- **When detection proposed `generic`** (source present, no known
  convention): offer the [`extractor` skill](../extractor/SKILL.md) as the
  next session's work — it scaffolds a local extractor so the metadata stops
  being empty. Offer it here, after the runbook, never in the middle of it.

## Upgrade

A repo that already uses ZDD moves to a newer release with the [`upgrade`
skill](../upgrade/SKILL.md) ("upgrade ZDD"): it checks for a newer release,
shows every change before writing it, and lists what to commit. `bootstrap
--upgrade` is the same flow.

## Boundary reminder

The plugin scaffolds the *machine*, not a copy of anyone's docs. Every artifact
it writes is an empty template, a plugin-owned file, or the adopter's own first
decision.
