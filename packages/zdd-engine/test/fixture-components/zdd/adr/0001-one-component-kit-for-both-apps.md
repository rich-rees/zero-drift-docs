# One component kit for both apps

The web and native apps share `packages/ui`, one file per platform where
they differ (`Button.web.tsx`, `Button.native.tsx`), so a screen and a page
render the same control.

## Why / rejected alternatives

- Two kits — the same button drifts twice.
