# 0018 — A surface or component belongs to the app whose map page's `resource` path contains it; a shared one belongs to no app and is reached through "used by"

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-97 (ZDD 2.1), from the grill on 2026-10-08.

## Context

"One map across apps" needs every surface and component to say which app
it belongs to, so the viewer can colour and filter by app and show a web
page and a native screen calling the same endpoint. The obvious source is
new extractor config naming the app per root. But adopters already have
hand-written app pages (`zdd/map/apps/web.md`, `mobile.md`) each with a
`resource:` path, and two statements of the same fact drift.

## Decision

1. **Membership is derived from the map's Application pages.** A code
   record belongs to the app whose page `resource` is the longest path
   prefix of the record's file. The renderer adds a `belongsTo` edge
   ([0016](0016-typed-edges-are-additive.md)) from the record to that app
   node and the app's name as a tag on the node.
2. **A file under no app page's path belongs to no app.** A component in a
   shared package carries `apps: []`; the apps it serves are the set reached
   by its inbound `uses` edges. The viewer's app filter has one entry per
   app plus *shared*; a shared component shows under every app that reaches
   it and under *shared*.
3. **Nothing is guessed.** An Application page without a `resource`, or two
   whose paths nest, is a lint warning naming the files, and records under
   them stay unassigned.
4. **A React Native platform pair** (`X.web.tsx` beside `X.native.tsx`) is
   recorded as a fact (`platforms`), never as app membership.

## Why / rejected alternatives

- **Per-extractor `app` config.** Explicit, duplicated, driftable. Rejected.
- **The app whose pages import it.** Fails for a component nothing imports
  yet and for shared ones. Rejected.
- **A hand tag on a package page.** A second map page type for a fact the
  edges already compute. Rejected.

## Consequences

- An adopter who has bootstrapped has nothing to add: the app pages are
  already the human's statement of what the apps are.
- Membership is computed at render, not derive, because the map is the
  curated store and derive reads only code. Metadata records carry no app.
