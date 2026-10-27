# 0038 — A job record is platform-free; one small reader per platform file

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, question 3 of the design session on 2026-10-27 (Rich's call: "do we really care whether it's on Cloudflare or Railway?"). **Extends** [0020](0020-jobs-from-manifests-services-from-declared-markers.md) and [0025](0025-background-work-is-what-runs-without-a-click.md): jobs still come from committed manifests and "background work is what runs without a click"; the manifests are read by one adapter each.

## Context

One `jobs` extractor read six kinds of file: `vercel.json` crons, Railway's
`railway.toml` / `railway.json`, a `Procfile`, Cloudflare's
`wrangler.toml`, Compose files, and the `package.json` scripts they point
at. What a reader needs is "this runs every night at 3 a.m. and runs this
code". The platform is where it is hosted. But the 3 a.m. is written in the
platform's own file, and zero drift means reading the file that is the
truth.

## Decision

1. **A job record is platform-free:** what it is, when it runs
   (`schedule`), and which code it runs (linked to that file). The platform
   is a fact on the record (`source`), shown as metadata. Nothing in the
   core or a viewer treats one platform differently from another.
2. **One small reader adapter per platform file:** `jobs-vercel`,
   `jobs-railway`, `jobs-cloudflare`, `jobs-procfile`, `jobs-compose`.
   Detection (0039) turns on only those whose file is in the repo.
3. **What they share lives in `adapters/`**, never in the core: "is this
   background work?" (0025) and "which script does this command run?".
4. **Jobs declared by hand in config stay the fallback** for a platform with
   no reader yet. They drift when the platform file changes, which is why a
   reader is preferred.
5. **External services are unchanged:** they already ship no vendor list
   and are declared in the adopter's config (0020, 0023).

## Consequences

- A new platform is a new small adapter, often written at bootstrap.
- An adopter's config names the platforms in use (`"jobs-railway"`) where
  it said `"jobs"`. The upgrade rewrites it from detection, and repairs or
  names any map link to a job id that changed.

## Rejected

- **Keep one `jobs` adapter.** No work, one config line, but every platform
  stays bundled, and a new one means editing the shared file.
- **Declared jobs only, no platform readers.** Fully platform-free, but a
  cron added on the platform and not in config goes unseen: drift, which is
  the one thing ZDD exists to prevent.
