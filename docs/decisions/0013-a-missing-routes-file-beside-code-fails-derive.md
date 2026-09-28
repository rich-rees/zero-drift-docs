# 0013 — A routes file missing beside existing code fails derive

**Date:** 2026-09-28 · **Status:** accepted · **Origin:** CAS-65, from Cascade's CAS-64 review campaign. With `routesFile` misspelt, derive wrote 24 records instead of 34, printed nothing without `--verbose`, and exited 0. Every check then passed on the smaller inventory.

## Decision

The `react-router` extractor stops `derive` with an error naming the file and
the setting in two cases:

- nothing exists at the configured `routesFile`, but its folder does (a
  rename or a typo);
- something exists there that is not a regular file inside the repo (a
  symlink, a directory, a path under a link), so it is never read.

When the folder does not exist either, the result is unchanged: "nothing to
inventory", a diagnostic, exit 0.

This is a narrow exception to the extractor contract's "missing source is
nothing to inventory". It covers the one file a whole record kind hangs
on, in a place where code already exists.

## Why / rejected alternatives

- **Fail whenever `routesFile` is set and missing** (the review's ask).
  Bootstrap writes `routesFile` ahead of the code on a greenfield repo that
  plans a React Router app. That repo would go red on day one, and "adopt
  before any code exists" is the adoption story. Rejected.
- **Print the diagnostic without `--verbose`, never fail.** It would be
  visible, but CI still passes after a rename and the inventory is still
  written away. Rejected.
- **Apply the rule to every extractor's source folders.** A missing
  migrations folder is ordinary greenfield. What makes this case dangerous
  is a single named file with code beside it. Rejected until another
  extractor has the same shape.

## Consequences

- Moving a routes file is now a two-line change: the file and
  `extractorOptions.react-router.routesFile`, in the same commit. Derive
  says so if only one moves.
- A routes file at the repo root (`routesFile: "routes.tsx"`) is never
  caught, because the root always exists. That's greenfield-shaped by
  construction, and accepted.
