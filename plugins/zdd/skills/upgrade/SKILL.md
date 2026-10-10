---
name: upgrade
description: "\"upgrade ZDD\" — move a repo that already uses Zero-Drift Docs to a newer release, as one guided flow in plain words: checks that everything ZDD needs is still here, checks for a newer release and moves the repo's lock on the user's yes (then a restart, or none when this machine is already there), or, on the release that is running, shows every file it will change with what it is and why, reads the repo's own instruction text against ZDD's rules sentence by sentence, asks one question at a time, writes, regenerates, and lists what to commit. Also run when the user says bootstrap --upgrade."
---

# zdd:upgrade — "upgrade ZDD"

The adopter is **choosing** to upgrade, so this is a guided flow: say what is
coming, ask, then act. **`scripts/bootstrap.mjs` is the only writer** — you
run it, relay its ledger in plain words, and never hand-write a file it writes.

**Who you are talking to.** Assume the person has never seen an upgrade and
may not be a developer. Every change is explained as it comes up — what the
file is, why it changes, who owns it — in the words the script's cards use
(**what / why / who / hand-edited**). Never the bare ledger: no hash ids, no
JSON, no "repair apply". **One question at a time**, each with a recommended
answer, its cost, and what saying no gives up; keep a running count; after a
question, stop and wait. Explain a term the first time it comes up: the
**lock** (one line in the repo's settings pinning it to one ZDD release), the
**catalogue** (this machine's downloaded copy of ZDD's release list, which a
restart moves to the lock), a **generated file** (written by ZDD from the
code, never hand-edited), an **extractor** (the part of ZDD that reads one
convention of the code).

**Where the script is.** Two directories up from this SKILL.md
(`<plugin>/skills/upgrade/SKILL.md` → `<plugin>/scripts/bootstrap.mjs`):

```sh
PLUGIN="$(cd "<skill-dir>/../.." && pwd)"          # POSIX
```
```powershell
$PLUGIN = (Resolve-Path "<skill-dir>\..\..").Path   # PowerShell
```

Run every command from the adopter's repo root. A repo with no
`zdd/config.json` has nothing to upgrade: offer the `bootstrap` skill instead.

## Step 1 — what ZDD needs, and is there a newer release?

```
node "$PLUGIN/scripts/bootstrap.mjs" preflight
```

The same check the install ran: Node.js 20+, `npx`, git and a repository,
github.com, the npm registry, and that the engine this release pins is there
to download — a new release is a new engine download, so a firewall or a
missing Node is named up front, not as a raw `npx` error mid-upgrade. Relay
the lines; on a MISSING line say it in your own words and **stop** (nothing
was written).

```
node "$PLUGIN/scripts/bootstrap.mjs" release-status
```

It names the newest release tag, the repo's lock, the release this session
runs, and the catalogue this machine holds — and, when the lock trails, says
which of two routes applies. (It reads the marketplace's tags over the
network; if that fails, say so and continue at step 2 with the running
release.) Relay its line in plain words: the lock is what the repo asks
every developer to run; the catalogue is this machine's downloaded copy of
ZDD's release list, which a restart moves to the lock; the running release
is what loaded when this session started.

- **A newer release exists, in Claude Code** (question 1 of about 5): tell
  the user what it is, link its release notes as printed, and ask **"Move
  this repo to vX.Y.Z?"** — or, when the repo has **no lock**, **"Lock this
  repo and move it to vX.Y.Z?"** (decision 0021). Recommended: yes, the
  notes say what it brings; cost: one PR and, for each teammate, two
  restarts; saying no keeps the repo where it is, which is a fine choice.
  On yes:

  ```
  node "$PLUGIN/scripts/bootstrap.mjs" upgrade --to=vX.Y.Z           # add --lock when there was no lock
  ```

  It checks the tag exists, then writes only the lock, and its **`next:`**
  note names the route for *this* machine:
  - **"no restart"** — this session already runs the target and the
    catalogue is there: carry **straight on to step 2** in this session.
  - otherwise — relay it word for word: **restart Claude Code; the first
    line of the next session names the commands that move this machine —
    run them, restart again; then say "upgrade ZDD" again.** Claude Code
    loads a new plugin version only at start, so the rest of the upgrade is
    the new release's own run. **Stop here** — this run is complete when
    the lock has moved and the user has the route.
- **The lock trails and the line says "no restart"** (this session already
  runs the newest release and the catalogue is there): ask the same
  question; on yes run `upgrade --to=vX.Y.Z` (add `--lock` when there was
  no lock), relay its ledger, and **carry straight on to step 2**.
- **A newer release exists, in Codex** (Codex reads no lock): ask **"Update
  ZDD to vX.Y.Z?"** On yes, the user updates the install from a terminal —
  `codex plugin marketplace upgrade zero-drift-docs`, then `codex plugin
  remove zdd@zero-drift-docs` and `codex plugin add zdd@zero-drift-docs` —
  starts a new session, and says "upgrade ZDD" again. **Stop here.**
- **No newer release**, or the user said no: continue at step 2 with the
  release that is running. If the repo already locks a newer release than
  this session runs, step 2 refuses and names the update — relay it.

## Step 2 — the plan, explained file by file

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade --plan
```

It writes nothing. Walk the person through it in plain words, in this order:

1. **Every file it would change**, with its card (what, why, who,
   hand-edited) — the config's version line, the engine pin in the CI
   workflow or the pre-push hook, `zdd/instructions.md` (ZDD's own file,
   rewritten to this release's text), the lock, `.gitattributes`. Say for
   each what moves and why in one sentence.
2. **The instructions file and the one line in `CLAUDE.md`.** On a repo from
   before 2.3 the plan replaces the old marked block in `CLAUDE.md` with one
   line, `@zdd/instructions.md`. Show `CLAUDE.md` **before and after** in
   plain words: the markers and the block go; one line stays, which makes
   Claude Code read ZDD's file at the start of every session as if it were
   written there; ZDD owns that file; **everything else in `CLAUDE.md` is
   theirs** and ZDD never edits it again. Then say what each new rule makes
   the AI do differently (the release's notes list them). For Codex users,
   `AGENTS.md` keeps a copy of the text between its two marker lines,
   because Codex cannot load a separate file.
3. **The notes** — this upgrade's changelog, a line or two per release the
   repo crosses; the "Upgrading to X.Y" sections below say what each one
   asks of you. Say them in plain words; the questions they raise are asked
   at step 4.
4. **Their own text that speaks to a ZDD rule.** The plan lists every
   paragraph or bullet in `CLAUDE.md` / `AGENTS.md`, outside ZDD's line or
   block, that speaks to one of ZDD's rules — never a whole section — and
   prints **what ZDD now says** beside it. The unit is the whole paragraph
   or bullet, shown in full: that is what `--drop` removes. For each one,
   read the two together and tell the person, in plain words: **same** (it
   says what ZDD's instructions already say — safe to remove, their call),
   **different** (it says something ZDD's rules do not cover — keep it), or
   **contradicting** (it tells the AI to do something ZDD's rules forbid —
   recommend removing or changing it, and say why). When a paragraph mixes
   a ZDD rule with a rule of their own, recommend editing it by hand rather
   than dropping it. The text is theirs; it is removed only on their word,
   and the heading goes with it only when the paragraph was all the section
   held.
5. **Retired names.** The plan lists every file in the repo that still uses
   a name a release retired (an old command, an old extractor key, the old
   release tag held somewhere ZDD does not write — a lock test, a setup
   guide), each with its replacement. Say where each is and what to change
   it to; these are the person's files, changed by hand.

Then ask, **one question at a time** (questions 2 to 4 of about 5):

- **"Write these changes?"** — recommended yes; cost: one commit in a PR;
  saying no leaves the repo on its current release.
- If the plan says the repo has **no lock**: **"Lock it to this release?"**
  — recommended yes (decision 0021): every developer then runs the same
  release and the next upgrade starts at step 1; saying no leaves the repo
  floating on whatever each machine last fetched.
- If their own text was named: **"Which of these paragraphs or bullets
  shall I remove?"** — list them with your same / different / contradicting
  reading and a recommendation for each; they answer with the ones to drop.

Read the answers back, then go on.

## Step 3 — write

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade [--lock] [--drop=<ids>]
```

`--lock` only on a yes to the lock question; `--drop=<id>,<id>` only with the
ids the plan printed for the sentences the user chose (each id binds the
sentence's text and its place: if it changed since the plan, the run refuses
— show the plan again). Relay the ledger in plain words, as in step 2. Its
notes match the plan's.

## Step 4 — the questions the notes raise, one at a time

Work through every note that asks something, one question at a time, each
recorded by the script, never by hand (the remaining questions of about 5):

- **An opt-in extractor offered with evidence** (2.1): say what the person
  would see ("the map would show which code depends on Sentry and Resend"),
  show the evidence and ask. On yes, a repair apply with the extractor added
  — `apply --answers=<file>` where the file is `{ "extractors": [<current…>,
  "<name>"], "extractorOptions": { "<name>": <options from the note> } }`.
  Repair mode keeps every other choice. Never add one the user did not
  confirm. Say the cost plainly: switching an extractor on adds records,
  which lengthens the agent index and the unclaimed list until the map
  claims them.
- **The finish prompt is unset** (1.1): ask (default yes), record it with a
  repair apply `{ "optIns": { "stop": true } }` (or `false`).
- **Realtime wrappers** (2.1): ask whether the app subscribes through a
  wrapper; record the call names with a repair apply — `{ "extractorOptions":
  { "react-router": { "subscribeCalls": ["live.onInsert"] } } }`, or for
  Next.js `{ "extractorOptions": { "nextjs": { "refs": { "subscribeCalls":
  [...] } } } }`. Options merge into what is there; nothing else moves.
- **The map's `services/` folder** (2.3): the note suggests renaming it to
  `external-services/`; it is theirs and is never renamed for them.

## Step 5 — regenerate, check, and list the commit

Run the preflight once more — the engine pin may have moved, and a new pin is
a new download:

```
node "$PLUGIN/scripts/bootstrap.mjs" preflight
```

Then, with the engine this plugin pins:

```
npx -y @rich-rees/zdd-engine@2.4.0 derive
npx -y @rich-rees/zdd-engine@2.4.0 render
npx -y @rich-rees/zdd-engine@2.4.0 lint
```

Show what moved in the generated artifacts and say why, from the notes (a
pin bump re-derives; the notes name the byte changes each release brings).
A red `lint` is the upgrade doing its job — the notes say which release
tightened what; fix it with the user in this PR.

The run is complete when you have listed every file to commit **in one PR**:
the ledger's changed files, the regenerated artifacts, and any repair-apply
changes. Close with the team's next step, in plain words: after the PR
merges, each developer's next session start prints one line naming the
commands that move their machine — they run them and restart. A ZDD defect
met on the way is proposed for filing at
https://github.com/rich-rees/zero-drift-docs/issues, labelled `finding`.

## Upgrading to 2.0 ("choose patterns")

- `render` writes a fifth artifact, `zdd/blessing-index.md`. Commit it in the
  upgrade PR, or `render --check` fails.
- The workflow's lint step becomes `lint --merge` (an owned workflow is
  migrated in place; another shape is named for the user to change by hand),
  so CI fails while a branch's `zdd/patterns-plan.md` exists.
