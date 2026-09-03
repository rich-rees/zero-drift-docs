# 0001 — Extractors are composed per convention, and refs resolve after the merge

**Date:** 2026-09-03 · **Status:** accepted · **Origin:** DIO-307 grilling (PressPlay ADR-0113 records the same grain decision from the adopter's side), built under DIO-309.

## Context

v0.3.1 shipped one monolithic adapter, `nextjs-supabase`, selected by a single `adapter` string in `zdd/config.json`. The first real adoption outside PressPlay is a greenfield FastAPI + Supabase + React + Expo repo. Under the adapter model that is a new bespoke adapter for every stack *combination* — and a Supabase migration replay written twice.

## Decision

1. **The unit is the extractor, and an extractor is one convention plus an options schema.** `supabase` reads SQL migrations; `nextjs` reads an App Router tree; `fastapi` reads decorated handlers; `generic` reads nothing. Config lists the ones in use — `extractors: ["supabase", "fastapi"]` — and the deriver runs them all into one metadata set. A stack combination is a config line, not a module.
2. **Refs resolve after the merge.** An extractor cannot see another extractor's records, so it emits what it *knows*: a resolved id when it minted the target itself (a table's FK to a table), and an **unresolved ref** — a string starting with `?` (`?from:things`, `?function:save_thing`, `?route:/api/things/*`) — when the target belongs to another convention. `src/lib/resolve-refs.mjs` resolves those against the merged set: misses are dropped with a diagnostic, self-refs dropped silently, and a record flagged `requireRefs` is dropped when nothing resolved (how a `module` record keeps its "a file that references something" meaning). Resolution is a pure function of the merged records, so composition stays deterministic.
3. **Selection is by name, never by path** — from the built-in registry or from the one `localExtractorDir` config may declare. That directory is the single sanctioned place config points at code: a one-off convention goes there instead of into a fork. Local names may not shadow built-ins.
4. **Missing source is "nothing to inventory", never an error.** A greenfield repo with only `zdd/config.json` derives and checks clean with empty metadata, and renders an agent index from the map alone. That is what lets ZDD be the first thing in a repo.
5. **The legacy `adapter` key keeps working.** `nextjs-supabase` expands to `[supabase, nextjs]` with `adapterOptions` split by key, byte-identical to the v0.3.1 output (pinned by `test/golden/`), with a deprecation note. The engine never rewrites an adopter's config; the planned `bootstrap --upgrade` (DIO-311, not yet built) will — until then the deprecation note says how to migrate by hand.

## Consequences

- Facts key orders merge per kind in config order, so two extractors emitting the same kind (both `nextjs` and `fastapi` emit `route`) share one filename space and one serializer. A record id or filename minted twice is a hard error, not a guess.
- `route` matching is one matcher for every convention: `[x]`, `{x}`, `*` eat one segment; `[...x]`, `{x:path}` eat one or more. The most specific pattern wins, ties by id.
- Engine version 0.2.0 → 0.3.0: additive config change, old config still valid, so a minor bump. Removing `adapter` would be the major.
- An unqualified `?function:` / `?bucket:` / `?from:` name that several namespaces share is **dropped with a diagnostic**, never resolved first-wins; an extractor that knows the namespace qualifies the ref (`?function:db/save`). Table names shared across namespaces are an error outright, as before.
- Every path in config — artifact paths, `localExtractorDir`, extractor path options, record `resource`s — must be repo-relative: no absolute path, no `..`. Refused up front rather than discovered as a read of a sibling checkout (review CR-003..006). Symlinks inside the repo are the adopter's own.
- Missing configured roots are still "nothing to inventory" but always say so in diagnostics; the committed metadata is what makes a mistaken prune visible (as deletions in the PR diff), so the engine does not try to guess "missing" from "not yet".
- Known ceilings, deliberately not engineered around at 0.3.0: route resolution is O(unresolved route refs × routes) and function-to-table refs are O(functions × tables × body length). Milliseconds at today's scale; index them when an adopter reports otherwise.
- Deferred to foodbank's first use: `react-router` and `expo-router` extractors; FastAPI auth derivation (dependencies are not readable without import resolution — the map says who may call what).

## Rejected

- **One adapter per stack combination** — the v0.3.1 shape; scales as the product of conventions.
- **Extractors resolving refs themselves via a shared lookup passed in** — makes extractor order load-bearing (the supabase extractor would have to run first) and every extractor aware of every other's id scheme. The `?` protocol keeps each extractor ignorant of the others.
- **Loading extractors by path from config** — config importing arbitrary code; the local directory gives the same escape hatch with the trust boundary at one declared folder.
