# 0037 — Routes reach tables through a data-access record, joined on file and function

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, questions 1 and 2 of the design session on 2026-10-27 (Rich's calls). **Extends** [0001](0001-composed-extractors.md) point 2: refs still resolve after the merge; the core now also follows a chain of them. **Supersedes** ZDD-2 part 1, which proposed raw-SQL and one-hop call scanning inside the `fastapi` extractor.

## Context

A route or screen adapter knew one data-access convention, the Supabase
client's, because it scanned its own handler bodies for `.from("x")`,
`.table("x")` and `.rpc("x")`. An API on SQLAlchemy with raw SQL in
repository modules (`app/repositories/jobs.py`, called as
`jobs.get_job(conn, …)`) got routes with `"refs": []` and no route → table
edge at all. Adding a second ORM to the route adapter would fix one stack
and leave the next in the same place. The contract also let no adapter add
refs to a record another adapter minted.

## Decision

1. **Data access is its own adapter.** A data-access adapter (`supabase-js`,
   `supabase-py`, `sqlalchemy`, a local `prisma`, …) emits one record per
   function whose body touches the database, keyed by **file + function
   name**, with refs to the tables, buckets and functions it reaches
   (`?from:` / `?table:` / `?function:`, resolved as before).
2. **A route or screen adapter records structure, never data access.** For
   each route it records the handling function (file + name) and the
   functions that handler calls, as the language's own imports resolve
   them; an ambiguous target is skipped, never guessed. It holds no
   database convention.
3. **The core joins and follows.** After the merge, the core matches a
   route's handler and its calls to data-access records on file + function
   name, and follows the chain to the tables. The route gains those
   tables in `refs` and route → table edges in the graph. The data-access
   records stay in the graph as their own nodes. Inline data access (a
   handler calling `.table()` itself) is the same case: the handler *is*
   the data-access function.
4. **Supabase comes out of every route and screen adapter now**: `nextjs`,
   `react-router`, `expo-router`, `components`, `jobs` (the `background-*`
   readers, 0038) and `fastapi`. Their
   client scans move into `supabase-js` and `supabase-py`.

## Consequences

- Each adapter knows one thing: swap SQLAlchemy for Prisma and the route
  adapter does not change.
- Adopters' graphs change shape on the move to 0.9: new data-access nodes,
  the same tables, and route → table edges where there were none. The move
  checks it together (0039).
- The chain-follow is a new core step and a pure function of the merged
  records, so `derive --check` stays deterministic.

## As built (ZDD-3 slice 2)

- **The record** is kind `data-access`, shown as "Data Access" in a lane of its
  own between the API and the tables (an empty lane takes no space). Its id is
  namespaced by the adapter that minted it,
  `data-access:<adapter>/<file>#<function>`, as a table is `table:db/<name>`,
  so two adapters that read one function mint two records. It is not a
  claimable kind: no new unclaimed-record warning, no new lint failure.
- **The join** is a new unresolved ref, `?code:<file>#<function>`, which
  reaches every data-access record for that file and function. A miss is
  silent: most functions touch no database.
- **Absorbed or kept.** A data-access record whose every referrer holds its
  file is absorbed into them (a handler's own body); one reached from any
  other file stays as a node. So a stack whose data access is inline reads
  exactly as before: the FastAPI golden is byte-identical with `supabase-py`
  added to its config. One hop: a data-access record's own `?code:` refs are
  not followed.
- **Python functions** are cut once, in `adapters/python/` (a helper folder,
  not an adapter), so `fastapi`, `supabase-py` and `sqlalchemy` agree on a
  function's text: a `def` at any indent and the lines indented deeper.
- **Within a file, functions are followed by reference; across files, one
  hop.** A function reaches the same-file functions it refers to by name —
  called, or passed as a callback (`_write(engine, work)`) — as far as they
  go, once each; a nested def is its own function, named by its full path
  (`_add.work`, so two helpers' nested `work` callbacks are two functions),
  counted toward its outer one only when the outer refers to it. Both sides apply the rule: a route
  reaches its handler's helpers, and a data-access record carries the SQL of
  the same-file functions it uses. A function in another file is one hop. A
  name a function binds itself (a parameter, a plain local) shadows the
  import of that name. FastAPI's walk is bounded (MAX_REACH functions).
- **A multi-line signature no longer empties a body.** A `def` whose
  signature runs over several lines and closes at the def's own indent
  (`) -> dict:`) used to read as an empty body, losing its calls and its
  docstring. The body now starts after the signature (on one adopter: 9 more
  routes gained their description).
- **FastAPI follows the file's imports** for the functions a handler calls,
  and now for `include_router(<mod>.router)` too: `from app.routes import
  jobs` names `app/routes/jobs.py` even when a repository module shares the
  basename. The basename rule runs only when the imports do not settle it.
- **`sqlalchemy` reads raw SQL only**: a string literal holding SELECT,
  INSERT, UPDATE, DELETE or WITH. SQL comments, single-quoted SQL literals and
  the arguments of EXTRACT / SUBSTRING / TRIM / OVERLAY / POSITION are blanked
  first; then the relations after FROM (a comma list) and JOIN (`reads`), and
  after INTO / UPDATE / DELETE FROM (`writes`), past ONLY and LATERAL, quoted
  part by part (`public."jobs"`); a CTE's name is not a table, and a name
  followed by `(` after FROM is a function. Each is a `?table:` ref the
  resolver keeps only when the schema adapter minted it. The ORM is not read.
- **The Python text rules are one lexer** (comments, strings, raw-string
  escapes, f-string expressions kept as code), so a `def` or a call inside a
  docstring is never one; a one-line function keeps its suite; a docstring's
  summary may sit on the line after the quotes and may hold an apostrophe.
  Malformed input stays linear (a signature that never closes is its def
  line after a bounded scan).
- **Every Python adapter reads through `io`**, FastAPI included: never a
  symlink, never past the size caps, so a route and the data-access records
  for its code see the same files.
- **Not read, and said so:** SQL held in a module-level constant (a listing
  spec passed to a generic pager) and a table name chosen at run time
  (`from public.{table}`). On one adopter's API this leaves 17 of 70 routes
  unlinked, most of them health, docs and static lists; following
  `module.CONSTANT` as functions are followed is a possible later step.
- **A lost link warns.** When the schema has tables, routes name their code
  and no data-access adapter is configured, every derive prints a
  `WARNING [data-access]` saying so: an old `["supabase", "fastapi"]` config
  is never quietly emptied of route → table edges.
- **An unresolvable router import mounts nothing.** When `<mod>` in
  `include_router(<mod>.router)` is imported but resolves to no single
  scanned file, the router is not mounted (a diagnostic says why), rather
  than falling back to another file of that basename.

## Rejected

- **One adapter writes refs into another's records** (the data-access
  adapter adds `jobs` to route `/jobs`). Simpler, but to know which route
  calls which repository function the data-access adapter would have to read
  the route framework's handlers: the coupling this removes.
- **Keep the Supabase scans in the route adapters and use the middle record
  only for new data-access adapters.** Less work and no change for current
  adopters, but two ways to do one thing forever, and the route adapters go
  on assuming a database.
