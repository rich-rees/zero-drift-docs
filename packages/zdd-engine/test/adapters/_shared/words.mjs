// Shared by the test-only adapters, as `_shared/` is in an app: a copy of
// one adapter brings what it reaches here.
export const slug = (path) => path.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-") || "index";
