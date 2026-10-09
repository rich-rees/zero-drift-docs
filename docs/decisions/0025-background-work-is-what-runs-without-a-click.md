# 0025 — Background work is what runs without a click: found where the repo says it runs, never in a hand-run script

**Date:** 2026-10-09 · **Status:** accepted · **Origin:** CAS-103 (ZDD 2.3) pick 6, from CAS-101 finding 8 (PressPlay's Vercel cron was invisible on day one) and the 2.3 design session's decision 5. **Extends** [0020](0020-jobs-from-manifests-services-from-declared-markers.md): jobs still come from committed manifests, and the mode is still never guessed; the set of manifests grows, and a package.json script leaves it.

## Context

A reader of PressPlay's map saw a request-response app. Its real shape had a
Vercel cron sweeping stalled jobs every five minutes, a Railway worker
transcoding video, and a nightly GitHub Actions run — none of it visible,
because 2.1's jobs extractor read package.json scripts, a Procfile and
Railway files only. Meanwhile a hand-run `seed:snapshot` script *was* listed
as a job, which it is not. Vercel is common enough that missing its crons
misleads a large share of new users on their first day.

## Decision

1. **"Background work" is one area with three kinds of thing**, all
   `job` records told apart by `facts.mode`: **scheduled** (Vercel crons in
   `vercel.json`, a Railway `cronSchedule`, a Cloudflare worker's
   `[triggers] crons`, a Supabase `pg_cron` schedule in a migration, a
   Trigger.dev scheduled task), **workers** (a Railway start command, a
   Procfile line, a Docker Compose service with a job-shaped command), and
   **queues** (BullMQ, Inngest, Trigger.dev, SQS — the producer and the
   consumer, under the queue's name).
2. **Each record carries its trigger and what it hits**: the schedule or the
   queue, and the route (`calls` → `route:/api/cron/x`), the function
   (`calls` → `function:…`) or the module it runs. A queue's consumer file is
   its resource; its producers are `usedBy` edges. The map's agent index
   gets a *Background work* section listing each with both.
3. **GitHub Actions schedules are off by default**, an opt-in
   (`extractorOptions.jobs.includeGithubActions`), and when on they are
   listed apart under *Repo housekeeping*: they are the repository's upkeep,
   not the app a user touches. The definition of done's "(if enabled) the
   nightly appears" is this.
4. **A package.json script is a job only when a manifest runs it** (`worker:
   pnpm run worker` in a Procfile, a Railway or Compose command resolves
   through the nearest package.json to the module it runs). A script nobody
   runs as a process is a developer's tool and is not listed; bootstrap's
   detection no longer proposes the extractor on scripts alone.

## Consequences

- An adopter on 2.1 whose jobs came from package scripts alone sees those
  records leave on the bump, and the ones a manifest runs stay. The
  upgrade note says so.
- A Railway service folder's command is resolved from its folder up to the
  app root, so a service file beside the app finds the module it runs.
- Vercel Queues are not read yet: the API was not stable enough to pin a
  shape to on 2026-10-09; a finding is filed for it.

## Rejected

- **A separate `queue` kind.** One kind with a mode keeps the claims, the
  strict-kinds list and the viewer's lane unchanged; the queue's name and
  producers are facts.
- **GitHub Actions on by default.** Every adopter's index would carry the
  repo's CI as if it were the app.
- **Keep counting package scripts.** Frequency of a `node x.mjs` in scripts
  says nothing about whether it runs in production.
