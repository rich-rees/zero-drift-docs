---
where: src/app/page.tsx
kind: copy
applies-to: apps/fixture-app
first-built-in: apps/fixture-app
---

Adding a page? Make it a thin wrapper over a component in `src/components/`,
as `src/app/page.tsx` does, because the component is what a test renders —
never logic in the page file.
