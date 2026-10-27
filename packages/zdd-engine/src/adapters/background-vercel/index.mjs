// background-vercel — Vercel crons from vercel.json (decision 0038): one
// scheduled task per `crons` entry, calling its route (a `calls` edge).
// A cron is named by its route's last segment; two routes that end alike
// (`/api/a/run`, `/api/b/run`) are named by the whole route (CR-510).
// Options (extractorOptions["background-vercel"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, slug } from "../background/shared.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-vercel", { io, options });
  for (const rel of r.walk((_rel, name) => name === "vercel.json")) {
    const text = r.read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      r.diagnostics.push(`${rel}: not JSON — skipped`);
      continue;
    }
    const crons = (Array.isArray(j?.crons) ? j.crons : []).filter((c) => c && typeof c.path === "string" && typeof c.schedule === "string");
    const last = (route) => route.split("/").filter(Boolean).pop() ?? "cron";
    const counts = new Map();
    for (const c of crons) {
      const l = last(c.path.split("?")[0]);
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    for (const c of crons) {
      const route = c.path.split("?")[0];
      const name = counts.get(last(route)) > 1 ? slug(route.split("/").filter(Boolean).join("-")) : slug(last(route));
      r.add({ name, command: `GET ${route}`, manifest: rel, dir, schedule: c.schedule, trigger: "cron", target: route, source: "vercel", routeRef: route });
    }
  }
  return r.finish();
}
