# 0036 — The core knows no stack; adapters live beside it, one convention each, loaded by name

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, the design session on 2026-10-27 (Rich's calls), from an adopter's FastAPI + SQLAlchemy API whose routes had no edges to tables. **Supersedes, in part:** [0010](0010-local-extractors-first-tier-engine-hands-them-io.md), the "registry" tier: the registry becomes the catalogue, a folder of adapters beside the core, not a list inside it. **Extends** [0001](0001-composed-extractors.md): an extractor is still one convention plus an options schema; it is now called an adapter, and the core never holds one.

## Context

The pipeline, the graph, the renderer and the viewer were already
stack-free: they know a neutral list of kinds (route, table, job,
component, …), and a route is an "API Endpoint" whether FastAPI or Next.js
found it. But every extractor shipped inside the engine package, stack
detection lived in `bootstrap.mjs`, and several extractors carried a second
convention welded in (the Supabase client's `.from()` / `.table()` /
`.rpc()` in six route and screen extractors; five hosting platforms in
`jobs`). A stack ZDD did not know — another ORM, another framework — had
nowhere clean to go, and the only answer on offer was another built-in.

## Decision

1. **The core knows no stack.** It holds the derive pipeline, the ref
   resolver, the graph artifact, render and the viewers, the stores
   (glossary, ADRs, blessings, map), lint, freshness and tally, the skills,
   and the adapter contract. No adapter, and no stack, framework, library,
   platform or vendor name, lives in it.
2. **One npm package, two folders.** The engine is split into `core/` and
   `adapters/`. A test fails if any file under `core/` imports from
   `adapters/` or names a stack. Adopters keep one pin and one CI line.
3. **The core loads every adapter by name,** the bundled ones and an
   adopter's local ones alike, so to the core the two are the same thing.
4. **The catalogue.** The bundled adapters are starting points, each in
   one folder holding its reader, its detection (0039), its options schema
   and its fixtures. A local adapter that has run against a real repo can be
   proposed into the catalogue (CONTRIBUTING).
5. **No name reuse.** A local adapter may not take a catalogue name. When a
   catalogue adapter almost fits, the extractor skill copies it into the
   adopter's `localExtractorDir` under a new name (e.g. `fastapi-acme`),
   with its fixtures and tests, and switches config to the copy in the same
   step.

## Consequences

- `adapters/` can become its own package later (`@rich-rees/zdd-adapters`,
  with the core keeping the main name) by moving the folder and publishing
  the helpers it imports. That happens when outside contributions or a
  separate release pace call for it, not before.
- A name always means the same code everywhere: "the `fastapi` adapter is
  wrong" is always ours, and upgrade can tell a catalogue adapter (updated
  by the release) from a copy (interviewed, and run through the suite —
  0040).
- A copy stops receiving catalogue fixes automatically; the standard suite
  and the upgrade interview (0040) are what reach it.

## Rejected

- **Separate packages now** (core plus one per adapter, or core plus one
  catalogue). The border becomes physical, but every adapter gets its own
  version and release, adopters carry several pins that must agree, and the
  helpers become a published API. Too much ceremony before anyone outside
  writes an adapter.
- **No catalogue: every adapter built at bootstrap.** Unlimited stacks, but
  every adopter's adapter becomes a private copy that no fix ever reaches,
  and the hard parsers (SQL replay, route-tree resolution) would be
  rewritten shallower each time.
- **Shadowing: a local adapter may take a catalogue name.** No config edit
  when switching, but the same name means different code in different
  repos, and upgrade cannot tell what it is looking at.
