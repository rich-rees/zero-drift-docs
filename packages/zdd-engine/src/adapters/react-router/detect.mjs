// Detection for the react-router adapter (decision 0039): a route tree
// declared in code (the array form or the JSX form, in a file that imports
// react-router), or the dependency alone, proposed at the convention's
// default path inside the workspace package that declares it (CR-021).

import { repoRelative } from "../../core/lib/paths.mjs";
import { JS_NOT_SOURCE, JS_SKIP_DIRS, packageDeps } from "../js/detect.mjs";

export const DETECTION = {
  parts: ["screens"],
  order: 40,
  optionShape: { paths: ["routesFile", "srcAliasRoot"], callLists: ["subscribeCalls"], callName: "^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*$" },
  exampleClaims: ["a screen: `../../metadata/surface/things--_id.json`"],
  skipDirs: JS_SKIP_DIRS,
  // Only an EXPLICIT React Router entry selects the adapter (at its future
  // routes file); "React web", "Vite", "web" could be another router
  // (CR-014), so those name the Application alone.
  stack: [
    { rank: 60, match: "react.?router", options: { routesFile: "src/routes.tsx" }, path: ["routesFile"], app: "Web (React)" },
    { rank: 70, match: "react|web|vite", app: "Web (React)" },
  ],
  example: { options: { routesFile: "web/src/routes.tsx" } },
};

const DEPS = ["react-router", "react-router-dom"];

export function detect({ scan }) {
  const routesFiles = [];
  const skipped = []; // route trees at paths the engine would refuse (CR-009)
  for (const f of scan.files) {
    if (!/\.(tsx|jsx|ts|js)$/.test(f.name) || JS_NOT_SOURCE.test(f.name)) continue;
    const text = scan.read(f.rel);
    if (text === null) continue;
    if (/from\s*['"]react-router(-dom)?['"]/.test(text) && /\bcreate(?:Browser|Hash|Memory)Router\s*\(|:\s*RouteObject\[\]\s*=|<Route\b/.test(text)) {
      try {
        repoRelative(f.rel, "routesFile");
        routesFiles.push(f.rel);
      } catch {
        skipped.push(f.rel);
      }
    }
  }
  const { root, nested } = packageDeps(scan);
  const dep = DEPS.some((d) => root[d] || nested.has(d));
  const dir = DEPS.some((d) => root[d]) ? "" : (DEPS.map((d) => nested.get(d)).find(Boolean) ?? "");
  if (!routesFiles.length && !dep && !skipped.length) return null;
  const ev = [];
  if (routesFiles.length) ev.push(`route tree declared in \`${routesFiles[0]}\`${routesFiles.length > 1 ? ` (also: ${routesFiles.slice(1).map((f) => `\`${f}\``).join(", ")} — one routesFile per extractor; confirm which)` : ""}`);
  if (dep) ev.push(`\`react-router\` in ${dir ? `\`${dir}/package.json\`` : "package.json"} dependencies`);
  if (skipped.length) ev.push(`route tree at ${skipped.map((f) => `\`${f}\``).join(", ")} skipped — the path has whitespace or control characters the engine refuses; rename it`);
  if (scan.overBudget) ev.push("detection stopped reading source when its read budget ran out — confirm the routes file by hand");
  return {
    proposal: { evidence: ev, options: { routesFile: routesFiles[0] ?? (dir ? `${dir}/src/routes.tsx` : "src/routes.tsx") } },
    apps: [{ name: "Web (React)", evidence: routesFiles.length ? `route tree in \`${routesFiles[0]}\`` : dep ? "`react-router` in package.json" : `route tree at a refused path (\`${skipped[0]}\`)`, extractor: "react-router (proposed above)" }],
  };
}
