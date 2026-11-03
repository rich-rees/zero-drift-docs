// Test helper (not a test file): the starters as an app holds them once
// "upgrade ZDD" has copied them in (decision 0048 points 1 and 8): the
// engine runs no adapter of its own, so a repo derives only what its
// `localExtractorDir` holds. Every fixture here names `zdd/extractors` and
// holds nothing there: copyFixture puts every starter in the copy, as the
// upgrade would (the fixture is the app, the copy is the upgrade's). A test
// that builds its own repo calls placeStarters on it.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { moduleReach } from "../../zdd-engine/src/core/lib/suite.mjs";
import { fileURLToPath } from "node:url";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ADAPTERS = join(PKG, "adapters");
export const ENGINE = join(PKG, "..", "zdd-engine");
export const ENGINE_BIN = join(ENGINE, "bin", "zdd-engine.mjs");
export const LOCAL = "zdd/extractors";

// What an app gets of each starter: its folder, its tests and its suite
// fixture with it, without its preview example (the library's alone, read
// at bootstrap), and _shared/ whole.
const LIBRARY_ONLY = /^example$/;

const copyStarter = (name, to) => {
  const from = join(ADAPTERS, name);
  cpSync(from, join(to, name), { recursive: true, force: false, filter: (src) => !(dirname(src) === from && LIBRARY_ONLY.test(src.slice(from.length + 1))) });
};

// Every starter into `<repo>/zdd/extractors`, beside what is there (a file
// of the repo's own is never replaced). With `configure`, the repo's
// zdd/config.json gains localExtractorDir.
export function placeStarters(repo, { configure = false } = {}) {
  const to = join(repo, ...LOCAL.split("/"));
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(ADAPTERS).sort()) if (lstatSync(join(ADAPTERS, name)).isDirectory()) copyStarter(name, to);
  if (configure) {
    const p = join(repo, "zdd", "config.json");
    const config = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
    writeFileSync(p, JSON.stringify({ ...config, localExtractorDir: LOCAL }, null, 2) + "\n");
  }
  return to;
}

// A fixture copied to `to` as an app holds it: its files, and, where its
// config keeps its adapters in zdd/extractors, every starter there. A copy
// is placed fresh each time, so an edited starter is what the next test
// runs, and two test files never share a folder they write.
export function copyFixture(from, to) {
  const own = join(from, ...LOCAL.split("/"));
  cpSync(from, to, { recursive: true, filter: (src) => src !== own && !src.startsWith(own + sep) });
  const p = join(to, "zdd", "config.json");
  const config = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  if (config.localExtractorDir === LOCAL) placeStarters(to);
  return to;
}

// The `_shared/` files one starter's code and its own tests reach by their
// imports (the tests travel with it); never its fixture's or example's,
// which are sample repos, not code. The engine's `copy-set` is held to this
// (copy-set.test.mjs): it is what bootstrap copies into an app.
export function reachedShared(name) {
  const own = join(ADAPTERS, name);
  const code = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (lstatSync(p).isDirectory()) {
        if (!(d === own && /^(?:example|fixture.*)$/.test(n))) walk(p);
      } else if (n.endsWith(".mjs")) code.push(p);
    }
  };
  walk(own);
  const shared = join(ADAPTERS, "_shared") + sep;
  return [...new Set(code.flatMap((p) => moduleReach(p, ADAPTERS).files).filter((f) => f.startsWith(shared)))].sort();
}

// Every fixture folder of this suite: a folder under test/ holding a config.
export function fixtures() {
  const dir = join(PKG, "test");
  return readdirSync(dir)
    .filter((n) => n.startsWith("fixture") && existsSync(join(dir, n, "zdd", "config.json")))
    .sort()
    .map((n) => join(dir, n));
}