- A blessing that does not open with its **trigger question** now **fails**
  `lint`. Propose the questions as **one reviewable file** (each blessing
  lint names, with the question it would answer, one line each), approved in
  one pass — never one question per blessing; change the map only on the
  user's word, in the upgrade PR.

## Upgrading to 2.1 (the front end, jobs and services)

- Four **opt-in** extractors — `components`, `expo-router`, `jobs`,
  `services` (called `external-services` from 2.3) — are offered by the plan with the detection evidence for this
  repo (step 4). Services are guessed by name: confirm or rename each, and
  ask which prefixes are not a service. Say the limit plainly: a service's
  `usedBy` is the files carrying its marker, never those reaching the
  provider through a settings object.
- `subscribes` edges: the Supabase client's own `.on("postgres_changes")`
  needs nothing; a wrapper must be named in `subscribeCalls` (step 4).
- A `*` in a scanned url no longer matches a fixed route segment: expect a
  `derive --check` diff on the bump; lint names the calls it could not place.
- With `claims.strict` on, `claims.strictKinds` decides whether the new kinds
  are governed; unlisted, they warn and never fail (decision 0017).
- 2.1.1 moves bytes where its fixes apply (schema-qualified tables,
  component descriptions, service links): re-derive and re-render.

## Upgrading to 2.2 (the guided upgrade)

