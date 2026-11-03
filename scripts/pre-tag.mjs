#!/usr/bin/env node
// The pre-tag dry run on the machine that tags (2.3.0, the process scope;
// decision 8 of its design session). CI proves the release on committed
// scenario fixtures with no secrets (plugins/zdd/test/dry-run.test.mjs);
// this script proves it against REAL adopter checkouts on this machine,
// as a regression check — never as the standard a new user is held to.
//
//   node scripts/pre-tag.mjs vX.Y.Z [--split] <adopter checkout> [<adopter checkout> …]
//
// For each adopter: a throwaway copy (no node_modules, no .git history
// beyond a fresh init), a fake `.claude/worktrees/` folder planted, then
// this checkout's plugin runs `upgrade --plan` and this checkout's engine
// runs derive, render and lint (after `starters --prove` and, as on a yes
// to the fixes, `starters --move`) — exactly what the adopter's upgrade PR will
// do. Any failure names the adopter and the step. The repo's own pins are
// checked first (scripts/release-check.mjs), then both suites.
//
// Since 2.5 the upgrade PR also moves the blessings out of the map
// (decision 0032): the dry run takes the plan's token and moves them with
// the proposed kinds, as the adopter's run will after the developer reads
// the list. `--split` also runs split-adrs (decision 0034), each ADR to the
// set its Scope tag names and every untagged one to the application set —
// the mechanics only; which set an untagged ADR belongs in is the team's
// call, never the dry run's.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "plugins", "zdd", "scripts", "bootstrap.mjs");
const ENGINE = join(ROOT, "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const argv = process.argv.slice(2);
const split = argv.includes("--split");
const [tag, ...adopters] = argv.filter((a) => a !== "--split");
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  console.error("usage: pre-tag.mjs vX.Y.Z [--split] <adopter checkout> …");
  process.exit(2);
}
// Every step runs this checkout's engine, never the one an adopter's pin
// names: the dry run comes before the tag, so that version is not on npm
// yet. A repo's own scaffolded adapter test runs the engine at its pin
// through npx unless ZDD_ENGINE_BIN names one, and `starters --move` runs
// those tests: without it, every adopter holding such an adapter fails here.
const ENV = { ...process.env, ZDD_ENGINE_BIN: ENGINE };
const run = (label, cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: ENV, shell: process.platform === "win32" && /\.cmd$|^npx$|^npm$/.test(cmd) });
  const ok = r.status === 0;
  console.log(`${ok ? "ok     " : "FAILED "} ${label}`);
  if (!ok) {
    console.log((r.stdout + r.stderr).split("\n").slice(-40).join("\n"));
  }
  return ok;
};
let allOk = run("every pin names the tag", process.execPath, [join(ROOT, "scripts", "release-check.mjs"), tag], ROOT);
allOk = run("engine suite", process.execPath, ["--test", "test/*.test.mjs"], join(ROOT, "packages", "zdd-engine")) && allOk;
allOk = run("starter library suite", process.execPath, ["--test", "test/*.test.mjs"], join(ROOT, "packages", "zdd-starter-adapters")) && allOk;
allOk = run("the starters' own tests", process.execPath, [ENGINE, "test", "--adapters=adapters"], join(ROOT, "packages", "zdd-starter-adapters")) && allOk;
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
    // The folder that bit both adopters: a second checkout inside the first.
    mkdirSync(join(copy, ".claude", "worktrees", "pretag", "src"), { recursive: true });
    writeFileSync(join(copy, ".claude", "worktrees", "pretag", "src", "planted.ts"), "process.env.STRIPE_SECRET; // must never reach a record\n");
    writeFileSync(join(copy, ".gitignore"), (existsSync(join(copy, ".gitignore")) ? "" : "") + "\n.claude/worktrees/\n", { flag: "a" });
    const label = basename(src);
    let ok = run(`${label}: upgrade --plan`, process.execPath, [PLUGIN, "upgrade", "--plan", `--root=${copy}`], copy);
    const plan = JSON.parse(spawnSync(process.execPath, [PLUGIN, "upgrade", "--plan", `--root=${copy}`, "--json"], { cwd: copy, encoding: "utf8", env: ENV }).stdout || "{}");
    const moves = plan.blessingMoves?.proposals ?? [];
    const moving = moves.length ? [`--move-blessings=${plan.blessingMoves.token}`] : [];
    ok = run(`${label}: upgrade${moves.length ? ` (moving ${moves.filter((p) => !p.problem).length} of ${moves.length} blessings; ${moves.filter((p) => p.problem).length} stay, named)` : ""}`, process.execPath, [PLUGIN, "upgrade", ...moving, `--root=${copy}`], copy) && ok;
    for (const p of moves.filter((m) => m.problem)) console.log(`        ${label}: ${p.from} stays on the map — ${p.problem}`);
    // Since 0.14 the upgrade copies every adapter in (decision 0048 point
    // 8): first proof, the records unchanged with the copies in place; then
    // the fixes, as the adopter's run takes them on a yes — the copies move,
    // their tests run, derive, the map is repointed, lint.
    // A status that fails is a failed adopter, never "nothing to prove" (CR-326).
    const st = spawnSync(process.execPath, [PLUGIN, "starters", `--root=${copy}`, "--json"], { cwd: copy, encoding: "utf8", env: ENV });
    let status = null;
    try {
      status = st.status === 0 ? JSON.parse(st.stdout) : null;
    } catch {
      status = null;
    }
    if (!status || !Array.isArray(status.copies) || !Array.isArray(status.behind)) {
      console.log(`FAILED  ${label}: starters (the copies' status) — exit ${st.status}\n${(st.stdout + st.stderr).split("\n").slice(-20).join("\n")}`);
      ok = false;
      status = { copies: [], behind: [] };
    }
    if (status.copies.length) {
      ok = run(`${label}: starters --prove (${status.copies.length} adapters copied in; the records unchanged)`, process.execPath, [PLUGIN, "starters", "--prove", `--root=${copy}`], copy) && ok;
      if (status.behind?.length) {
        const m = spawnSync(process.execPath, [PLUGIN, "starters", "--move", `--root=${copy}`, "--json"], { cwd: copy, encoding: "utf8", env: ENV });
        let moved = null;
        try {
          moved = JSON.parse(m.stdout);
        } catch {
          moved = null;
        }
        const good = m.status === 0 && moved?.lint?.ok;
        console.log(`${good ? "ok     " : "FAILED "} ${label}: starters --move (${status.behind.length} copies to ${status.version}${moved ? `; records ${moved.records.before} → ${moved.records.after}, ${moved.records.changed.length} changed, ${moved.records.added.length} new, ${moved.moves.length} ids moved, ${moved.repointed.length} files repointed` : ""})`);
        if (!good) console.log((m.stdout + m.stderr).split("\n").slice(-40).join("\n"));
        for (const x of moved?.moves ?? []) console.log(`        ${label}: ${x.from} → ${x.to}`);
        ok = good && ok;
      }
    }
    if (split) {
      const sp = JSON.parse(spawnSync(process.execPath, [PLUGIN, "split-adrs", "--plan", `--root=${copy}`, "--json"], { cwd: copy, encoding: "utf8", env: ENV }).stdout || "{}");
      const untagged = (sp.proposals ?? []).filter((p) => !p.tag).map((p) => p.num);
      const tagged = (sp.proposals ?? []).filter((p) => p.tag === "harness").length;
      ok = run(`${label}: split-adrs (${tagged} to harness by their tag, ${untagged.length} untagged kept in the application set)`, process.execPath, [PLUGIN, "split-adrs", `--token=${sp.token}`, `--application=${untagged.join(",")}`, `--root=${copy}`], copy) && ok;
    }
    ok = run(`${label}: derive`, process.execPath, [ENGINE, "derive", `--root=${copy}`], copy) && ok;
    ok = run(`${label}: render`, process.execPath, [ENGINE, "render", `--root=${copy}`], copy) && ok;
    ok = run(`${label}: lint`, process.execPath, [ENGINE, "lint", `--root=${copy}`], copy) && ok;
    // What the upgrade asks the developer to answer (decisions 0048 and
    // 0049): its steps 4c and 4d, counted, so the adopter's task can say how
    // many to expect. A list that cannot be read fails the adopter.
    for (const which of ["unread", "gaps"]) {
      const r = spawnSync(process.execPath, [PLUGIN, which, `--root=${copy}`, "--json"], { cwd: copy, encoding: "utf8", env: ENV, maxBuffer: 256 * 1024 * 1024 });
      let list = null;
      try {
        list = r.status === 0 ? JSON.parse(r.stdout) : null;
      } catch {
        list = null;
      }
      if (!Array.isArray(list?.open)) {
        console.log(`FAILED  ${label}: ${which} (the list to answer) — exit ${r.status}\n${(r.stdout + r.stderr).split("\n").slice(-20).join("\n")}`);
        ok = false;
        continue;
      }
      const kinds = Object.entries(list.open.reduce((m, x) => ((m[x.kind ?? x.adapter ?? "?"] = (m[x.kind ?? x.adapter ?? "?"] ?? 0) + 1), m), {})).map(([k, n]) => `${n} ${k}`).join(", ");
      console.log(`        ${label}: ${list.open.length} ${which === "gaps" ? "gaps" : "unread items"} to answer${kinds ? ` (${kinds})` : ""}`);
    }
    // --untracked: a record the derive just minted is not yet in the index (CR-515).
    const leaked = spawnSync("git", ["grep", "-l", "--untracked", "planted.ts", "--", "zdd"], { cwd: copy, encoding: "utf8", env: ENV });
    if (leaked.status === 0) {
      console.log(`FAILED  ${label}: the planted worktree file reached a generated artifact:\n${leaked.stdout}`);
      ok = false;
    } else console.log(`ok      ${label}: nothing from .claude/worktrees/ reached the artifacts`);
    const diff = spawnSync("git", ["status", "--short"], { cwd: copy, encoding: "utf8", env: ENV }).stdout.trim().split("\n").filter(Boolean);
    console.log(`        ${label}: ${diff.length} files would move in the upgrade PR${diff.length ? ":\n" + diff.map((l) => "          " + l).join("\n") : ""}`);
    allOk = ok && allOk;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}
if (!adopters.length) console.log("\n(no adopter checkout was given: the pins and both suites were checked, no real repo was upgraded — CI's dry run on the three scenario fixtures is the only adopter proof)");
console.log(allOk ? `\nready to tag ${tag}` : `\nNOT ready to tag ${tag}: fix the FAILED steps above`);
process.exit(allOk ? 0 : 1);
