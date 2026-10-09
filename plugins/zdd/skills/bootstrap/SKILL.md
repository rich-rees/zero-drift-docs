---
name: bootstrap
description: Adopt Zero-Drift Docs in a repo — the install runbook, in plain words. Checks that everything ZDD needs is on the machine, detects the stack of an existing codebase (or asks for the intended stack on a greenfield repo), proposes the extractors with evidence, offers the opt-ins one question at a time with a recommendation, and WRITES them — zdd/ and each artifact in turn, each explained as it lands — plus ZDD's instructions file and the one line that loads it, the release lock and a seeded ADR-0001. Sets expectations for a greenfield app, a young app or a mature codebase, caps the questions, and offers (never defaults to) a backfill. Idempotent — a second run repairs missing pieces and never overwrites curated content. Run once when adopting; a repo that already uses ZDD moves to a newer release with the upgrade skill ("upgrade ZDD").
---

# zdd:bootstrap — day one in a repo

You are the conversation; **`scripts/bootstrap.mjs` is the only thing that
reads the stack and writes into the adopter's repo.** Never hand-write a file
this script writes, and never ask a question the detection already answered —
show the evidence and ask for confirmation instead.

**Who you are talking to.** Assume the person has never heard of ZDD and may
not be a developer. Every step below is said in plain words, one at a time,
as it happens, so they understand exactly what ZDD is doing to their repo.
Explain a term the first time it comes up, in one sentence:

- a **generated file** — one ZDD writes from the code and rewrites every
  time; never edited by hand, because the next rewrite would lose the edit;
- an **extractor** — the part of ZDD that reads one convention of the code
  (the database migrations, the web routes, the screens) and writes the
  inventory of what it finds;
- a **blessing** — a one-line note in the docs saying "for this kind of work,
  start from this existing code, and never do that" — so the AI copies the
  right example instead of the nearest one;
- the **lock** — one line in the repo's settings pinning it to one ZDD
  release, so every developer runs the same one until the team chooses to
  move.

**How questions are asked.** One question at a time, never a batch. Each
question comes with a recommended answer, what that answer costs, and what
saying no gives up. Keep a running count ("question 3 of about 8") so the
end is in sight. After a question, **stop and wait for the answer**; never
carry on with other work in the same turn. After the last question, read
every answer back in one summary before writing anything. Bulk approvals
(the mapping session's groupings, the backfill's proposals) are **one
reviewable file each, approved in one pass** — never one question per item
(the cap, below).

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

## Step 0 — before anything: what ZDD needs

```
node "$PLUGIN/scripts/bootstrap.mjs" preflight
```