- **The lock.** A repo bootstrapped before 2.2 may float with no lock; the
  plan says so, and step 2 asks. Locked, every developer runs the same
  release and the next upgrade starts at step 1.
- **The instruction block** gains the rules every adopter needs (a release or
  skew line leads the reply; generated-file conflicts are merged, committed,
  then regenerated; "update ZDD" is never delegated; a joining developer's
  install). Sections the adopter hand-wrote for the same rules are named in
  the plan — this is the release where most repos have some.
- **From a release before 2.2** there is no step 1 yet: the README's
  one-time hand step moves the lock (edit the ref, restart, run the commands
  the session-start line names, restart), then "upgrade ZDD" runs from step 2.
## Upgrading to 2.3 (plain words, the instructions file, external services)

- **The instructions file.** ZDD's rules move out of the marked block in
  `CLAUDE.md` into `zdd/instructions.md`, loaded by one line; the plan
  replaces the block with the line, once (step 2, point 2). `AGENTS.md`
  keeps a block. The text gains the rules this release's findings asked for:
  both install commands in order, the three cases a release line can mean,
  the merge-conflict steps, reuse-first in "choose patterns", and where a
  ZDD defect is filed.
- **External services.** The `services` extractor is now
  `external-services`, its records `external-service`: the plan renames the
  config keys, `claims.strictKinds` and the allow-list ids, and the map's
  links to the records; the next `derive` moves the records from
  `zdd/metadata/service/` to `zdd/metadata/external-service/`, so expect that
  in `derive --check` and the indexes in `render --check`. A hand-written
  `zdd/map/services/` folder is suggested for renaming, never renamed.
