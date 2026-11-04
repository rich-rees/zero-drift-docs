// What the JS adapters' detection shares (decision 0039): the package
// manifests in a repo, read once per scan.

// Folders that are never source in a JS repo: the detection scan skips them.
export const JS_SKIP_DIRS = ["node_modules", "dist", "build", "coverage"];

// The JS and TS files detection reads, never a test, story or declaration.
export const JS_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
export const JS_NOT_SOURCE = /\.(test|spec|stories|story)\.[cm]?[jt]sx?$|\.d\.ts$/;

// { root: deps of the root package.json, nested: dep -> first workspace dir
// declaring it (in path order), dirs: every nested package.json folder }.
export function packageDeps(scan) {
  return scan.memo("js:packageDeps", () => {
    const depsOf = (rel) => {
      const pkg = scan.json(rel);
      return pkg && typeof pkg === "object" ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } : {};
    };
    const root = scan.files.some((f) => f.rel === "package.json") ? depsOf("package.json") : {};
    const nested = new Map();
    const dirs = [];
    for (const f of scan.files) {
      if (f.name !== "package.json" || f.rel === "package.json") continue;
      dirs.push(f.dir);
      for (const d of Object.keys(depsOf(f.rel))) if (!nested.has(d)) nested.set(d, f.dir);
    }
    return { root, nested, dirs };
  });
}
