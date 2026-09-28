# React Router in library mode

The web app declares its route tree in code (`apps/web/src/routes.tsx`), not
as a file layout, so a reader sees every screen and its guard in one place.

## Why / rejected alternatives

- A file-based router — the tree would be spread over folders and the guards invisible.
