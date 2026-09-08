#!/usr/bin/env node
// ZDD Stop hook — the prompt for the curated half. The CI check makes drift in
// the GENERATED artifacts un-mergeable; the curated half (glossary, ADRs,
// comments, the map with its blessings) is protected only by the finish
// ritual, and the moment the ritual gets skipped is the moment the agent
// declares done. This hook fires when the agent ends a turn, and if code has
// changed on this branch while nothing in the ZDD bundle moved, it blocks
// ONCE with one line: run the ritual, or say that nothing met the three-part
// test. It is a prompt, not a check — it cannot verify the answer, and a
// truthful "nothing to change" is the right answer often (decision 0008).
//
// Opt-in per repo: it does nothing unless the adopter's VALID zdd/config.json
// says `"hooks": { "stop": true }` (bootstrap writes that on a "yes"; a repo
// bootstrapped before 1.1 has no key and stays silent). Never traps the agent:
// silent when the host says a Stop hook already blocked this continuation
// (`stop_hook_active`), and silent after this hook has blocked once in the
// session (a marker keyed by the session id, in the OS temp dir). Blocking is
// the JSON `{"decision":"block","reason"}` reply on stdout with exit 0 — the
// shape both hosts honour; exit 2 fails open in Codex (decision 0007).
//
// "Code changed": any path that differs from the merge-base with the base
// branch (origin/<baseBranch>, else the local branch, else HEAD alone — the
// working tree included, untracked files included) and is not a ZDD
// artifact. "ZDD moved": any such path inside the bundle dir or at one of the
// configured artifact paths. No git, no config, no changes, anything
// unexpected: exit 0, silently — a hook that errors punishes every session.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { readConfig, artifactPaths, adopterRoot, posixify, REMOTE_OR_DEVICE } from "./lib/repo.mjs";

// The host's Stop payload, or null when there is none to read: a hook that
// cannot see `stop_hook_active` or the session id has no way to promise it
// will not trap the agent, so it stays silent rather than guess.
function readStdin() {
  try {
    const parsed = JSON.parse(readFileSync(0, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000, maxBuffer: 16 * 1024 * 1024 }).trimEnd();

// The paths that differ between the working tree (untracked included) and the
// best base we can find, relative to the git top level. Null when there is no
// usable git here.
export function changedPaths(root, baseBranch) {
  let top;
  try {
    top = git(root, "rev-parse", "--show-toplevel");
  } catch {
    return null;
  }
  const base = mergeBase(root, baseBranch);
  const out = new Set();
  try {
    const diff = base === null ? git(root, "diff", "--name-only", "HEAD") : git(root, "diff", "--name-only", base);
    for (const f of diff.split("\n")) if (f) out.add(f);
  } catch {
    // No HEAD yet (an unborn branch): every tracked file is a change against nothing.
    try {
      for (const f of git(root, "ls-files", "--full-name").split("\n")) if (f) out.add(f);
    } catch {
      return null;
    }
  }
  try {
    // --full-name: ls-files is cwd-relative by default; diff is top-relative.
    for (const f of git(root, "ls-files", "--others", "--exclude-standard", "--full-name").split("\n")) if (f) out.add(f);
  } catch {
    /* untracked listing is best-effort */
  }
  return { top: resolve(top), paths: [...out] };
}

function mergeBase(root, baseBranch) {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      const mb = git(root, "merge-base", "HEAD", ref);
      if (mb) return mb;
    } catch {
      /* try the next ref */
    }
  }
  return null;
}

// Where a session's "already blocked" marker lives: one file per session id
// (Claude Code and Codex both send one), under the OS temp dir. No session
// id ⇒ no marker ⇒ the host's own flag is the only guard.
export function markerPath(sessionId, root) {
  if (typeof sessionId !== "string" || !sessionId) return null;
  const key = createHash("sha256").update(`${sessionId}\0${resolve(root)}`).digest("hex").slice(0, 32);
  return join(tmpdir(), "zdd-stop", key);
}

export function classify(changed, root, config) {
  const rootRel = posixify(relative(changed.top, resolve(root)));
  if (rootRel.startsWith("..") || isAbsolute(rootRel)) return null; // the adopter root is not inside this git checkout
  const prefix = rootRel && rootRel !== "." ? rootRel + "/" : "";
  const paths = artifactPaths(config, { lenient: true });
  const zddPrefixes = [paths.bundleDir, paths.glossary, paths.adrDir, paths.mapDir, paths.metadataDir, paths.agentIndex, paths.adrIndex, paths.humanIndex, paths.graph]
    .filter(Boolean)
    .map((p) => prefix + p);
  const isZdd = (f) => zddPrefixes.some((z) => f === z || f.startsWith(z + "/"));
  const zdd = [];
  const code = [];
  for (const f of changed.paths) (isZdd(f) ? zdd : code).push(f);
  return { zdd, code };
}

export function reason(code, bundleDir) {
  const n = code.length;
  return (
    `ZDD: ${n} file${n === 1 ? "" : "s"} changed on this branch (e.g. ${code.slice(0, 3).join(", ")}${n > 3 ? ", …" : ""}) ` +
    `but nothing under ${bundleDir}/ moved. Before finishing, run the finish ritual — say "update ZDD" (the \`update\` skill): ` +
    `curate the glossary, ADRs, code comments and semantic map the change touched, then regenerate — or state explicitly that ` +
    `no decision met the three-part ADR test and no term, comment, edge or blessing changed. This prompt fires once per session.`
  );
}

function main() {
  const input = readStdin();
  if (!input) return;
  if (input.stop_hook_active === true) return; // the host is already continuing because a Stop hook blocked — never trap the agent
  const cwd = typeof input.cwd === "string" && !REMOTE_OR_DEVICE.test(input.cwd) && existsSync(input.cwd) ? input.cwd : undefined;
  const root = adopterRoot(cwd ? { cwd } : {});
  const { state, config } = readConfig(root);
  if (state !== "valid" || config.hooks?.stop !== true) return;

  const marker = markerPath(input.session_id, root);
  if (marker && existsSync(marker)) return; // blocked once already this session

  const baseBranch = typeof config.baseBranch === "string" && /^[\w./-]+$/.test(config.baseBranch) ? config.baseBranch : "main";
  const changed = changedPaths(root, baseBranch);
  if (!changed) return;
  const split = classify(changed, root, config);
  if (!split || !split.code.length || split.zdd.length) return;

  if (marker) {
    try {
      mkdirSync(join(tmpdir(), "zdd-stop"), { recursive: true });
      writeFileSync(marker, "");
    } catch {
      /* no marker ⇒ the host flag is the only guard; still block this once */
    }
  }
  const text = reason(split.code, artifactPaths(config, { lenient: true }).bundleDir);
  process.stdout.write(JSON.stringify({ decision: "block", reason: text }) + "\n");
  process.stderr.write(text + "\n"); // mirrored for the hook log, as the fence does
}

if (process.argv[1] && posixify(process.argv[1]).endsWith("/scripts/stop-check.mjs")) {
  try {
    main();
  } catch {
    process.exitCode = 0;
  }
}