It checks every piece of tech ZDD needs and prints one line per check: Node.js
20 or newer (ZDD's scripts and its engine run on it), `npx` (comes with Node;
it downloads ZDD's engine from the public npm registry on first use), git and
a git repository (the lock is a git tag, and freshness reads the history), and
that github.com and the npm registry can be reached and the pinned engine is
there. **No account is needed anywhere.** Relay the lines. If anything is
MISSING, the script has already said what it is, what ZDD uses it for, how to
get it, and that nothing was written: say it again in your own words, and
**stop here** — the person fixes it and says "bootstrap ZDD" again.

## Step 1 — what kind of repo this is, and what to expect

```
node "$PLUGIN/scripts/bootstrap.mjs" estimate
```

It says which of three scenarios this repo is, and sets expectations. Relay
it in plain words:

- **Greenfield** (no code yet): ZDD makes an empty `zdd/` folder. Nothing is
  asked up front beyond the intended stack; every task's "update ZDD" fills
  the docs as the code arrives.
- **A young app** (months old) or **a mature codebase** (years old): on day
  one the **inventory** — the generated list of routes, tables, screens,
  jobs, components, external services — is complete, with no questions. One
  **mapping session** (step 5) proposes how the code groups into features
  and asks only where the evidence is thin. The **unclaimed list** (records
  no feature has claimed yet) is a to-do list, not a gate. Decisions are
  **never reconstructed from old code by default**; glossary terms,
  decisions and blessings arrive as each task's "update ZDD" touches them,
  so the docs fill in where the team works and untouched areas stay thin.
- **The cap:** an install on an existing repo asks the stack questions
  (step 2), the opt-ins (step 3), and runs **one** mapping session. Anything
  bulk — glossary proposals, blessing proposals, feature groupings — is
  approved as **one reviewable file**, never one question per item. Without
  this a session could interview the person about every feature for weeks.
- **The backfill offer** (step 6) is printed here with an honest estimate of
  the person's review time for this repo's size. Mention it now in one line;
  ask about it at step 6, not before.

## Step 2 — detect the stack

```
node "$PLUGIN/scripts/bootstrap.mjs" detect
```

It prints the mode, where the repo is hosted (that decides the CI offer in
step 3), and whether Matt Pocock's skills are installed (used in step 7):

- **EXISTING codebase** — a proposed extractor set, and for each one the
  **evidence** it found ("SQL migrations under `supabase/migrations`",
  "`APIRouter` under `api/routes`") and the options that evidence implies.
  **Describe each extractor by what the person will see**, not by its name:
  "the database extractor reads your migrations, so the map will show every
  table and which code touches it"; "the components extractor will show
  which screens use which components"; "the external-services extractor
  will show which code depends on Sentry and Resend". Then ask, one at a
  time:
  1. **"Is this all correct?"** (question 1) — they confirm or correct names,
     paths, the repo's display name, `repoBase` and `baseBranch`.
  2. **"Anything else planned for the stack?"** (question 2) — a part with no
     code yet is configured *ahead* of the code (an extractor at its future
     path, or an app in the map when no extractor exists yet — a React
     Router web app gets the `react-router` extractor at its routes file
     plus its app page; an Expo app gets `expo-router` at its `app/` folder
     — early, built against a fixture — or stays map-only until that folder
     exists). Four more proposals carry their own evidence (ZDD 2.1):
     `components` (the `.tsx`/`.jsx` roots), `expo-router` (an `app/` folder
     with a `_layout` file), `jobs` (package scripts, a Procfile or a Railway
     file that run a process) and `external-services` (environment names
     read in source — `RESEND_API_KEY` — grouped by prefix into one
     third-party system each, with any import whose package matches).
     **External services are guessed by name:** show each and ask the person
     to confirm or rename it, and to say which prefixes are not a service
     (they go in `ignore`). Never add a vendor the evidence did not show.
     Say the limit as the evidence does: a service's "used by" is the files
     carrying its marker, never those that reach the provider through a
     settings object.

  Then ask every **`ask:`** line detection printed, one at a time — today,
  when Supabase sits beside a web app, whether the app subscribes to
  Realtime through a wrapper of its own. Record a named wrapper's call names
  in the answer set under the key the line names (`subscribeCalls`).
- **GREENFIELD** — no source to read. Ask for the intended stack, one
  question at a time: what serves the API, what holds the data, what the apps
  are (web, mobile), and where each will live. Every part maps to an extractor
  at its stated future path, or to an app page in the map skeleton. Nothing
  is guessed silently; a path the person did not state gets the convention's
  default and is said aloud.

If `zdd/` already exists the script reports **repair** mode: it will fill only
what is missing, and an opt-in you do not answer keeps its current state —
only an explicit answer changes it. Say so, and skip the stack questions
unless config is absent.

## Step 3 — the opt-ins, one question at a time (defaults **on**)

Each as one question with the recommended answer, its cost, and what no gives
up; a "no" is a visible choice, never a silent omission:

1. **Auto-load** — "At the start of every session, ZDD shows the AI a short
   index of your features and where their code is. Recommended: yes. Cost:
   about two thousand words of the AI's attention per session. Saying no
   means each session starts by searching for things."
2. **The fence** — "ZDD can refuse to let the AI hand-edit a generated file
   (it tells the AI to regenerate instead). Recommended: yes. Cost: none you
   will notice. Saying no means a hand edit is only caught later, by the
   check."
3. **The finish prompt** — "When the AI ends a turn with code changed and
   nothing in `zdd/` updated, ZDD asks it once per session to run 'update
   ZDD' or say plainly that nothing needed recording. Recommended: yes. Cost:
   one short interruption, at most once a session. Saying no means the docs
   fall behind quietly." (decision 0008)
4. **The CI check** — ask this **only when the repo is hosted on GitHub**
   (step 2 said where): "A check that runs on every pull request and refuses
   to merge one whose generated docs are stale. This is what makes ZDD a
   guarantee instead of a habit. Recommended: yes. Cost: a few seconds per
   pull request. Saying no means drift is caught by people, not by the
   merge." **On any other host** (GitLab, Azure DevOps, Bitbucket, another
   server) do not ask: the workflow ZDD ships runs only on GitHub Actions,
   and the script will not write it. Say instead that the merge gate is
   **three commands** for their own pipeline — the script prints them at the
   end — and go on to the next question. A repo with **no remote yet** keeps
   the GitHub default; ask where it will be hosted.
5. **The pre-push hook** — *offered only when there is no CI check*: "The
   same checks, run on your machine before each push; it makes a forgotten
   update loud, but it gates nothing. Recommended: yes."

