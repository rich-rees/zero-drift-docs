// Detection for the fastapi adapter (decision 0039): files that build a
// `FastAPI()` app or an `APIRouter`; the scan roots are their top-level files
// or first path segments.

import { PY_SKIP_DIRS } from "../python/detect.mjs";

export const DETECTION = {
  parts: ["routes"],
  order: 30,
  optionShape: { pathLists: ["roots"] },
  exampleClaims: ["an API route: `../../metadata/route/things--_id.json`"],
  skipDirs: PY_SKIP_DIRS,
  stack: [{ rank: 10, match: "fastapi", options: { roots: ["api"] }, path: ["roots", 0] }],
  example: { options: { roots: ["api"] } },
};

export function detect({ scan }) {
  const pyRouters = new Map(); // dir -> { routers, apps }
  const roots = new Set();
  for (const f of scan.files) {
    if (!f.name.endsWith(".py")) continue;
    const text = scan.read(f.rel);
    if (text === null) continue;
    const routers = /\bAPIRouter\s*\(/.test(text);
    const app = /\bFastAPI\s*\(/.test(text);
    if (!routers && !app) continue;
    const cur = pyRouters.get(f.dir) ?? { routers: 0, apps: 0 };
    if (routers) cur.routers++;
    if (app) cur.apps++;
    pyRouters.set(f.dir, cur);
    roots.add(f.dir === "." ? f.rel : f.rel.split("/")[0]);
  }
  if (!pyRouters.size) return null;
  const ev = [];
  for (const [dir, c] of [...pyRouters.entries()].sort()) {
    if (c.apps) ev.push(dir === "." ? "`FastAPI()` app at the repo root" : `\`FastAPI()\` app under \`${dir}\``);
    if (c.routers) ev.push(`\`APIRouter\` under \`${dir}\``);
  }
  return { proposal: { evidence: ev, options: { roots: [...roots].sort() } } };
}
