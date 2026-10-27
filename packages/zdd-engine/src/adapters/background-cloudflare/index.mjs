// background-cloudflare — a Cloudflare Worker's scheduled trigger from
// wrangler.toml (decision 0038): `[triggers] crons`, running the worker's
// `main` module's `scheduled()`.
// Options (extractorOptions["background-cloudflare"]): roots, exclude, modes — see
// adapters/background/shared.mjs (backgroundReader).

import { posix } from "node:path";
import { FACTS_KEY_ORDER, backgroundReader, parseToml, slug } from "../background/shared.mjs";
import { DETECTION_BASE, backgroundProposal, jobShaped, manifests } from "../background/detect.mjs";

export { FACTS_KEY_ORDER };

export function derive({ options, io }) {
  const r = backgroundReader("background-cloudflare", { io, options });
  for (const rel of r.walk((_rel, name) => name === "wrangler.toml")) {
    const text = r.read(rel);
    if (text === null) continue;
    const dir = posix.dirname(rel);
    const cfg = parseToml(text);
    const crons = Array.isArray(cfg["triggers.crons"]) ? cfg["triggers.crons"] : [];
    if (!crons.length) continue;
    const main = typeof cfg.main === "string" ? posix.normalize(posix.join(dir, cfg.main)) : null;
    r.add({ name: slug(typeof cfg.name === "string" ? cfg.name : posix.basename(dir === "." ? "worker" : dir)), command: main ? `scheduled() in ${main}` : "scheduled()", manifest: rel, dir, schedule: crons.join("; "), trigger: "cron", target: main ?? undefined, source: "cloudflare", file: main && r.exists(main) ? main : null });
  }
  return r.finish();
}

// Detection (decision 0039): the files that say this reader applies.
export const DETECTION = DETECTION_BASE;

export function detect({ scan }) {
  const hits = manifests(scan, (f) => f.name === "wrangler.toml")
    .filter(({ text }) => /^\s*crons\s*=/m.test(text))
    .map(({ rel }) => ({ manifest: rel, scripts: ["triggers.crons"], what: "schedules" }));
  return backgroundProposal("background-cloudflare", hits);
}
