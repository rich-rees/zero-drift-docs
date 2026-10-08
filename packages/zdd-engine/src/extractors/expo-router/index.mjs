// expo-router extractor — native screens from an Expo Router file tree
// (CAS-97 item 3, ZDD 2.1, EARLY: built against a fixture app, since no
// adopter had native screens yet). One convention: Expo Router's folder
// routing under `app/`, the same shape as Next.js's App Router and borrowed
// from that extractor — a file is a screen, `_layout` files are layouts,
// `(group)` folders are stripped from the URL, `[id]` and `[...rest]` are
// dynamic, `index` takes its folder's path, and a `+` file (`+not-found`,
// `+html`) is framework plumbing, not a screen. A platform-suffixed pair
// (`settings.ios.tsx` / `settings.android.tsx`) is one screen with both files.
//
// Records are `surface`s, like a web page, but a native screen and a web
// page can share a URL (`/jobs` on both apps is the point of "one map across
// apps"), so a screen's id is namespaced: `surface:native:/jobs`, titled
// `/jobs (native)`. Facts: `file` (screen | layout), `routeGroups`,
// `dynamicSegments`, `layouts` (the `_layout` files above it, root first —
// the guards and shells a screen sits behind), `platforms` for a pair. The
// description is the file's leading `//` comment, as in Next.js. Outbound
// refs — `api.get("/jobs")`, `fetch(...)`, `.from('x')`, `.rpc('x')` in the
// screen file — are emitted unresolved, with decision 0019's expansion.
// Options (extractorOptions["expo-router"]):
//   appDir        repo-relative Expo Router root (default "app")
//   srcAliasRoot  where the tsconfig `@/` alias points (default: appDir's
//                 parent) — reserved for one-hop imports; unused today
// Every file is read through `io` (decision 0010). A missing appDir is
// "nothing to inventory". Deterministic: same bytes in, same records out.

import { leadingComment } from "../nextjs/index.mjs";
import { scanApiCalls, scanDataCalls, moduleConsts } from "../react-router/index.mjs";
import { repoRelative } from "../../lib/paths.mjs";
import { slugify } from "../../lib/slug.mjs";

export const FACTS_KEY_ORDER = {
  surface: ["file", "routeGroups", "dynamicSegments", "layouts", "platforms", "edges"],
};
export const MAX_SOURCE_BYTES = 1024 * 1024;
export const NAMESPACE = "native";

const SCREEN_FILE = /^(.+?)(?:\.(android|ios|native|web))?\.(tsx|jsx|ts|js)$/;
const stripGroups = (segs) => segs.filter((s) => !/^\(.+\)$/.test(s));
const dynamicSegments = (segs) => segs.filter((s) => /^\[.+\]$/.test(s)).map((s) => s.replace(/^\[\.\.\.|^\[|\]$/g, ""));

export function derive({ repoRoot, options, io }) {
  void repoRoot;
  const diagnostics = [];
  const appDir = repoRelative(options.appDir ?? "app", "expo-router.appDir");
  if (options.srcAliasRoot !== undefined) repoRelative(options.srcAliasRoot, "expo-router.srcAliasRoot");

  const files = [];
  const walked = io.walk(appDir, (rel, name) => {
    if (SCREEN_FILE.test(name) && !/\.(test|spec|stories)\.[jt]sx?$/.test(name) && !name.endsWith(".d.ts")) files.push(rel);
  });
  if (!walked.exists) {
    diagnostics.push(`${appDir} not found — nothing to inventory`);
    return { records: [], diagnostics };
  }
  if (walked.truncated) diagnostics.push(`${appDir}: walk truncated (depth or entry budget) — the inventory under it is incomplete`);
  for (const s of walked.skipped ?? []) diagnostics.push(`${s.path}: ${s.reason}`);
  files.sort();

  // Group files into screens and layouts by their URL-shaped key; a
  // platform pair shares a key and becomes one record.
  const entries = new Map(); // key -> { kind, segs, files: [], platforms: [] }
  for (const rel of files) {
    const inApp = rel.slice(appDir.length + 1).split("/");
    const name = inApp.pop();
    const m = SCREEN_FILE.exec(name);
    const base = m[1];
    const platform = m[2] ?? null;
    if (base.startsWith("+")) continue; // framework plumbing
    if (base.startsWith("_") && base !== "_layout") continue; // a private module in the tree
    const kind = base === "_layout" ? "layout" : "screen";
    const segs = kind === "layout" || base === "index" ? inApp : [...inApp, base];
    const key = `${kind}:${segs.join("/")}`;
    const e = entries.get(key) ?? { kind, segs, files: [], platforms: [] };
    e.files.push(rel);
    if (platform) e.platforms.push(platform);
    entries.set(key, e);
  }

  const layoutsAbove = (segs) => {
    const out = [];
    for (let i = 0; i <= segs.length; i++) {
      const e = entries.get(`layout:${segs.slice(0, i).join("/")}`);
      if (e) out.push(...e.files);
    }
    return out;
  };

  const records = [];
  for (const [, e] of [...entries].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const urlPath = e.kind === "screen" ? "/" + stripGroups(e.segs).join("/") : "/" + [...e.segs, "_layout"].join("/");
    const path = urlPath === "//" ? "/" : urlPath;
    const refs = new Set();
    let description = "";
    for (const rel of e.files) {
      const r = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
      if (!r.ok) {
        if (r.code !== "missing") diagnostics.push(`${rel} ${r.reason}`);
        continue;
      }
      if (!description) description = leadingComment(r.text);
      for (const p of scanApiCalls(r.text)) refs.add(`?route:${p}`);
      const data = scanDataCalls(r.text, moduleConsts(r.text));
      for (const n of data.from) refs.add(`?from:${n}`);
      for (const n of data.rpc) refs.add(`?function:${n}`);
    }
    const calls = [...refs].filter((x) => x.startsWith("?route:")).sort();
    const reads = [...refs].filter((x) => !x.startsWith("?route:")).sort();
    const facts = {
      file: e.kind,
      routeGroups: e.segs.filter((x) => /^\(.+\)$/.test(x)),
      dynamicSegments: dynamicSegments(e.segs),
      layouts: e.kind === "screen" ? layoutsAbove(e.segs) : layoutsAbove(e.segs.slice(0, -1)).filter((f) => !e.files.includes(f)),
    };
    if (e.platforms.length) facts.platforms = [...new Set(e.platforms)].sort();
    const edges = {};
    if (calls.length) edges.calls = calls;
    if (reads.length) edges.reads = reads;
    if (Object.keys(edges).length) facts.edges = edges;
    records.push({
      kind: "surface",
      id: `surface:${NAMESPACE}:${path}`,
      title: `${path} (${NAMESPACE})`,
      description,
      resource: [...e.files].sort(),
      refs: [...refs].sort(),
      facts,
      filename: `${NAMESPACE}--${slugify(path)}.json`,
    });
  }
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!records.length) diagnostics.push(`no screens under ${appDir} — nothing to inventory`);
  return { records, diagnostics };
}
