---
name: upgrade
description: "\"upgrade ZDD\" — move a repo that already uses Zero-Drift Docs to a newer release, as one guided flow: checks for a newer release and moves the repo's lock on the user's yes (then a restart), or, on the release that is running, shows every file it will change, asks once, writes, regenerates, and lists what to commit. Also run when the user says bootstrap --upgrade."
---

# zdd:upgrade — "upgrade ZDD"

The adopter is **choosing** to upgrade, so this is a guided flow: say what is
coming, ask, then act. **`scripts/bootstrap.mjs` is the only writer** — you
run it, relay its ledger verbatim, and never hand-write a file it writes.

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

## Step 1 — is there a newer release?

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

- **The lock trails and the line says "no restart"** (this session already
  runs the newest release and the catalogue is there): ask **"Move this
  repo's lock to vX.Y.Z?"**; on yes run `upgrade --to=vX.Y.Z` (add `--lock`
  when there was no lock), relay its ledger, and **carry straight on to step
  2 in this session**.

- **A newer release exists, in Claude Code:** tell the user what it is, link
  its release notes as printed, and ask **"Move this repo to vX.Y.Z?"** — or,
  when the repo has **no lock**, **"Lock this repo and move it to vX.Y.Z?"**
  (decision 0021). On yes:

  ```
  node "$PLUGIN/scripts/bootstrap.mjs" upgrade --to=vX.Y.Z           # add --lock when there was no lock
  ```

  It checks the tag exists, then writes only the lock. Relay its ledger,
  then the route, word for word: **restart Claude Code; the first line of
  the next session names the commands that move this machine — run them,
  restart again; then say "upgrade ZDD" again.** Claude Code loads a new
  plugin version only at start, so the rest of the upgrade is the new
  release's own run. **Stop here** — this run is complete when the lock has
  moved and the user has the route.
- **A newer release exists, in Codex** (Codex reads no lock): ask **"Update
  ZDD to vX.Y.Z?"** On yes, the user updates the install from a terminal —
  `codex plugin marketplace upgrade zero-drift-docs`, then `codex plugin
  remove zdd@zero-drift-docs` and `codex plugin add zdd@zero-drift-docs` —
  starts a new session, and says "upgrade ZDD" again. **Stop here.**
- **No newer release**, or the user said no: continue at step 2 with the
  release that is running. If the repo already locks a newer release than
  this session runs, step 2 refuses and names the update — relay it.

## Step 2 — the plan

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade --plan
```

It writes nothing. Relay it verbatim: every file it **would change**, every
file it keeps, every note — the notes are this upgrade's changelog, a line
or two for each release the repo crosses, and the "Upgrading to X.Y" sections
below (for the releases that ask something of you) say what
each one asks of you — and every **section outside the ZDD block** it names.

For each named section, read it against the new block and tell the user, by
line, what the block now covers and anything in the section that
**contradicts** the block. The section is theirs; it is removed only on their
word.

Then ask **once**, covering all of it:

1. Write these changes?
2. If the plan says the repo has **no lock**: lock it to this release
   (recommended — decision 0021)?
3. If sections were named: which to remove (their ids)?

The step is complete when the user has answered all three.

## Step 3 — write

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade [--lock] [--drop=<ids>]
```

`--lock` only on a yes to question 2; `--drop=<id>,<id>` only with the ids
the plan printed for the sections the user chose (each id is a hash of the
section's text: if the section changed since the plan, the run refuses — show
the plan again). Relay the ledger verbatim. Its notes match the plan's.

## Step 4 — the questions the notes raise

Work through every note that asks something, one question at a time, each
recorded by the script, never by hand:

- **An opt-in extractor offered with evidence** (2.1): show the evidence and
  ask. On yes, a repair apply with the extractor added — `apply
  --answers=<file>` where the file is `{ "extractors": [<current…>, "<name>"],
  "extractorOptions": { "<name>": <options from the note> } }`. Repair mode
  keeps every other choice. Never add one the user did not confirm.
- **The Stop prompt is unset** (1.1): ask (default yes), record it with a
  repair apply `{ "optIns": { "stop": true } }` (or `false`).
- **Realtime wrappers** (2.1): ask whether the app subscribes through a
  wrapper; record the call names with a repair apply — `{ "extractorOptions":
  { "react-router": { "subscribeCalls": ["live.onInsert"] } } }`, or for
  Next.js `{ "extractorOptions": { "nextjs": { "refs": { "subscribeCalls":
  [...] } } } }`. Options merge into what is there; nothing else moves.

## Step 5 — regenerate, check, and list the commit

With the engine this plugin pins:

```
npx -y @rich-rees/zdd-engine@2.2.1 derive
npx -y @rich-rees/zdd-engine@2.2.1 render
npx -y @rich-rees/zdd-engine@2.2.1 lint
```

Show what moved in the generated artifacts and say why, from the notes (a
pin bump re-derives; the notes name the byte changes each release brings).
A red `lint` is the upgrade doing its job — the notes say which release
tightened what; fix it with the user in this PR.

The run is complete when you have listed every file to commit **in one PR**:
the ledger's changed files, the regenerated artifacts, and any repair-apply
changes. Close with the team's next step: after the PR merges, each
developer's next session start prints one line naming the commands that move
their machine — they run them and restart.

## Upgrading to 2.0 ("choose patterns")

- `render` writes a fifth artifact, `zdd/blessing-index.md`. Commit it in the
  upgrade PR, or `render --check` fails.
- The workflow's lint step becomes `lint --merge` (an owned workflow is
  migrated in place; another shape is named for the user to change by hand),
  so CI fails while a branch's `zdd/patterns-plan.md` exists.
- A blessing that does not open with its **trigger question** now **fails**
  `lint`. Show the user every blessing lint names and propose the question
  each one answers; change the map only on their word, in the upgrade PR.

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
