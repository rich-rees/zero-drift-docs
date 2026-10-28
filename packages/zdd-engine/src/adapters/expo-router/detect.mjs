// Detection for the expo-router adapter (decision 0039): a `_layout` file
// under an `app/` folder (Next.js's is `layout`). An `expo` dependency with
// no tree yet names the Mobile application and proposes nothing.

import { JS_SKIP_DIRS, packageDeps } from "../js/detect.mjs";

export const DETECTION = {
  parts: ["screens"],
  order: 60,
  optIn: true,
  optionShape: { paths: ["appDir", "srcAliasRoot"] },
  skipDirs: JS_SKIP_DIRS,
  // An EXPLICIT Expo Router entry selects the adapter (at its future app
  // folder); a bare "Expo" is the Application alone.
  stack: [
    { rank: 40, match: "expo.?router", options: { appDir: "app" }, path: ["appDir"], app: "Mobile (Expo)" },
    { rank: 50, match: "expo|react.?native", app: "Mobile (Expo)" },
  ],
  example: { options: { appDir: "mobile/app" } },
};

export function detect({ scan }) {
  const appDirs = new Set();
  for (const f of scan.files) {
    if (!/^_layout\.(tsx|jsx|ts|js)$/.test(f.name)) continue;
    const segs = f.dir.split("/");
    const app = segs.lastIndexOf("app");
    if (app !== -1) appDirs.add(segs.slice(0, app + 1).join("/"));
  }
  const dirs = [...appDirs].sort();
  const { root, nested } = packageDeps(scan);
  const dep = ["expo", "expo-router"].some((d) => root[d] || nested.has(d));
  if (!dirs.length && !dep) return null;
  const app = {
    name: "Mobile (Expo)",
    evidence: dirs.length ? `Expo Router tree at \`${dirs[0]}\`` : "`expo` in package.json",
    extractor: dirs.length ? "expo-router (proposed above)" : "expo-router — switched on by an `app/` folder with a `_layout` file (ZDD 2.1, early); map-only until then",
  };
  if (!dirs.length) return { apps: [app] };
  return {
    proposal: {
      evidence: [`Expo Router tree at \`${dirs[0]}\` (a \`_layout\` file)${dirs.length > 1 ? ` — also ${dirs.slice(1).map((d) => `\`${d}\``).join(", ")}; one appDir per extractor, confirm which` : ""}`],
      options: { appDir: dirs[0] },
    },
    apps: [app],
  };
}