- **What git ignores is never source.** `derive` now skips every
  gitignored path (and `.claude/worktrees/`); a repo whose records named
  one sees those records change on the bump.
- **`.gitattributes`** gains one line pinning `zdd/` to LF, so Windows
  checkouts stop showing every generated file as modified.
- **Their own text** is read sentence by sentence against ZDD's rules, and
  retired names in their files are listed (step 2, points 4 and 5).

## Upgrading to 2.4 (the ZDD record)

- **Say it when ZDD changes a decision.** `zdd/instructions.md` (rewritten
  by this run) now asks the agent to print one `ZDD: …` line, at the moment
  and without stopping, whenever an artifact *turned* or *confirmed* a
  decision or showed code to *reuse* — with what would otherwise have
  happened. Reading is never a use, and nothing is said when nothing was
  used.
- **The ZDD record.** "update ZDD" writes those lines into the update
  commit's message as a `ZDD record:` with five sections (`glossary`,
  `adrs`, `blessings`, `map`, `comments`) in plain sentences; the `Pattern
  record:` it replaces is still read, as the blessings section. A squash
  merge loses the record unless the merger keeps the message; a merge
  commit keeps it.
- **The tally.** `zdd-engine tally [--since <ref|date>] [--json]` counts,
  per section, how often an artifact turned, confirmed, was reused or
  stored, then names the ADRs, glossary terms and blessings in the stores
  that no record ever named.
- **`lint --merge` warns, never fails,** on a record it cannot fully read.
  No config-schema or metadata-contract change; `derive --check` and
  `render --check` do not move on the bump.
