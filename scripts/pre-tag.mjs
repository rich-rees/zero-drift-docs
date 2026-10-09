#!/usr/bin/env node
// The pre-tag dry run on the machine that tags (CAS-103, the process scope;
// decision 8 of its design session). CI proves the release on committed
// scenario fixtures with no secrets (plugins/zdd/test/dry-run.test.mjs);
// this script proves it against REAL adopter checkouts on this machine,
// as a regression check — never as the standard a new user is held to.
//
//   node scripts/pre-tag.mjs vX.Y.Z <adopter checkout> [<adopter checkout> …]
//
// For each adopter: a throwaway copy (no node_modules, no .git history
// beyond a fresh init), a fake `.claude/worktrees/` folder planted, then
// this checkout's plugin runs `upgrade --plan` and this checkout's engine
// runs derive, render and lint — exactly what the adopter's upgrade PR will
// do. Any failure names the adopter and the step. The repo's own pins are
// checked first (scripts/release-check.mjs), then both suites.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "plugins", "zdd", "scripts", "bootstrap.mjs");
const ENGINE = join(ROOT, "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const [tag, ...adopters] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: pre-tag.mjs vX.Y.Z <adopter checkout> …");
  process.exit(2);
}
const run = (label, cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" && /\.cmd$|^npx$|^npm$/.test(cmd) });
  const ok = r.status === 0;
  console.log(`${ok ? "ok     " : "FAILED "} ${label}`);
  if (!ok) {
    console.log((r.stdout + r.stderr).split("\n").slice(-40).join("\n"));
  }
  return ok;
};
let allOk = run("every pin names the tag", process.execPath, [join(ROOT, "scripts", "release-check.mjs"), tag], ROOT);
allOk = run("engine suite", process.execPath, ["--test", "test/*.test.mjs"], join(ROOT, "packages", "zdd-engine")) && allOk;
allOk = run("plugin suite", process.execPath, ["--test", "plugins/zdd/test/*.test.mjs"], ROOT) && allOk;

for (const adopter of adopters) {
  const src = resolve(adopter);
  if (!existsSync(join(src, "zdd", "config.json"))) {
    console.log(`SKIPPED ${src}: no zdd/config.json`);
    continue;
  }
  const copy = mkdtempSync(join(tmpdir(), `zdd-pretag-${basename(src)}-`));
  try {
    cpSync(src, copy, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.next|dist|coverage)([\\/]|$)/.test(p) });
    execFileSync("git", ["init", "-q"], { cwd: copy });
    execFileSync("git", ["add", "-A"], { cwd: copy, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=pretag", "-c", "user.email=pretag@local", "commit", "-q", "-m", "snapshot"], { cwd: copy, stdio: "ignore" });
    // The folder that bit DiO and Cascade: a second checkout inside the first.
    mkdirSync(join(copy, ".claude", "worktrees", "pretag", "src"), { recursive: true });
    writeFileSync(join(copy, ".claude", "worktrees", "pretag", "src", "planted.ts"), "process.env.STRIPE_SECRET; // must never reach a record\n");
    writeFileSync(join(copy, ".gitignore"), (existsSync(join(copy, ".gitignore")) ? "" : "") + "\n.claude/worktrees/\n", { flag: "a" });
    const label = basename(src);
    let ok = run(`${label}: upgrade --plan`, process.execPath, [PLUGIN, "upgrade", "--plan", `--root=${copy}`], copy);
    ok = run(`${label}: upgrade`, process.execPath, [PLUGIN, "upgrade", `--root=${copy}`], copy) && ok;
    ok = run(`${label}: derive`, process.execPath, [ENGINE, "derive", `--root=${copy}`], copy) && ok;
    ok = run(`${label}: render`, process.execPath, [ENGINE, "render", `--root=${copy}`], copy) && ok;
    ok = run(`${label}: lint`, process.execPath, [ENGINE, "lint", `--root=${copy}`], copy) && ok;
    const leaked = spawnSync("git", ["grep", "-l", "planted.ts", "--", "zdd"], { cwd: copy, encoding: "utf8" });
    if (leaked.status === 0) {
      console.log(`FAILED  ${label}: the planted worktree file reached a generated artifact:\n${leaked.stdout}`);
      ok = false;
    } else console.log(`ok      ${label}: nothing from .claude/worktrees/ reached the artifacts`);
    const diff = spawnSync("git", ["status", "--short"], { cwd: copy, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
    console.log(`        ${label}: ${diff.length} files would move in the upgrade PR${diff.length ? ":\n" + diff.map((l) => "          " + l).join("\n") : ""}`);
    allOk = ok && allOk;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
console.log(allOk ? `\nready to tag ${tag}` : `\nNOT ready to tag ${tag}: fix the FAILED steps above`);
process.exit(allOk ? 0 : 1);
