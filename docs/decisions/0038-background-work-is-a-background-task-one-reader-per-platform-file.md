# 0038 — Background work is a "background task", platform-free; one small reader per platform file

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, questions 3 and 10 of the design session on 2026-10-27 (Rich's calls: "do we really care whether it's on Cloudflare or Railway?", and "job" means something else in an adopter's domain). **Extends** [0020](0020-jobs-from-manifests-services-from-declared-markers.md) and [0025](0025-background-work-is-what-runs-without-a-click.md): background work still comes from committed manifests, and is still "what runs without a click"; the manifests are read by one adapter each, and the record is renamed from `job` to `background-task`.

## Context

One `jobs` extractor read six kinds of file: `vercel.json` crons, Railway's
`railway.toml` / `railway.json`, a `Procfile`, Cloudflare's
`wrangler.toml`, Compose files, and the `package.json` scripts they point
at. What a reader needs is "this runs every night at 3 a.m. and runs this
code". The platform is where it is hosted. But the 3 a.m. is written in the
platform's own file, and zero drift means reading the file that is the
truth.

"Job" was also the record's name, and it collides with the domain of the
apps ZDD maps: in a delivery app a job is a run from a depot to a
destination, so `job:` records in the graph and the agent index read as the
business's word. The same collision renamed `services` to
`external-services` in 2.3 (0023). The name has to cover all three modes
0025 defines (scheduled, worker, queue), so "scheduled" alone will not do.

## Decision

1. **The record is a `background-task`,** shown as "Background Task" in the
   human index, with ids `background-task:<slug>`. It is platform-free:
   what it is, its mode (scheduled, worker, queue), when it runs
   (`schedule`), and which code it runs (linked to that file). The platform
   is a fact on the record (`source`), shown as metadata. Nothing in the
   core or a viewer treats one platform differently from another.
2. **One small reader adapter per platform file:** `background-vercel`,
   `background-railway`, `background-cloudflare`, `background-procfile`,
   `background-compose`. Detection (0039) turns on only those whose file is
   in the repo.
3. **What they share lives in `adapters/`**, never in the core: "is this
   background work?" (0025) and "which script does this command run?".
4. **Background tasks declared by hand in config stay the fallback** for a
   platform with no reader yet. They drift when the platform file changes,
   which is why a reader is preferred.
5. **External services are unchanged:** they already ship no vendor list
   and are declared in the adopter's config (0020, 0023).

## Consequences

- A new platform is a new small adapter, often written at bootstrap.
- An adopter's config names the platforms in use (`"background-railway"`)
  where it said `"jobs"`. The record kind, ids and metadata folder move from
  `job` to `background-task`. The upgrade rewrites config from detection,
  and repairs or names every map link to an old `job:` id. Before 1.0 this
  costs nothing: no outside adopter depends on the name.
- Lane and display tables in the core change one entry ("Job" becomes
  "Background Task").

## As built (ZDD-3 slice 3)

Three questions settled on 2026-10-27, Rich's calls:

- **One task seen by two readers is one record, and the core joins it.**
  A Procfile line names a process and a Railway file states its schedule; a
  task declared by hand and a Railway file run the same thing. After every
  reader has run, the core (`src/core/lib/background-tasks.mjs`) merges
  `background-task` records that run **the same command from the same
  folder** (the shape that survives when the code is build output nobody
  commits), or **the same code file when one of them is a process** — a
  queue or a schedule declared in the code a process runs. Two
  declarations in one file that no process runs (two Trigger.dev tasks in
  one module) stay two tasks. The rule names no platform. One record names
  the task: a process (a command a manifest or a declaration runs) before a
  queue or a schedule declared in its code, and either before a record a
  reader marks as describing how a task is deployed (Railway's). The others
  join it: their files are added to its resources, their refs and edges
  united, a schedule, trigger, target, queue or description it lacks taken.
  A task whose command names no file in the repo is dropped with its
  reader's warning, unless another reader names it. Two tasks left with one
  name are two tasks: the first is kept, the second named in a diagnostic.
- **One reader per convention, eleven of them.** The five platform files
  (`background-vercel`, `background-railway`, `background-cloudflare`,
  `background-procfile`, `background-compose`), plus `background-pg-cron`
  (`pg_cron` in SQL migrations; `source` is `pg_cron`, the mechanism, where
  it said `supabase`), one per queue library (`background-bullmq`,
  `background-inngest`, `background-trigger-dev`, `background-sqs`), and
  `background-github-actions`. None of the two adopters uses a queue library
  today; they ship because a new adopter may.
- **Each reader owns its options.** `background-declared` holds the tasks
  declared by hand (`entries`, `jobs.entries` before). Every reader takes
  `roots`, `exclude` and `modes`. The "no stated mode" lint now names the
  option on the reader that read the task,
  `extractorOptions["background-procfile"].modes["nightly"]` (CR-010, from
  slice 1): a record carries its
  `reader`. Listing `background-github-actions` is its opt-in
  (`includeGithubActions` before).

- **Each reader walks on its own io, and the total is bounded** (slice 3
  review CR-086, settled in slice 4). derive gives every extractor a fresh
  io, so each listed reader walks its `roots` under its own caps (50,000
  entries, 64 MiB of reads, never a gitignored path or a build folder):
  the cost is at most the readers listed times those caps. Detection
  (decision 0039) proposes only the readers a repo has evidence for —
  the first adopter two, the second adopter one — and on those repos derive took 2.3 s and
  1.2 s; with all eleven readers listed, 4.9 s and 2.6 s. Narrowing a
  reader's `roots` is the lever for a repo where it matters.

What they share lives in `adapters/background/` (a helper folder): the
command parser, the script and module resolution, the small format readers,
and the reader that turns candidates into records.

- **What moves.** The kind, ids and folder move from `job` to
  `background-task`; "Job" becomes "Background Task" in the viewer's lane
  and palette (the human-index goldens move by that key alone). A queue
  whose consumer a process runs is now that process's task, not a second
  one named after the queue: on the engine's fixture, the Compose
  `transcoder` and the BullMQ `video-transcode` it consumes are one task.
  `jobs` is a retired name (`catalogue.json`): a config that still lists it
  stops derive with the readers to list instead. Bootstrap proposes one
  reader per kind of file it finds; "upgrade ZDD" replaces `jobs` with the
  readers detection finds (plus `background-declared` and
  `background-github-actions` when the old options asked for them), moves
  `roots` to every reader (each walks it), `exclude` / `modes` to the
  process readers, and `entries` / `modes` to `background-declared`; a
  reader whose options already exist must agree, else the upgrade stops,
  and so it does when no reader can be named (detection failed or found
  nothing) rather than leave `jobs` with no reader in its place. It renames `job` in `claims.strictKinds` and the
  allow-list, and repairs the map's `metadata/job/` links. The 0.9
  upgrade notes are slice 6's.

## Rejected

- **Keep one `jobs` adapter.** No work, one config line, but every platform
  stays bundled, and a new one means editing the shared file.
- **Declared background tasks only, no platform readers.** Fully
  platform-free, but a cron added on the platform and not in config goes
  unseen: drift, which is the one thing ZDD exists to prevent.
- **"Scheduled job".** Clear for crons, but workers and queue consumers are
  not scheduled, and it keeps the word that collides.
- **Keep `job` and let each adopter relabel the display.** It solves any
  clash for any word, but only in the human index: the records, ids and
  agent index still say `job:`, and agents are where the confusion bites.