Then, still one at a time: **"Do you use Codex as well as Claude Code?"**
(writes the same instructions into `AGENTS.md`, because Codex cannot load a
separate file), and **"Seed the first decision record, 'Adopt Zero-Drift
Docs'?"** (recommended yes — the first entry in the decisions and a worked
example of the format; *their* decision, not ZDD's history).

**Read every answer back** in one short summary, then go on.

## Step 4 — write, one artifact at a time

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
hand). Then it narrates every file as **wrote / kept / skipped**, and under
each file a four-line card: **what** it is, **why** it exists, **who** writes
it, and whether it is ever **hand-edited**.

**Walk the person through the ledger one artifact at a time, in this order,
using the cards** — never the bare ledger (no hash ids, no JSON, no "repair
apply"):

1. the `zdd/` folder itself — "ZDD keeps its docs in one folder, `zdd/`";
2. `zdd/instructions.md` — ZDD's instructions to the AI for every session,
   and **the one line in `CLAUDE.md`** that loads it. Show `CLAUDE.md`
   **before and after** in plain words: the line `@zdd/instructions.md`
   makes Claude Code read ZDD's file at the start of every session, as if
   it were written there; ZDD owns that file and rewrites it on upgrade;
   **everything else in `CLAUDE.md` is theirs** and ZDD never edits it again.
   Then say what each rule in the instructions makes the AI do differently:
   it reads the glossary and the decisions before building ("load ZDD"); it
   checks for existing code to reuse and the blessings before writing code
   ("choose patterns"); it records terms, decisions and map changes and
   regenerates the inventory before finishing ("update ZDD"); it never
   hand-edits a generated file; it puts a release line first in its reply
   and fixes it before the task; and it knows the install commands to tell
   a new developer. For Codex users, `AGENTS.md` holds a copy of the same
   text between two marker lines.
3. the glossary — theirs, starts empty;
4. the decisions folder and ADR-0001 — theirs from today;
5. the semantic map and its example feature — theirs; the example shows how
   a feature claims its code by linking it;
6. the codebase metadata — the inventory, generated, never hand-edited;
7. the agent index, the human index, the ADR index and the blessing index —
   generated at step 5 by `render`, never hand-edited (the cards for these
   come from the script's explanation table, `explain(path)`);
8. the config and **the lock** (`.claude/settings.json`: which plugins are on
   for this repo, and the line pinning the repo to this ZDD release so every
   developer runs the same one; moving it is a deliberate change the next
   session announces); the other copies of Matt Pocock's skills switched off
   *in this repo only* — they still work in the person's other repos;
9. the CI workflow **or** the pre-push hook (+ `git config core.hooksPath
   .githooks` — run for you when `.git` exists and the setting is free; an
   existing hook manager's path is left alone and the composition step
   printed); `.gitattributes` (one line so Windows does not show every
   generated file as changed); and `docs/agents/domain.md`, only when absent
   (the note that points Matt Pocock's skills at `zdd/`; theirs from the
   first byte).

Ownership, file by file: the CI workflow, the pre-push hook and
`zdd/instructions.md` carry a "Managed by Zero-Drift Docs" header, and only a
file with that header is ever rewritten later — a same-named file without it
is kept and called out; `zdd/config.json` and `.claude/settings.json` are
JSON (no header) and ZDD rewrites only its own keys in them; `.gitattributes`
and `CLAUDE.md` get one line each, appended, and the rest is never touched;
everything under `zdd/` besides the instructions and the generated files is
the adopter's from the first byte. Hook registrations live in the plugin's
own `hooks.json`, which reads the opt-ins from `zdd/config.json`, so nothing
is written into the host's settings.

## Step 5 — the engine, then the one mapping session

1. **Derive** — `npx -y @rich-rees/zdd-engine@2.3.0 derive`. "This reads the
   code and writes the inventory." On a greenfield repo it writes nothing and
   passes; that is correct.
2. **Render** — `npx -y @rich-rees/zdd-engine@2.3.0 render`. "This writes the
   indexes from the inventory and the map." Commit the generated artifacts
   (`zdd/graph.json`, the agent, ADR and blessing indexes, the human index);
   never edit them.
3. **Lint** — `npx -y @rich-rees/zdd-engine@2.3.0 lint`. The same blocking
   check CI runs: ADR numbering, supersession symmetry, and every blessing's
   citation and trigger question. A failure here is fixed now, not discovered
   on the first PR. It also prints the **unclaimed records** — on day one
   that is the whole inventory, and it is the mapping session's worklist.
4. **The mapping session** (the only AI-heavy step, paid once; skip on
   greenfield beyond the declared apps). With the glossary and ADRs loaded,
   scan the code and **propose the feature groupings as one reviewable
   file** (`zdd/map/features/` pages, proposed in one message or one scratch
   file), asking only where the evidence is thin — never one question per
   feature. **Link each feature's entry points only** (its routes, screens,
   the one or two modules a reader starts from), not every file: the agent
   index then scales with the number of features, not the size of the code.
   Answers route by kind, per [authoring.md](../authoring.md): verdicts →
   ADRs, vocabulary → glossary, pure connective fact → the map. Where the
   session proposes a **blessing**, it passes the test in authoring.md: a
   pointer to existing, reusable code first ("Adding an upload? Start from
   `lib/media-upload-client.ts`; reuse it before writing new upload code"),
   one trap it refuses and its reason; a rule with no code to point at is
   an ADR and a code comment, not a blessing; a kind of work with no
   exemplar yet is a *candidate*, minted once the code exists. Then render
   again; the count in the human index header falls as records are placed.

## Step 6 — the backfill, offered once (never default)

Most useful on an app six to twelve months old: big enough to benefit, young
enough that the people who decided still remember why. Ask it as **one
question** with the estimate from step 1: "ZDD can propose, from the code,
a first glossary, the blessings, and a short list of decisions worth
recording — about <estimate> of your review time, as three files you tick
through. Recommended on a young app with the original team around; skip it
if you would rather let the docs grow with the work. Skippable, resumable,
and doable per artifact." On yes, per artifact, each as **one reviewable
file** the person ticks, edits or strikes in one pass:

- **Glossary:** every term the names in the code suggest, one line each,
  proposed definition beside it.
- **Blessings** (the most valuable): kinds of work done several times and
  the existing code to start from, under the test above; the file lists the
  trap each one refuses and its reason.
- **Decisions, carefully:** the code shows *what* was decided, never *why*,
  and a confident invented reason is worse than none because later sessions
  trust it. Propose only the decisions that would surprise a newcomer
  (roughly five to fifteen), **ask the person for the why** of each (offer
  clues from commit messages and code comments), **never write the why
  yourself**, and mark each one "recorded after the fact".
- **Feature map:** nothing extra; the mapping session covered it.

Approved lines go into the artifacts by the formats in
[authoring.md](../authoring.md); struck lines are dropped without comment.

## Step 7 — the Pocock recommendation, then close

**Matt Pocock's skills.** The script already printed the line. ZDD's design
interview (`grill`) is built on Matt Pocock's skills, so installing zdd
brings the one release of them ZDD is tested with
(`mattpocock-skills@zero-drift-docs`, decision 0014). If the script says the
pinned copy is missing, zdd was loaded some other way (a `--plugin-dir`, a
copied folder): say so and name the install (`claude plugin install
zdd@zero-drift-docs --scope project`, from the repo's folder). If it says a
copy is present but **switched off here**, that is on purpose — this repo
switches other copies off so the pinned one loads — and the fix is the same
install, never switching the other one back on. In plain words, why it
matters: the glossary and decisions will only be as good as the design
conversations that fill them, and `grill` is the sharp version of that
conversation; without it, plan mode plus "update ZDD" works. **Recommended,
never required** — continue either way. Offer to seed the glossary now with
`grill` if it is installed.

**Close:**

- **With the CI check (GitHub):** the one step no tool can do — in branch
  protection, require the **zdd** check and require branches to be up to
  date before merging. Now stale generated artifacts cannot merge.
- **On another host:** repeat the three commands the script printed, in plain
  words: run them on every pull request and fail the pipeline when any
  fails. Until that is wired, the pre-push hook makes a forgotten update
  loud on each developer's machine.
- **Without any check:** say plainly that the guarantee is weaker — ZDD runs
  on the spoken verbs (and the pre-push hook, if taken); drift is a habit
  kept, not a check that blocks a merge.
- **When detection proposed `generic`** (source present, no known
  convention): offer the [`extractor` skill](../extractor/SKILL.md) as the
  next session's work — it scaffolds a local extractor so the inventory stops
  being empty. Offer it here, after the runbook, never in the middle of it.
- **A ZDD defect** (something ZDD got wrong, as opposed to something in this
  repo): propose filing it at https://github.com/rich-rees/zero-drift-docs/issues,
  labelled `finding`.

## Upgrade

A repo that already uses ZDD moves to a newer release with the [`upgrade`
skill](../upgrade/SKILL.md) ("upgrade ZDD"): it checks for a newer release,
shows every change before writing it, and lists what to commit. `bootstrap
--upgrade` is the same flow.

## Boundary reminder

The plugin scaffolds the *machine*, not a copy of anyone's docs. Every artifact
it writes is an empty template, a plugin-owned file, or the adopter's own first
decision. Nothing here is specific to any one project, host or team.
