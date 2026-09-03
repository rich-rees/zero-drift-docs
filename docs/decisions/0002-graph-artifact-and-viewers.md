# 0002 — The human index is a viewer over a graph artifact, and the Apache-derived viewer is isolated

**Date:** 2026-09-03 · **Status:** accepted · **Origin:** DIO-307 grilling (Q10: licence isolation), built under DIO-310.

## Context

v0.3.1's renderer built the map+metadata join in memory, decorated it with one viewer's concerns (palette, node sizes, the embedded store copies) and substituted it straight into that viewer's HTML template. The join — the only genuinely stack-neutral product of the pipeline — never existed on disk, so a second visualization meant editing the renderer; and the one viewer, derived from an Apache-2.0 proof-of-concept, sat in the engine's `src/` alongside MIT code with nothing but a notice file to mark the boundary. The renderer also bucketed unclaimed routes by `id.split("/")[2]`, which assumes a Next.js `/api/<area>/…` shape and put a FastAPI `/jobs/{id}` under the area `{id}`.

## Decision

1. **The join is an artifact: `zdd/graph.json`, schema `zdd-graph/1`.** Nodes are every metadata record and every map concept (`id`, `layer`, `type`, `title`, `description`, `resource`, `tags`, `body`, plus `recordId` / `auth` where they apply); edges are every resolved ref and map link, deduped, no self-edges. Nothing viewer-specific is in it — no colours, sizes, layouts, embedded docs — so it is the same bytes whichever viewer renders it, and `render --check` verifies it like the other generated artifacts.
2. **The human index is produced by a viewer selected by name from a registry** (`src/viewers/index.mjs`), the output-end counterpart of the extractor registry. Config: `viewer: "<name>"` or `viewer: { name, ...options }`; an object without `name` — every pre-registry config — means the default, so no adopter's config changes meaning. A viewer exports `render({ graph, docs, changed, options, bundleName, repoBase }) → string`. There is deliberately no local viewer directory: a viewer is a registry contribution, and `minimal` is the worked example.
3. **The Cytoscape viewer is viewer #1 in its own folder, `src/viewers/cytoscape/`, with its Apache-2.0 notice.** The engine outside that folder imports nothing from it — the registry loads it by name and hands it the graph — so the engine core is purely MIT and the licence boundary is a directory, not a paragraph. The viewer rebuilds its private `BUNDLE` shape from the graph, byte-identical to what v0.3.1 embedded (pinned by `test/golden/human-index-bundle-*.json`).
4. **Route bucketing is stack-neutral.** An unclaimed route's area is its first path segment after the segments *every* route in the bundle shares — `/api` on a Next.js app, `/v1` on a versioned API, nothing on a bare FastAPI app. No framework's prefix is named in the engine. The viewer's display labels use the same rule.
5. **Source-derived text never reaches `innerHTML` unsanitised** (DIO-309 review CR-007). Descriptions, bodies and the store text are authored by whoever commits, and the hosted page must be safe regardless: the Cytoscape viewer routes every markdown parse through `safe-marked.js` (raw HTML escaped, `javascript:` / `data:` targets refused), the `minimal` viewer escapes everything, and the viewer contract in `CONTRIBUTING.md` names this alongside determinism.

## Consequences

- Engine 0.3.0 → 0.4.0: a new generated file and a new config key, both additive; old configs render as before. Adopters see one new file appear on their next `render` and commit it like the others.
- `paths.graph` joins the artifact paths; an adopter's CI check covers it with no workflow change (`render --check` grew, the command did not).
- A viewer that needs the store text embedded gets `docs` from the render context, not from the graph — the graph stays a graph.
- Two bytes of the v0.3.1 human index changed beyond the sanitiser: endpoint captions no longer special-case `api`, and the session-auth note no longer names Entra. Both were PressPlay-shaped text in a stack-neutral tool.

## Rejected

- **Putting the embedded docs and the palette into the graph** — simpler for the Cytoscape viewer, wrong for every other: the artifact would carry one viewer's choices, and a second viewer would have to ignore fields to consume it.
- **A `localViewerDir`, mirroring `localExtractorDir`** — the extractor case exists because conventions are per-repo; a visualization is not, and the only cost of contributing a viewer is a pull request. Reconsider if a forker actually asks.
- **Sanitising with a vendored DOMPurify** — a second Apache/MPL dependency in the viewer to solve a problem the markdown renderer's own hooks solve at the source; revisit if a viewer ever needs raw HTML pass-through.
- **Keeping `/api` as a named special case** — matches most Next.js apps and nothing else; the common-prefix rule gives the same answer there and the right one everywhere else.
