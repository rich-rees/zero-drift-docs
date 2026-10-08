# 0019 — A variable path segment matches a route parameter, never a fixed word; a literal union expands; otherwise no edge and a lint line

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-97 (ZDD 2.1) item 1, raised in CAS-62 when Cascade's `/admin/suppliers` carried 39 route refs including `/health`. **Supersedes, in part:** [0011](0011-refs-err-toward-might-touch.md) decision 1: a `*` standing on a literal route segment is no longer a ranked guess; it is not a match. The rest of 0011 stands.

## Context

`` api.get(`/${plural}`) `` reads as `/*`, and the resolver let `*` match
any segment, literal or parameter, ranking literal hits lower but keeping
them when nothing better existed. So `/*` matched every one-segment route,
and `/*/*/*` every three-segment one. 0011 chose "might touch" for ties
among parameters; it was never meant to let a wildcard eat `/health`.

## Decision

1. **`*` matches only a parameter segment** (`{id}`, `[id]`, a catch-all).
   A route whose segment at that position is a fixed word does not match.
2. **A literal union expands.** Where the variable's TypeScript type is a
   union of string literals declared in the same file, or it is a function
   parameter typed as one, the call becomes one url per literal:
   `/${plural}/${id}` with `plural: "suppliers" | "carriers"` is
   `/suppliers/{id}` and `/carriers/{id}`. Resolution of the same-file type
   is textual, like the rest of the extractor.
3. **Otherwise, no edge.** A call that matches nothing under rule 1 emits no
   ref, and `derive --verbose` and `lint` name the file and the call.
4. **Both page extractors** (`react-router`, `nextjs`) apply rules 2 and 3;
   rule 1 is the resolver's, so every extractor emitting `?route:` gets it.

## Why / rejected alternatives

- **Keep the fan-out when expansion fails.** Fewer lost edges, and the wrong
  ones stay, which is the bug. Rejected.
- **Expand unions but let `*` keep matching fixed words.** Fixes Cascade's
  one call and leaves the mechanism. Rejected.

## Consequences

- Every adopter's graph changes on the pin bump that brings 2.1: refs drop
  wherever a wildcard had matched a literal. A `derive --check` diff,
  regenerated like any engine bump; the release notes say so.
- A missing edge is now a lint line, where before a wrong edge was a green
  check.
