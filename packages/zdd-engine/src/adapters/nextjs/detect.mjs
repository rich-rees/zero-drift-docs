// Detection for the nextjs adapter (decision 0039): an App Router tree
// (page/route/layout files under an `app` folder), or `next` in the root
// package.json with no tree yet (proposed at the convention's default).

import { JS_SKIP_DIRS, packageDeps } from "../js/detect.mjs";

export const DETECTION = {
  parts: ["routes", "screens"],
  order: 20,
  optionShape: { paths: ["appDir", "middlewarePath", "srcAliasRoot"], pathLists: ["refs.roots"], callLists: ["refs.subscribeCalls"], callName: "^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*$" },
  exampleClaims: ["an API route: `../../metadata/route/things.json`", "a page: `../../metadata/surface/things--_id.json`"],
  skipDirs: JS_SKIP_DIRS,
  stack: [{ rank: 30, match: "next(\\.js)?", options: { appDir: "src/app", apiPrefix: "/api" }, path: ["appDir"] }],
  example: { options: { appDir: "src/app", apiPrefix: "/api" } },
};

export function detect({ scan }) {
  let appDir = null;
  let middlewarePath = null;
  for (const f of scan.files) {
    if (/^(page|route|layout)\.(tsx|ts|jsx|js)$/.test(f.name)) {
      const m = /^(.*?(?:^|\/)app)(\/|$)/.exec(f.dir + "/");
      if (m && (!appDir || m[1].length < appDir.length)) appDir = m[1];
    }
    if (/^middleware\.(ts|js)$/.test(f.name) && f.rel.split("/").length <= 2) middlewarePath = f.rel;
  }
  const next = Boolean(packageDeps(scan).root.next);
  if (!appDir && !next) return null;
  const ev = [];
  if (appDir) ev.push(`App Router tree at \`${appDir}\` (page/route/layout files)`);
  if (next) ev.push("`next` in package.json dependencies");
  if (middlewarePath) ev.push(`\`${middlewarePath}\` present`);
  const options = { appDir: appDir ?? "src/app", apiPrefix: "/api" };
  if (middlewarePath) options.middlewarePath = middlewarePath;
  return { proposal: { evidence: ev, options } };
}
