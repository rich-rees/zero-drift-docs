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
