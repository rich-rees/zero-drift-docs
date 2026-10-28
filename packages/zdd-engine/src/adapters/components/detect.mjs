// Detection for the components adapter (decision 0039): every .tsx/.jsx
// file, counted under its root — its nearest `src/`; without one, the
// nearest folder holding a package.json (a workspace app); without that, the
// top-level folder (or the repo root for a root-level file).

import { JS_SKIP_DIRS, packageDeps } from "../js/detect.mjs";

export const DETECTION = { parts: ["components"], order: 50, optIn: true, optionShape: { pathLists: ["roots"], paths: ["srcAliasRoot"] }, skipDirs: JS_SKIP_DIRS };

const MAX_FILES = 20_000;

export function detect({ scan }) {
  const packageDirs = [...packageDeps(scan).dirs].sort((a, b) => b.length - a.length);
  const counts = new Map();
  let seen = 0;
  for (const f of scan.files) {
    if (!/\.(tsx|jsx)$/.test(f.name) || /\.(test|spec|stories|story)\.[tj]sx$/.test(f.name)) continue;
    if (++seen > MAX_FILES) break;
    const segs = f.rel.split("/");
    const src = segs.lastIndexOf("src");
    const root = src !== -1 ? segs.slice(0, src + 1).join("/") : (packageDirs.find((d) => f.rel.startsWith(`${d}/`)) ?? (segs.length > 1 ? segs[0] : "."));
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const dirs = [...counts.keys()].sort();
  const capped = seen > MAX_FILES ? [`detection counted the first ${MAX_FILES} .tsx/.jsx files and stopped — a component root past them is not proposed; add it to roots by hand`] : [];
  return {
    proposal: {
      evidence: dirs.map((d) => `${counts.get(d)} .tsx/.jsx file${counts.get(d) === 1 ? "" : "s"} under \`${d}\``).concat(capped),
      options: { roots: dirs },
    },
  };
}
