# 0020 — Jobs come from committed run manifests; services from declared markers; environment variable names are read from source, values never

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-97 (ZDD 2.1), from the grill on 2026-10-08, against Cascade's housekeeping sweep and outbound worker (Railway services) and its Sentry and Resend dependencies. **Superseded, in part, by [0023](0023-external-services-not-services-a-rename-that-moves-nothing-until-the-key-moves.md)** (2026-10-09): the extractor is `external-services` and the record kind `external-service`; how they are declared and read is unchanged.

## Context

Background work and external services were invisible: a reader of
Cascade's graph saw a request-response app. The code is there: a module
with an entry point, a package script that runs it, one file importing the
vendor SDK, settings reading `RESEND_API_KEY`. What is not in the repo is
the cron expression (Railway's dashboard) and the vendor's region and plan.
The engine must stay vendor-neutral and must never read a secret.

## Decision

1. **One kind, `job`,** for workers and scheduled jobs, told apart by
   `facts.mode`: `worker`, `scheduled`, or `unknown`.
2. **A job is found in a committed run manifest:** `package.json` scripts,
   a `Procfile`, `railway.toml` / `railway.json`. A script whose command
   runs a module as a process (`python -m <module>`, `node <file>`) is an
   entry point; dev servers and test runners are not. Which scripts count
   is tunable (`include` / `exclude`); an entry the manifests do not name
   may be declared by hand. The description is the module's docstring or
   leading comment, as a route's is its handler's.
3. **The mode is never guessed.** `scheduled` when a committed Railway file
   carries a `cronSchedule` for it (the schedule becomes a fact);
   `worker` when a manifest marks it so; else `unknown`, with a lint
   warning asking for a committed file or a `mode` override in config.
4. **A `service` is declared in config with its markers:**
   `{ "name": "Sentry", "imports": ["sentry_sdk"], "env": ["SENTRY_"] }`.
   The extractor draws `dependsOn` edges from every file that imports a
   marker package or reads a marker env name. Its `resource` is the file
   that declares the dependency (the import site; failing that, the file
   reading the env name), so the panel's link opens the code that makes
   the node true. A declared service with no hits is a lint warning.
5. **Candidates are proposed, never written unasked.** Bootstrap and the
   service extractor scan source for environment reads
   (`os.environ[...]`, `.get("X")`, `process.env.X`, `import.meta.env.X`)
   whose name ends in `_API_KEY`, `_DSN`, `_SECRET`, `_TOKEN` or `_URL`,
   grouped by prefix, skipping prefixes ZDD already knows as the database
   (`DATABASE_`, `SUPABASE_`) and any the adopter lists as ignored.
   Bootstrap proposes each as a service; lint warns on one no declared
   service covers. Imports are not a candidate signal: every real service
   needs a credential or an address, and imports mostly add libraries.
6. **Names only, from source.** The engine reads the text of committed
   code. It never opens `.env`, the process environment, a host's
   dashboard or a secret store, and the artifacts carry no value.

## Why / rejected alternatives

- **A hand-maintained job list.** The thing ZDD exists to avoid. Kept only
  as the override for a manifest that does not name something.
- **Jobs by code shape** (`__main__`, `asyncio.run`). Catches one-off
  scripts; the manifest is the repo's own statement of what runs.
- **A built-in vendor catalogue.** Zero setup and vendor opinion in the
  engine, going stale. Rejected; the signal shape ships, the names do not.
- **Services as facts on the modules that use them.** Loses the inbound
  question ("what depends on Sentry") only a node answers.

## Consequences

- Jobs and services are claimable kinds under
  [0017](0017-strict-claims-never-widen-on-an-extractor-opt-in.md).
- A job whose schedule lives only on a dashboard shows `mode: unknown` and
  a warning until the adopter commits a Railway file or states the mode;
  the schedule itself stays curated in the map when it is not in the repo.
- A service reached through a config loader the scan does not recognise is
  not proposed; the declared marker still works.
