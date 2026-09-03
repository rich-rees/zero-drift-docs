# Contributing to Zero-Drift Docs

Thanks for wanting to help. ZDD is small on purpose, and the most valuable
contributions are the ones the architecture is built for — it has a plug-in point
at **both ends** of the pipeline: **extractors** feed data in (one per
convention), and **viewers** render it out (one per visualization), with a stable
graph in the middle.

> **Pre-1.0 note.** ZDD is `0.x`: private and still being proved against its first
> real codebases. The engine (`packages/zdd-engine`, on npm as
> `@rich-rees/zdd-engine`) is real and the extractor contract below is what it
> runs; the viewer registry is still on the roadmap. Once `1.0.0` ships this
> becomes a public on-ramp. Issues and discussion are welcome now.

## The shape of a contribution

Everything here goes through the standard GitHub loop:

1. **Fork** this repo to your own account.
2. **Branch** for your change (`extractor/rails`, `fix/hook-windows-path`, …).
3. **Commit** small, conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
4. **Open a pull request** back here. It's a proposal — we'll review, discuss, and
   merge if it fits. You keep authorship; the maintainer decides what lands.

A merged change ships to everyone via the marketplace on the next version bump
(a new extractor is backward-compatible, so a **minor** bump).

## The prize: writing an extractor

An **extractor** is the only per-stack code in ZDD. It teaches the deriver how to
read **one convention** — Supabase migrations, a Next.js App Router tree, FastAPI
decorators, a Rails `routes.rb`… — and emit the **codebase metadata**: the
mechanical inventory of routes, tables, surfaces, functions, and the references
between them. Adopters list the extractors for their stack in `zdd/config.json`
(`extractors: ["supabase", "fastapi"]`) and the deriver runs them all into one
metadata set — so a stack *combination* is a config line, never a new module
([decision 0001](docs/decisions/0001-composed-extractors.md)). Everything else
(the curated artifacts, the indexes, the ritual, the CI check) is stack-agnostic
and already done.

An extractor is a good contribution when it's **mechanical and deterministic**:

- It exports `derive({ repoRoot, options })` returning `{ records, diagnostics }`,
  plus a `FACTS_KEY_ORDER` map (per kind) so output is byte-stable. `options` is
  the adopter's `extractorOptions.<name>` object; document its schema in the
  module's leading comment.
- Each **record** has: `kind` (`route` | `table` | `surface` | `function` |
  `bucket` | `module` | `job` | …), `id`, `title`, a one-sentence `description`
  *where mechanically extractable*, repo-relative POSIX `resource` path(s),
  `refs` (outbound references discovered by static scan), `facts` (convention-
  specific key–values), and `filename` (the metadata file, unique per kind).
- **Refs to another convention's records are emitted unresolved.** Your extractor
  cannot see the others' records, so it emits a resolved id only for targets it
  minted itself, and a `?`-prefixed lookup for the rest: `?from:<name>` (a table,
  else a bucket), `?table:<name>`, `?bucket:<name>`, `?function:<name>`,
  `?route:<url>` (`*` = one wildcard segment). The deriver resolves them after the
  merge, drops misses with a diagnostic, and drops a record flagged
  `requireRefs: true` when nothing resolved (how a "module" record means "a file
  that references something"). See `src/lib/resolve-refs.mjs`.
- **Missing source is "nothing to inventory."** A configured root that does not
  exist yields no records and a diagnostic, never an error — greenfield repos
  adopt ZDD before any code exists.
- **Determinism is the contract:** same source bytes in ⇒ byte-identical metadata
  out. No LLM, no timestamps, no environment-dependent values — the blocking CI
  check depends on this. Anything needing judgment is *not* metadata; it belongs in
  the semantic map, which links down to your records.
- It's selected by **name** from config, never by path — from the engine's
  registry (`src/derive.mjs`), or from the adopter's declared `localExtractorDir`
  (`<name>.mjs` or `<name>/index.mjs`, the one place config may point at code;
  local names may not shadow built-ins). Try a convention there first; propose it
  for the registry once it has run against a real repo.

A stack without statically derivable structure keeps thinner metadata and a
larger semantic map — the *contract* is fixed, not the coverage. When in doubt,
model your extractor on `supabase` (replay from files), `nextjs` (a file-tree
convention with a refs scan) or `fastapi` (decorators, textual); `generic` is the
minimal worked example.

## The other prize: writing a viewer

The **human index** (`zdd/human-index.html`) is a rendering of the same graph the
extractors produce — nodes (metadata records + semantic concepts) and edges (the
references between them), each node carrying a `resource` path that becomes a
link back to the source on GitHub. It is *a* rendering, never *the* one: the spec
treats it as a machine product, and better visualizations are exactly the
extensibility the design reserved.

A **viewer** consumes the graph data model and produces a view. Because the boring
plumbing — node identity, edges, the GitHub source-links — is defined once in the
graph, viewers inherit all of it for free and compete purely on the visualization.

A viewer is a good contribution when it honours the viewer contract (the
equivalent of "determinism" for extractors):

- **Self-contained and safe to publish.** The human index gets *hosted* — a single
  self-contained file, no external network calls, and **no secrets**, safe to leak
  regardless of who sees it. A viewer that phones home or embeds a key is
  disqualified.
- **Consumes the documented graph schema** — it reads the published node/edge model,
  and never reaches around it into engine internals.
- **License-compatible libraries.** The reference viewer vendors its libraries with a
  license notice; anything you bring (D3, a framework, …) must carry a compatible
  licence and its notice.

How a viewer becomes part of the product: like extractors, viewers are selected by
config, so a merged viewer ships as a **selectable option** in the registry — a
minor version bump, live for everyone on the next marketplace update.

> As with the engine, the graph-data-model artifact and the viewer registry are on
> the roadmap (they land with the engine extraction). The *contract* above is
> stable; propose a viewer via an issue first and we'll pin the schema together.

## Other welcome contributions

- **Skills** — improvements to `orient` / `update` / `bootstrap`, or new ones that
  serve the ritual (not project-specific workflow — ZDD ships mechanism, not
  opinions about how *your* team plans work).
- **Engine** — determinism fixes, better ref resolution, the renderer, the checks.
- **Docs** — clearer setup, worked examples, fixing anything that misled you.

## What ZDD deliberately does *not* want

- **Docs content or rationale for a specific project.** The plugin ships the machine
  that makes `zdd/` folders — never anyone's glossary, ADRs, or map.
- **Workflow/process opinion** tied to a particular tracker, host, or CI vendor. Keep
  contributions stack- and tool-neutral.

## Ground rules

- Be kind and assume good faith. Reviews are about the code, never the person.
- Keep PRs focused — one logical change each.
- If you're proposing something big (a new artifact, a change to the ritual), open
  an issue first so we can agree the shape before you build it.

Questions? Open an issue. Thanks for helping keep documentation honest.
