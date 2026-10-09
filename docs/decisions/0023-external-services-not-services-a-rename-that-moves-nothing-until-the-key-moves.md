# 0023 — "External services", not "services": a rename that moves nothing until the config key moves

**Date:** 2026-10-09 · **Status:** accepted · **Origin:** CAS-103 (ZDD 2.3), pick 3 from DiO's move to 2.2.1 (DIO-335), and the slice 1 review's CR-302. **Supersedes, in part:** [0020](0020-jobs-from-manifests-services-from-declared-markers.md) (the extractor's and the record kind's names only — how services are declared and read stands) and [0017](0017-strict-claims-never-widen-on-an-extractor-opt-in.md) (the name of the third opt-in kind).

## Context

2.1 named the extractor `services` and its record kind `service`. On
PressPlay the word read as a code service layer; what the records are is
third-party systems the app depends on (Resend, ClickSend, Salesforce,
Google Places). The map's own vocabulary already said "External Service".

The rename touches three things an adopter's repo holds: the config key
(`extractors: ["services"]`, `extractorOptions.services`), the record kind
and its folder (`zdd/metadata/service/`), and the record ids the map's
links and the strict-claims allow-list name (`service:sentry`). This repo's
rule is that a metadata-contract break is a major. Rich's call was a minor.

## Decision

1. **The names are `external-services` (extractor) and `external-service`
   (kind, folder, id prefix).** A fresh install, and every adopter after
   "upgrade ZDD", uses them.
2. **The old name is an alias for one release, and under the alias nothing
   in the generated artifacts moves.** A config that still says `services`
   runs the same extractor, which then emits the *old* kind, folder and ids.
   An engine-only adopter who bumps the pin sees one diagnostic naming the
   rename and no diff in `derive --check`. That is what keeps 2.3 a minor:
   the contract moves only when the adopter moves the key.
3. **"upgrade ZDD" moves the key, and everything that names the kind with
   it, in one run:** the extractors list and the options key, every
   occurrence; `claims.strictKinds` and the `service:` ids in
   `claims.allowUnclaimed`; and the map's links to
   `metadata/service/<x>.json`, in every link form the render reads. The
   next derive then moves the records once, and the upgrade notes say so.
   Each step runs on its own, so a half-migrated config is finished
   whichever part is left.
4. **The adopter's hand-written map folder is theirs.** A fresh install
   names it `external-services/`; an existing `services/` folder is
   suggested for renaming and never renamed.
5. **The alias and the old kind leave in the next minor after 2.3**, with
   the retired-name sweep "upgrade ZDD" runs naming every file that still
   uses them.

## Consequences

- The engine knows two kinds for one release; `lint`, `render`,
  the resolver and the claims code accept both. A local extractor may take
  neither name.
- The schema lists both strict kinds and both option keys, the old ones
  marked deprecated; it cannot say "never both at once" (its validator has
  no `contains`), so the engine's refusal is the guard.
- A rename of this shape now has a recipe: alias the name, keep the old
  contract under the alias, migrate on the adopter's word, sweep the old
  name, retire it a release later.
