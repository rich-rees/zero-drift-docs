---
where: migrations/00002_things.sql (save_thing)
kind: extend
first-built-in: features/things
---

Saving a thing? Call `save_thing()` and extend it if a save needs more —
never write the things table directly, because the function is what logs the
change.
