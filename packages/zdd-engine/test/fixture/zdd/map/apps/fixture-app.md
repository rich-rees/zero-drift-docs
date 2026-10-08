---
type: Application
title: Fixture App
description: The fixture Next.js app the engine tests derive against.
resource: src
tags: [things]
---

A deliberately tiny Next.js App Router app: one feature, one wrapper page,
one hooks route pair, two migrations.

- [Things](../features/things.md)

# Blessings
- Adding a page? Make it a thin wrapper over a component in `src/components/`,
  as `src/app/page.tsx` does, because the component is what a test renders —
  never logic in the page file.
